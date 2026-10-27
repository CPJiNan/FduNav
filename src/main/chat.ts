import {randomUUID} from 'node:crypto'
import {app, ipcMain, type IpcMainInvokeEvent, type WebContents} from 'electron'
import type {Result} from '../shared/accounts'
import type {ChatActionRequest, ChatCard, ChatState, ChatSummaryRequest, ChatTurn} from '../shared/chat'
import type {AppDatabase} from './database'
import type {AccountService} from './accounts'
import type {LlmSettingsService} from './llm-settings'
import type {registerNoticeHandlers} from './notices'
import type {registerCalendarHandlers} from './calendar'
import type {registerTodoHandlers} from './todos'
import {completeLlmWithTools, type Connection, type ToolChatMessage} from './llm-connection'
import {chatToolLabels, configuredChatTools, createChatToolRunner} from './chat-tools'

interface StoredTurn extends ChatTurn {
    context: ToolChatMessage[]
}

interface RunningChat {
    turns: StoredTurn[];
    status: string;
    controller: AbortController
}

export function registerChatHandlers(db: AppDatabase, accounts: AccountService, llm: LlmSettingsService,
                                     notices: ReturnType<typeof registerNoticeHandlers>, calendar: ReturnType<typeof registerCalendarHandlers>,
                                     todos: ReturnType<typeof registerTodoHandlers>,
                                     trusted: (event: IpcMainInvokeEvent) => boolean) {
    const running = new Map<string, RunningChat>()
    const summaryJobs = new Set<string>()
    const summaryJobKey = (user: string, turnId: string, requestId: string) => JSON.stringify([user, turnId, requestId])
    const subscribers = new Map<WebContents, string>()

    function username() {
        const account = accounts.getState()
        if (account.status !== 'signed-in' || !account.username) throw new Error('请先登录账号。')
        return account.username
    }

    function load(user: string): StoredTurn[] {
        const saved = db.getChatConversation(user)
        const turns = saved ? JSON.parse(saved) as StoredTurn[] : []
        for (const turn of turns) {
            turn.actionRequests = turn.actionRequests?.filter(request =>
                request.action?.kind === 'create_event' || request.action?.kind === 'create_todo')
        }
        for (const turn of turns) for (const request of turn.summaryRequests ?? []) {
            if (request.status === 'generating' && !summaryJobs.has(summaryJobKey(user, turn.id, request.id))) {
                request.status = 'failed'
                request.error = '上次生成已中断，请重新允许后重试。'
            }
        }
        for (const turn of turns) for (const request of turn.actionRequests ?? []) {
            if (request.status === 'executing') {
                request.status = 'failed'
                request.error = '上次操作中断，结果未确认，请查询实际状态后重新申请。'
            }
        }
        return turns
    }

    function snapshot(user: string): ChatState {
        const active = running.get(user)
        const events = new Map(db.getCalendarEvents(user).map(event => [event.id, event]))
        return {
            username: user, turns: (active?.turns ?? load(user)).map(({context: _context, ...turn}) => ({
                ...turn,
                cards: turn.cards.map(card => {
                    if (card.kind !== 'event') return card
                    const event = events.get(card.event.id)
                    return event ? {kind: 'event' as const, event} : {...card, deleted: true}
                }),
            })),
            busy: !!active, status: active?.status ?? ''
        }
    }

    function publish(user: string) {
        const state = snapshot(user)
        for (const [sender, owner] of subscribers) {
            if (sender.isDestroyed()) subscribers.delete(sender)
            else if (owner === user && db.getAccount()?.username === user) sender.send('chat:changed', state)
        }
    }

    function subscribe(sender: WebContents, user: string) {
        if (!subscribers.has(sender)) sender.once('destroyed', () => subscribers.delete(sender))
        subscribers.set(sender, user)
    }

    function handle<T>(channel: string, action: (user: string, input: unknown, event: IpcMainInvokeEvent) => T) {
        ipcMain.handle(channel, (event, input): Result<T> => {
            if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
            try {
                const user = username()
                subscribe(event.sender, user)
                return {ok: true, data: action(user, input, event)}
            } catch (error) {
                return {ok: false, error: error instanceof Error ? error.message : '聊天操作失败。'}
            }
        })
    }

    function persist(user: string, active: RunningChat, completed = false) {
        db.saveChatConversation(user, JSON.stringify(active.turns.map((turn, index) => {
            // A crash during a tool batch must not leave orphaned calls in the next request.
            const context: ToolChatMessage[] = []
            const pending = new Set<string>()
            const finish = () => {
                for (const id of pending) context.push({
                    role: 'tool', tool_call_id: id,
                    content: JSON.stringify({error: '操作中断，结果未知；请重新查询实际状态，不要直接重复写入。'})
                })
                pending.clear()
            }
            for (const message of turn.context) {
                if (message.role !== 'tool') finish()
                if (message.role === 'assistant') message.tool_calls?.forEach(call => pending.add(call.id))
                if (message.role === 'tool') pending.delete(message.tool_call_id)
                context.push(message)
            }
            finish()
            return {
                ...turn, context, ...(!completed && index === active.turns.length - 1
                    ? {error: '回复中断；已完成的操作仍然有效，请查询后再继续。'} : {})
            }
        })))
    }

    async function run(user: string, active: RunningChat) {
        const turn = active.turns[active.turns.length - 1]
        let connection: Connection | undefined
        let watch: ReturnType<typeof setInterval> | undefined
        try {
            const settings = JSON.stringify(db.getLlmSettings())
            const signal = AbortSignal.any([active.controller.signal, llm.getRequestSignal(), AbortSignal.timeout(180_000)])
            const assertCurrent = () => {
                signal.throwIfAborted()
                if (username() !== user) throw new Error('账号已变化，已停止回复。')
                if (settings !== JSON.stringify(db.getLlmSettings())) throw new Error('LLM 设置已变化，请重新发送消息。')
            }
            watch = setInterval(() => {
                try {
                    assertCurrent()
                } catch (error) {
                    active.controller.abort(error)
                }
            }, 500)
            connection = await llm.getConnection()
            assertCurrent()
            const context: ToolChatMessage[] = [{
                role: 'system', content: llm.get().chatPrompt + '\n' + JSON.stringify({
                    currentTime: new Date().toLocaleString('sv-SE', {timeZone: 'Asia/Shanghai'}),
                    timeZone: 'Asia/Shanghai',
                    messagePreferences: db.getMessagePreferences(),
                })
            }]
            // Keep complete turns so tool calls are never separated from their results.
            const history = active.turns.slice(0, -1).slice(-8)
            while (history.length && JSON.stringify(history.map(item => item.context)).length > 60000) history.shift()
            context.push(...history.flatMap(item => item.context), ...turn.context)

            function addCard(card: ChatCard) {
                const matches = (item: ChatCard) => item.kind === 'notice' && card.kind === 'notice'
                    ? item.notice.sourceId === card.notice.sourceId && item.notice.url === card.notice.url
                    : item.kind === 'course' && card.kind === 'course' ? item.occurrence.key === card.occurrence.key
                        : item.kind === 'event' && card.kind === 'event' && item.event.id === card.event.id
                const index = turn.cards.findIndex(matches)
                if (index < 0) turn.cards.push(card)
                else turn.cards[index] = card
                if (turn.cards.length > 40) turn.cards.shift()
                for (const previous of active.turns.slice(0, -1)) {
                    previous.cards = previous.cards.map(item => matches(item) ? card : item)
                }
            }

            const execute = createChatToolRunner(db, user, notices, addCard, assertCurrent, notice => {
                const requests = turn.summaryRequests ??= []
                let request = requests.find(item => item.notice.sourceId === notice.sourceId && item.notice.url === notice.url)
                if (!request) {
                    if (requests.length >= 20) throw new Error('本轮最多申请 20 条通知摘要，请缩小范围。')
                    request = {id: randomUUID(), notice, status: 'pending'}
                    requests.push(request)
                }
                return {
                    requestId: request.id, status: request.status, notice: request.notice,
                    message: '摘要请求卡片已显示，等待用户点击允许；尚未生成摘要。'
                }
            }, action => {
                const requests = turn.actionRequests ??= []
                let request = requests.find(item => JSON.stringify(item.action) === JSON.stringify(action))
                if (!request) {
                    if (requests.length >= 20) throw new Error('本轮最多申请 20 个操作，请缩小范围。')
                    request = {id: randomUUID(), action, status: 'pending'}
                    requests.push(request)
                }
                return {
                    requestId: request.id, status: request.status, action: request.action,
                    message: '请求卡片已显示，等待用户点击允许，尚未执行。'
                }
            })
            let calls = 0
            for (let round = 0; round < 8; round++) {
                assertCurrent()
                active.status = '正在思考';
                publish(user)
                const response = await completeLlmWithTools(connection, context, configuredChatTools(llm.get().toolDescriptions), signal)
                assertCurrent()
                context.push(response);
                turn.context.push(response)
                if (response.content?.trim()) turn.reply += `${turn.reply ? '\n\n' : ''}${response.content.trim()}`
                if (!response.tool_calls?.length) {
                    persist(user, active, true)
                    return
                }
                for (const call of response.tool_calls) {
                    let result: unknown
                    try {
                        assertCurrent()
                        if (++calls > 24) throw new Error('本轮工具调用已达上限，请缩小请求范围。')
                        active.status = chatToolLabels[call.function.name] ?? '正在处理';
                        publish(user)
                        result = await execute(call.function.name, call.function.arguments)
                    } catch (error) {
                        result = {
                            error: signal.aborted ? '已停止，工具未完成；请查询实际状态后继续。' :
                                error instanceof Error ? error.message : '操作失败。'
                        }
                    }
                    const message: ToolChatMessage = {
                        role: 'tool',
                        tool_call_id: call.id,
                        content: JSON.stringify(result)
                    }
                    context.push(message);
                    turn.context.push(message)
                    persist(user, active);
                    publish(user)
                }
                if (calls >= 24) throw new Error('本轮处理已达上限，已完成的操作保留。可以继续发送消息。')
            }
            throw new Error('本轮处理已达上限，已完成的操作保留。可以继续发送消息。')
        } catch (error) {
            turn.error = active.controller.signal.aborted ? '已停止回复，未允许的请求不会执行。已完成的操作保留。' :
                error instanceof Error ? error.message : '回复失败，请重试。'
            turn.context.push({role: 'assistant', content: turn.error})
        } finally {
            if (watch) clearInterval(watch)
            if (connection) connection.apiKey = ''
            try {
                persist(user, active, true)
            } finally {
                running.delete(user);
                publish(user)
            }
        }
    }

    function updateSummaryRequest(user: string, turnId: string, requestId: string, update: (request: ChatSummaryRequest) => void) {
        const active = running.get(user)
        const turns = active?.turns ?? load(user)
        const turn = turns.find(item => item.id === turnId)
        const request = turn?.summaryRequests?.find(item => item.id === requestId)
        if (!turn || !request) return
        update(request)
        for (const message of turn.context) {
            if (message.role !== 'tool') continue
            try {
                const result = JSON.parse(message.content)
                if (result?.requestId === requestId) message.content = JSON.stringify({
                    requestId, status: request.status,
                    notice: request.notice, summary: request.summary, error: request.error
                })
            } catch { /* Other tool results do not belong to this request. */
            }
        }
        if (active) persist(user, active)
        else db.saveChatConversation(user, JSON.stringify(turns))
        publish(user)
    }

    handle('chat:decide-summary', (user, input) => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('摘要请求参数无效。')
        const {turnId, requestId, allow} = input as Record<string, unknown>
        if (typeof turnId !== 'string' || typeof requestId !== 'string' || typeof allow !== 'boolean') throw new Error('摘要请求参数无效。')
        if (running.has(user)) throw new Error('请等待当前回复完成后再处理摘要请求。')
        const turn = load(user).find(item => item.id === turnId)
        const request = turn?.summaryRequests?.find(item => item.id === requestId)
        if (!request) throw new Error('摘要请求不存在或已被清除。')
        if (request.status !== 'pending' && request.status !== 'failed') return snapshot(user)
        if (!allow) {
            updateSummaryRequest(user, turnId, requestId, item => {
                item.status = 'rejected';
                delete item.error
            })
            return snapshot(user)
        }
        llm.getRequestSignal()
        const notice = notices.list().items.find(item => item.sourceId === request.notice.sourceId && item.url === request.notice.url)
        if (!notice) throw new Error('通知不存在或来源已停用，请重新查询后申请摘要。')
        const key = summaryJobKey(user, turnId, requestId)
        if (summaryJobs.has(key)) return snapshot(user)
        summaryJobs.add(key)
        try {
            updateSummaryRequest(user, turnId, requestId, item => {
                item.status = 'generating';
                delete item.error
            })
        } catch (error) {
            summaryJobs.delete(key);
            throw error
        }
        // Only this trusted user-decision handler may submit a chat summary to the generation service.
        void notices.summarize({sourceId: notice.sourceId, url: notice.url}).then(summary => {
            updateSummaryRequest(user, turnId, requestId, item => {
                item.status = 'completed';
                item.summary = summary;
                item.notice.relevance = summary.relevance
            })
        }).catch(error => {
            updateSummaryRequest(user, turnId, requestId, item => {
                item.status = 'failed';
                item.error = error instanceof Error ? error.message : '摘要生成失败，请重试。'
            })
        }).finally(() => summaryJobs.delete(key)).catch(() => { /* A failed persistence leaves the request recoverable on reload. */
        })
        return snapshot(user)
    })

    function updateActionRequest(user: string, turnId: string, requestId: string, update: (request: ChatActionRequest) => void) {
        const turns = load(user)
        const turn = turns.find(item => item.id === turnId)
        const request = turn?.actionRequests?.find(item => item.id === requestId)
        if (!turn || !request) throw new Error('操作请求不存在或已被清除。')
        update(request)
        for (const message of turn.context) {
            if (message.role !== 'tool') continue
            try {
                if (JSON.parse(message.content)?.requestId === requestId) message.content = JSON.stringify({
                    requestId,
                    status: request.status, action: request.action, result: request.result, error: request.error
                })
            } catch { /* Other tool results do not belong to this request. */
            }
        }
        db.saveChatConversation(user, JSON.stringify(turns))
    }

    handle('chat:decide-action', (user, input) => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('操作请求参数无效。')
        const {turnId, requestId, allow} = input as Record<string, unknown>
        if (typeof turnId !== 'string' || typeof requestId !== 'string' || typeof allow !== 'boolean') throw new Error('操作请求参数无效。')
        if (running.has(user)) throw new Error('请等待当前回复完成后再处理操作请求。')
        const request = load(user).find(item => item.id === turnId)?.actionRequests?.find(item => item.id === requestId)
        if (!request) throw new Error('操作请求不存在或已被清除。')
        if (request.status !== 'pending') return snapshot(user)
        if (!allow) {
            updateActionRequest(user, turnId, requestId, item => {
                item.status = 'rejected'
            })
        } else {
            // Persist consumption before applying changes; an interrupted request is never automatically replayed.
            updateActionRequest(user, turnId, requestId, item => {
                item.status = 'executing'
            })
            try {
                const action = request.action
                if (action.kind !== 'create_event' && action.kind !== 'create_todo') throw new Error('仅支持新增日程或待办。')
                const payload = action.kind === 'create_todo' ? action.todo : action.after
                if ('id' in payload) throw new Error('新增请求不能包含已有记录 ID。')
                const result = action.kind === 'create_todo' ? todos.save(user, action.todo)
                    : calendar.save(user, action.after)
                updateActionRequest(user, turnId, requestId, item => {
                    item.status = 'completed'
                    if (result) item.result = result
                    delete item.error
                })
            } catch (error) {
                updateActionRequest(user, turnId, requestId, item => {
                    item.status = 'failed'
                    item.error = `${error instanceof Error ? error.message : '操作未完成。'} 请查询实际状态后再申请。`
                })
            }
        }
        publish(user)
        return snapshot(user)
    })
    handle('chat:get', user => snapshot(user))
    handle('chat:send', (user, input) => {
        if (running.has(user)) throw new Error('请等待当前回复完成，或先停止回复。')
        if (typeof input !== 'string' || !input.trim() || input.length > 8000) throw new Error('请输入 1–8000 个字符。')
        llm.getRequestSignal()
        const settings = llm.get()
        if (!settings.baseUrl || !settings.model) throw new Error('请先在 LLM 设置中配置接口和模型。')
        const turn: StoredTurn = {
            id: randomUUID(),
            user: input.trim(),
            reply: '',
            cards: [],
            context: [{role: 'user', content: input.trim()}]
        }
        const active: RunningChat = {
            turns: [...load(user).slice(-29), turn],
            status: '正在思考',
            controller: new AbortController()
        }
        persist(user, active)
        running.set(user, active)
        publish(user)
        void run(user, active).catch(() => { /* The persisted interrupted turn remains available if storage fails. */
        })
        return snapshot(user)
    })
    handle('chat:cancel', user => {
        running.get(user)?.controller.abort();
        return null
    })
    handle('chat:clear', user => {
        if (running.has(user)) throw new Error('请先停止当前回复。')
        db.saveChatConversation(user, '[]');
        publish(user);
        return snapshot(user)
    })
    app.once('before-quit', () => {
        for (const active of running.values()) active.controller.abort()
    })
}

import {useEffect, useRef, useState, type FormEvent} from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type {ChatCard, ChatState} from '../../shared/chat'
import type {Notice} from '../../shared/notices'
import {calendarOccurrences, type CalendarOccurrence} from '../../shared/calendar'
import {CalendarEventDialog} from './CalendarEventDialog'
import {Icon} from './Icon'
import './styles/chat.css'
import './styles/calendar.css'

const suggestions = ['最近考试通知', '查看本周日程', '新增代办事项']
export function ChatPage({username, onOpenNotice, onSettings}: {
    username: string; onOpenNotice: (notice: Notice) => void; onSettings: () => void
}) {
    const [state, setState] = useState<ChatState>({username, turns: [], busy: false, status: ''})
    const [loading, setLoading] = useState(true)
    const [draft, setDraft] = useState('')
    const [error, setError] = useState('')
    const [sending, setSending] = useState(false)
    const [opening, setOpening] = useState(false)
    const [confirmClear, setConfirmClear] = useState(false)
    const [editor, setEditor] = useState<CalendarOccurrence | null>(null)
    const scroll = useRef<HTMLDivElement>(null)
    const input = useRef<HTMLTextAreaElement>(null)
    const mounted = useRef(true)
    const stickToBottom = useRef(true)
    const previousFocus = useRef<HTMLElement | null>(null)

    useEffect(() => {
        mounted.current = true
        let receivedUpdate = false
        const unsubscribe = window.chat?.onChanged(value => {
            if (value.username !== username) return
            receivedUpdate = true
            setState(value)
        })
        if (!window.chat) { setError('聊天服务未加载，请重启应用。'); setLoading(false) }
        else void window.chat.get().then(result => {
            if (!mounted.current) return
            if (!result.ok) setError(result.error)
            else if (!receivedUpdate && result.data.username === username) setState(result.data)
        }).catch(() => { if (mounted.current) setError('无法读取聊天记录。') })
            .finally(() => { if (mounted.current) setLoading(false) })
        return () => { mounted.current = false; unsubscribe?.() }
    }, [username])

    useEffect(() => {
        if (stickToBottom.current) scroll.current?.scrollTo({top: scroll.current.scrollHeight})
    }, [state, loading])

    async function send(event: FormEvent) {
        event.preventDefault()
        const text = draft.trim()
        if (!text || loading || state.busy || sending || !window.chat) return
        setSending(true); setError(''); setConfirmClear(false); stickToBottom.current = true
        try {
            const result = await window.chat.send(text)
            if (!mounted.current) return
            if (!result.ok) setError(result.error)
            else { setState(result.data); setDraft('') }
        } catch { if (mounted.current) setError('发送失败，请重试。') }
        finally { if (mounted.current) { setSending(false); input.current?.focus() } }
    }
    async function cancel() {
        try {
            const result = await window.chat?.cancel()
            if (mounted.current && result && !result.ok) setError(result.error)
        } catch { if (mounted.current) setError('停止回复失败，请重试。') }
    }
    async function clear() {
        if (!window.chat || sending || state.busy) return
        setSending(true)
        try {
            const result = await window.chat.clear()
            if (!mounted.current) return
            if (result.ok) { setState(result.data); setError(''); setConfirmClear(false) }
            else setError(result.error)
        } catch { if (mounted.current) setError('清空聊天失败。') }
        finally { if (mounted.current) setSending(false) }
    }
    async function openCard(card: ChatCard) {
        if (opening) return
        setOpening(true); setError('')
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        try {
            if (card.kind === 'notice') {
                const result = await window.notices?.getNotice(card.notice)
                if (!result) throw new Error('通知服务未加载。')
                if (!result.ok) throw new Error(result.error)
                if (mounted.current) onOpenNotice(result.data)
            } else {
                const result = await window.calendar?.list()
                if (!result) throw new Error('日程服务未加载。')
                if (!result.ok) throw new Error(result.error)
                const event = result.data.find(item => item.id === card.event.id)
                if (!event) throw new Error('这条日程已被删除。')
                const item = calendarOccurrences(null, [event], event.startDate, event.startDate)[0]
                if (mounted.current) setEditor(item)
            }
        } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : '无法打开详情。') }
        finally { if (mounted.current) setOpening(false) }
    }
    function closeEditor() {
        setEditor(null); previousFocus.current?.focus()
    }
    async function refreshCards() {
        closeEditor()
        try {
            const result = await window.chat?.get()
            if (mounted.current && result?.ok) setState(result.data)
        } catch { if (mounted.current) setError('日程已更新，聊天卡片刷新失败。') }
    }
    const busy = state.busy || sending
    return <section className="chat-page" aria-label="聊天">
        <header className="chat-header">
            {confirmClear ? <div className="chat-clear-confirm"><span>清空聊天记录？</span>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void clear()}>清空</button>
                <button type="button" className="secondary-button" onClick={() => setConfirmClear(false)}>取消</button></div> :
                <button type="button" className="icon-button" aria-label="清空聊天" title="清空聊天" disabled={busy || !state.turns.length}
                        onClick={() => setConfirmClear(true)}><Icon name="clean"/></button>}
            <button type="button" className="icon-button" aria-label="LLM 设置" title="LLM 设置"
                    onClick={onSettings}><Icon name="settings"/></button>
        </header>
        <div className="chat-messages" ref={scroll} onScroll={() => {
            const element = scroll.current
            if (element) stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}>
            <div className="chat-thread">
                {loading ? <p className="chat-status" role="status">正在读取聊天记录…</p> : !state.turns.length &&
                    <div className="chat-welcome"><span className="chat-welcome-icon"><Icon name="chat"/></span>
                        <h2>有什么可以帮你？</h2>
                        <div className="chat-suggestions">{suggestions.map(text => <button type="button" key={text}
                            onClick={() => { setDraft(text); input.current?.focus() }}>{text}<Icon name="chevron"/></button>)}</div>
                    </div>}
                {state.turns.map(turn => <div className="chat-turn" key={turn.id}>
                    <article className="chat-user" aria-label="我的消息">{turn.user}</article>
                    <article className="chat-assistant" aria-label="助手回复">
                        {turn.reply && <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}
                            components={{a: ({children}) => <span>{children}</span>, img: ({alt}) => <span>{alt}</span>}}>{turn.reply}</Markdown></div>}
                        {!!turn.cards.length && <div className="chat-cards">{turn.cards.map(card => {
                            const notice = card.kind === 'notice' ? card.notice : null
                            const event = card.kind === 'event' ? card.event : null
                            const deleted = card.kind === 'event' && card.deleted
                            return <button type="button" className="chat-card" key={notice ? `${notice.sourceId}:${notice.url}` : event!.id}
                                disabled={opening || deleted} onClick={() => void openCard(card)}>
                                <Icon name={notice ? 'notices' : 'calendar'}/><span>
                                    <small>{notice ? `${notice.sourceName} · ${notice.published}` :
                                        `${event!.startDate} ${event!.allDay ? '全天' : event!.startTime} — ${event!.endDate} ${event!.allDay ? '' : event!.endTime}`}</small>
                                    <strong>{notice?.title ?? event!.title}</strong>
                                    {notice?.relevance && <em>{notice.relevance === 'related' ? '@与我有关' : '@可能有关'}</em>}
                                    {event?.location && <small>{event.location}</small>}
                                    {deleted && <small>已删除</small>}
                                </span><Icon name="chevron"/>
                            </button>
                        })}</div>}
                        {turn.error && <p className="chat-error" role="alert">{turn.error}</p>}
                    </article>
                </div>)}
                {state.busy && <p className="chat-status" role="status"><span className="chat-status-dot"/>{state.status}…</p>}
            </div>
        </div>
        <footer className="chat-footer">
            {error && <p className="chat-error" role="alert">{error}</p>}
            <form className="chat-composer" onSubmit={event => void send(event)}>
                <textarea ref={input} value={draft} maxLength={8000} rows={2} aria-label="聊天消息" placeholder="发送消息…"
                    onChange={event => setDraft(event.target.value)} onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault(); if (!busy) event.currentTarget.form?.requestSubmit()
                        }
                    }}/>
                <div className="chat-composer-actions">
                    {state.busy ? <button type="button" className="icon-button" title="停止回复" aria-label="停止回复" onClick={() => void cancel()}><Icon name="stop"/></button> :
                        <button type="submit" className="icon-button chat-send" title="发送" aria-label="发送" disabled={busy || loading || !draft.trim()}><Icon name="send"/></button>}
                </div>
            </form>
        </footer>
        {editor && <CalendarEventDialog date={editor.date} item={editor} create={false} onClose={closeEditor}
                                       onSaved={() => void refreshCards()} onRemoved={() => void refreshCards()}/>}
    </section>
}

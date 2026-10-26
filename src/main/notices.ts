import {ipcMain, type IpcMainInvokeEvent, shell, type WebContents} from 'electron'
import {AppDatabase} from './database'
import {AccountService} from './accounts'
import {AuthError} from './fudan-auth'
import {parseNoticeDetail} from './notice-parser'
import {isSourceId, sourceUrl} from '../shared/sources'
import {SourceRefreshService} from './source-service'
import {readNoticePdfs} from './notice-pdf'
import {noticeImageUrls} from './notice-body'
import {NoticeSummaryService} from './notice-summary'
import type {LlmSettingsService} from './llm-settings'
import type {NoticeRef} from '../shared/notices'
import type {Result} from '../shared/accounts'
import {validateRequiredMessagePreferences} from '../shared/message-preferences'

export function registerNoticeHandlers(db: AppDatabase, accounts: AccountService, llm: LlmSettingsService, trusted: (event: IpcMainInvokeEvent) => boolean) {
    const refresh = new SourceRefreshService(db)
    const detailImages = new Map<string, Set<string>>()
    const detailKey = (notice: NoticeRef) => JSON.stringify([notice.sourceId, notice.url])

    function requireReady() {
        if (!db.getAccount()) throw new AuthError('请先登录。')
        let ready = false
        try {
            ready = validateRequiredMessagePreferences(db.getMessagePreferences()).ok
        } catch {
            ready = false
        }
        if (!ready) throw new AuthError('请先完善消息偏好。')
    }

    function handle<T>(name: string, action: (input: any) => Promise<T>, ready = true) {
        ipcMain.handle(name, async (event, input): Promise<Result<T>> => {
            if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
            try {
                if (ready) requireReady()
                return {ok: true, data: await action(input)}
            } catch (error) {
                return {ok: false, error: error instanceof AuthError ? error.message : '通知加载失败，请稍后重试。'}
            }
        })
    }

    function knownUrl(input: unknown) {
        if (!input || typeof input !== 'object') throw new AuthError('通知参数无效。')
        const value = input as Record<string, unknown>
        if (typeof value.url !== 'string' || typeof value.sourceId !== 'string' || !db.hasNotice(value.url, value.sourceId)) {
            throw new AuthError('未找到这条通知，请刷新列表。')
        }
        return sourceUrl(value.url)
    }

    const summaries = new NoticeSummaryService(db, llm, async ref => readNoticePdfs(await readDetail(ref)))
    const subscribers = new Set<WebContents>()
    const queueSnapshot = () => summaries.queue.snapshot(db.getAccount()?.username ?? '')
    summaries.queue.subscribe(() => {
        for (const sender of subscribers) {
            if (sender.isDestroyed()) subscribers.delete(sender)
            else sender.send('notices:summary-queue-changed', queueSnapshot())
        }
    })
    ipcMain.handle('notices:summary-queue', event => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        subscribers.add(event.sender)
        return {ok: true, data: queueSnapshot()}
    })
    handle('notices:enqueue-summaries', async (input: unknown) => {
        if (!Array.isArray(input) || !input.length || input.length > 200) throw new AuthError('请选择 1–200 条通知。')
        input.forEach(knownUrl)
        const unique = new Map(input.map((ref: NoticeRef) => [detailKey(ref), ref]))
        const notices = [...unique.values()].filter(ref => summaries.needsSummary(ref))
        if (!notices.length) return
        const settings = llm.get()
        if (!settings.enabled || !settings.model) throw new AuthError('请先配置并启用 LLM。')
        if (summaries.queue.activeCount + notices.length > 200) throw new AuthError('队列最多容纳 200 条待完成任务，请减少选择或等待任务完成。')
        for (const ref of notices) void summaries.summarize(ref).catch(() => { /* Task errors are shown in the queue. */
        })
    })
    handle('notices:cancel-summaries', async (input: unknown) => {
        if (!Array.isArray(input) || input.length > 400 || !input.every(id => typeof id === 'string')) {
            throw new AuthError('摘要任务参数无效。')
        }
        summaries.queue.cancel(input, db.getAccount()?.username ?? '')
    }, false)
    handle('notices:clear-summary-queue', async () => summaries.queue.clear(db.getAccount()?.username ?? ''), false)
    handle('notices:remove-summaries', async (input: unknown) => {
        if (!Array.isArray(input) || input.length > 400 || !input.every(id => typeof id === 'string')) {
            throw new AuthError('摘要任务参数无效。')
        }
        summaries.queue.remove(input, db.getAccount()?.username ?? '')
    }, false)
    handle('notices:get', async (input: unknown) => {
        knownUrl(input)
        const ref = input as NoticeRef
        const notice = db.getNotice(ref.sourceId, ref.url)!
        return {...notice, relevance: summaries.relevanceFor(notice)}
    })
    handle('notices:set-relevance', async (input: unknown) => {
        knownUrl(input)
        const value = input as NoticeRef & { relevance?: unknown }
        if (value.relevance !== 'related' && value.relevance !== 'maybe' && value.relevance !== 'none') {
            throw new AuthError('相关性选项无效。')
        }
        db.setNoticeRelevanceChoice(db.getAccount()!.username, value.sourceId, value.url, value.relevance)
        return value.relevance === 'none' ? null : value.relevance
    })

    handle('notices:mark-read', async (input: unknown) => {
        knownUrl(input)
        const ref = input as NoticeRef
        db.markNoticeRead(db.getAccount()!.username, ref.sourceId, ref.url)
    })

    handle('notices:mark-many-read', async (input: unknown) => {
        if (!Array.isArray(input) || !input.length) throw new AuthError('请选择需要标记已读的通知。')
        input.forEach(knownUrl)
        try {
            db.markNoticesRead(db.getAccount()!.username, input as NoticeRef[])
        } catch {
            throw new AuthError('已读状态保存失败，请重试。')
        }
    })

    handle('notices:list', async (force: unknown) => {
        if (force === true) await refresh.refresh()
        const list = db.getNotices()
        return {
            ...list,
            items: list.items.map(item => {
                const relevance = summaries.relevanceFor(item)
                return relevance ? {...item, relevance} : item
            })
        }
    })

    async function readDetail(input: unknown) {
        const url = knownUrl(input)
        const source = db.getSource((input as NoticeRef).sourceId)!
        const isJwc = new URL(url).hostname === 'jwc.fudan.edu.cn'
        let html = isJwc ? await accounts.readNotice(url) : await accounts.readPage(url)
        if (html === null && !isJwc) html = await accounts.readPageWithBrowser(url)
        if (html === null) return {content: '', body: [], imageCount: 0, requiresLogin: true, attachments: []}
        const detail = parseNoticeDetail(html, url, source.id)
        if (!detail) throw new AuthError('无法读取通知正文，请查看学校原文。')
        const key = detailKey(input as NoticeRef)
        detailImages.delete(key)
        detailImages.set(key, new Set(noticeImageUrls(detail.body)))
        if (detailImages.size > 64) detailImages.delete(detailImages.keys().next().value!)
        return detail
    }

    handle('notices:detail', async (input: unknown) => {
        return readNoticePdfs(await readDetail(input))
    })
    handle('notices:summary', async (input: unknown) => {
        knownUrl(input)
        try {
            return await summaries.summarize(input as NoticeRef, (input as { force?: unknown }).force === true)
        } catch (error) {
            if (error instanceof AuthError) throw error
            throw new AuthError(error instanceof Error ? error.message : '摘要生成失败，请稍后重试。')
        }
    })
    handle('notices:image', async (input: unknown) => {
        const referer = knownUrl(input)
        const imageUrl = (input as Record<string, unknown>).imageUrl
        if (typeof imageUrl !== 'string' || !detailImages.get(detailKey(input as NoticeRef))?.has(imageUrl)) {
            throw new AuthError('未找到这张通知图片，请重新打开通知。')
        }
        try {
            const image = await accounts.readImage(imageUrl, referer)
            requireReady()
            return image
        } catch {
            throw new AuthError('图片加载失败，请重试。')
        }
    })
    handle('notices:open-source', async (input: unknown) => {
        await shell.openExternal(knownUrl(input))
    })
    handle('notices:open-attachment', async (input: unknown) => {
        const detail = await readDetail(input)
        const url = (input as Record<string, unknown>).urlToOpen
        if (typeof url !== 'string' || !detail.attachments.some(attachment => attachment.url === url)) {
            throw new AuthError('未找到这份通知附件。')
        }
        await shell.openExternal(sourceUrl(url))
    })

    handle('sources:list', async () => db.getSources())
    handle('sources:reorder', async (input: unknown) => {
        if (!Array.isArray(input) || input.length !== db.getSources().length ||
            new Set(input).size !== input.length || !input.every(isSourceId)) {
            throw new AuthError('消息来源排序无效。')
        }
        return db.reorderSources(input)
    })
    handle('sources:set-enabled', async (input: unknown) => {
        const value = input as Record<string, unknown> | null
        if (!value || !isSourceId(value.id) || typeof value.enabled !== 'boolean') {
            throw new AuthError('来源设置无效。')
        }
        return db.setSourceEnabled(value.id, value.enabled)
    })
}

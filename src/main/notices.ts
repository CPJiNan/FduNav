import {ipcMain, type IpcMainInvokeEvent, shell} from 'electron'
import {AppDatabase} from './database'
import {AccountService} from './accounts'
import {AuthError} from './fudan-auth'
import {parseNoticeDetail} from './notice-parser'
import {isSourceId, sourceUrl} from '../shared/sources'
import {SourceRefreshService} from './source-service'
import {readNoticePdfs} from './notice-pdf'
import type {NoticeRef} from '../shared/notices'
import type {Result} from '../shared/accounts'
import {validateRequiredMessagePreferences} from '../shared/message-preferences'

export function registerNoticeHandlers(db: AppDatabase, accounts: AccountService, trusted: (event: IpcMainInvokeEvent) => boolean) {
    const refresh = new SourceRefreshService(db)

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

    function handle<T>(name: string, action: (input: any) => Promise<T>) {
        ipcMain.handle(name, async (event, input): Promise<Result<T>> => {
            if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
            try {
                requireReady()
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

    handle('notices:list', async (force: unknown) => {
        if (force === true) await refresh.refresh()
        return db.getNotices()
    })

    async function readDetail(input: unknown) {
        const url = knownUrl(input)
        const source = db.getSource((input as NoticeRef).sourceId)!
        const isJwc = new URL(url).hostname === 'jwc.fudan.edu.cn'
        let html = isJwc ? await accounts.readNotice(url) : await accounts.readPage(url)
        if (html === null && !isJwc) html = await accounts.readPageWithBrowser(url)
        if (html === null) return {content: '', imageCount: 0, requiresLogin: true, attachments: []}
        const detail = parseNoticeDetail(html, url, source.id)
        if (!detail) throw new AuthError('无法读取通知正文，请查看学校原文。')
        return detail
    }

    handle('notices:detail', async (input: unknown) => {
        return readNoticePdfs(await readDetail(input))
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
    handle('sources:set-enabled', async (input: unknown) => {
        const value = input as Record<string, unknown> | null
        if (!value || !isSourceId(value.id) || typeof value.enabled !== 'boolean') {
            throw new AuthError('来源设置无效。')
        }
        return db.setSourceEnabled(value.id, value.enabled)
    })
}

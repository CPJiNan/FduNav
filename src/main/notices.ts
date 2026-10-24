import {ipcMain, type IpcMainInvokeEvent, shell} from 'electron'
import {AppDatabase} from './database'
import {AccountService} from './accounts'
import {AuthError, isAuthUrl} from './fudan-auth'
import {parseNoticeDetail} from './notice-parser'
import {sourceUrl, validateSource} from '../shared/sources'
import {SourceRefreshService} from './source-service'
import {requestSourcePage} from './source-fetch'
import {readNoticePdfs} from './notice-pdf'
import type {NoticeRef} from '../shared/notices'
import type {Result} from '../shared/accounts'

export function registerNoticeHandlers(db: AppDatabase, accounts: AccountService, trusted: (event: IpcMainInvokeEvent) => boolean) {
    const refresh = new SourceRefreshService(db)

    function handle<T>(name: string, action: (input: any) => Promise<T>) {
        ipcMain.handle(name, async (event, input): Promise<Result<T>> => {
            if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
            try {
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
        if (force !== true) return db.getNotices()
        return refresh.refresh()
    })
    async function readDetail(input: unknown) {
        const url = knownUrl(input)
        const source = db.getSource((input as NoticeRef).sourceId)!
        let html: string | null
        let baseUrl = url
        if (new URL(url).hostname === 'jwc.fudan.edu.cn') html = await accounts.readNotice(url)
        else {
            const page = await requestSourcePage(url)
            baseUrl = page.url
            html = isAuthUrl(page.url) ? null : page.text
        }
        if (html === null) return {content: '', imageCount: 0, requiresLogin: true, attachments: []}
        const detail = parseNoticeDetail(html, baseUrl, source.preset)
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
    handle('sources:save', async (input: unknown) => {
        const result = validateSource(input)
        if (!result.ok) throw new AuthError(result.error)
        try { return db.saveSource(result.data) }
        catch (error) { throw new AuthError(error instanceof Error ? error.message : '来源保存失败。') }
    })
    handle('sources:remove', async (input: unknown) => {
        if (typeof input !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(input)) throw new AuthError('来源标识无效。')
        return db.removeSource(input)
    })
}

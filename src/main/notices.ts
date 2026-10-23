import {ipcMain, type IpcMainInvokeEvent, shell} from 'electron'
import {AppDatabase} from './database'
import {AccountService} from './accounts'
import {AuthError, FudanTransport, isAuthUrl, validateUrl} from './fudan-auth'
import {parseNoticeDetail, parseNotices} from './notice-parser'
import type {Result} from '../shared/accounts'

export function registerNoticeHandlers(db: AppDatabase, accounts: AccountService, trusted: (event: IpcMainInvokeEvent) => boolean) {
    let refresh: Promise<ReturnType<AppDatabase['getNotices']>> | null = null

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
        if (typeof input !== 'string' || !db.hasNotice(input)) throw new AuthError('未找到这条通知，请刷新列表。')
        return validateUrl(input)
    }

    handle('notices:list', async (force: unknown) => {
        if (force !== true) return db.getNotices()
        if (!refresh) refresh = (async () => {
            const page = await new FudanTransport().request('https://jwc.fudan.edu.cn/9397/list.htm')
            if (isAuthUrl(page.url)) throw new AuthError('公开通知列表需要认证，请稍后重试。')
            const items = parseNotices(page.text, page.url)
            if (!items.length) throw new AuthError('没有解析到通知，学校网站可能正在维护或页面结构已变化。')
            db.saveNotices(items)
            return db.getNotices()
        })().finally(() => {
            refresh = null
        })
        return refresh
    })
    handle('notices:detail', async (input: unknown) => {
        const html = await accounts.readNotice(knownUrl(input))
        if (html === null) return {content: '', imageCount: 0, requiresLogin: true}
        const detail = parseNoticeDetail(html)
        if (!detail) throw new AuthError('无法读取通知正文，请查看学校原文。')
        return detail
    })
    handle('notices:open-source', async (input: unknown) => {
        await shell.openExternal(knownUrl(input))
    })
}

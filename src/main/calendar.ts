import {randomUUID} from 'node:crypto'
import {ipcMain, type IpcMainInvokeEvent} from 'electron'
import type {AppDatabase} from './database'
import type {AccountService} from './accounts'
import {AuthError} from './fudan-auth'
import {validateCalendarEvent} from '../shared/calendar'
import type {Result} from '../shared/accounts'

export function registerCalendarHandlers(db: AppDatabase, accounts: AccountService, trusted: (event: IpcMainInvokeEvent) => boolean) {
    function handle<T>(channel: string, action: (username: string, input: unknown) => T) {
        ipcMain.handle(channel, (event, input): Result<T> => {
            if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
            try {
                const account = accounts.getState()
                if (account.status !== 'signed-in' || !account.username) throw new AuthError('请先登录账号。')
                return {ok: true, data: action(account.username, input)}
            } catch (error) { return {ok: false, error: error instanceof AuthError ? error.message : '日程操作失败，请重试。'} }
        })
    }
    handle('calendar:list', username => db.getCalendarEvents(username))
    handle('calendar:save', (username, input) => {
        const result = validateCalendarEvent(input)
        if (!result.ok) throw new AuthError(result.error)
        if (result.data.id && !db.hasCalendarEvent(username, result.data.id)) throw new AuthError('日程不存在或已被删除。')
        const event = {...result.data, id: result.data.id ?? randomUUID()}
        db.saveCalendarEvent(username, event)
        return event
    })
    handle('calendar:remove', (username, input) => {
        if (typeof input !== 'string' || !db.hasCalendarEvent(username, input)) throw new AuthError('日程不存在或已被删除。')
        db.removeCalendarEvent(username, input)
        return null
    })
}

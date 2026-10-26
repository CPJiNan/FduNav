import {ipcMain, type IpcMainInvokeEvent} from 'electron'
import type {AppDatabase} from './database'
import type {Result} from '../shared/accounts'
import {
    type MessagePreferences,
    validateMessagePreferences,
    validateRequiredMessagePreferences,
} from '../shared/message-preferences'

export function registerMessagePreferenceHandlers(db: AppDatabase, trusted: (event: IpcMainInvokeEvent) => boolean) {
    ipcMain.handle('preferences:get-messages', (event): Result<MessagePreferences> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        try {
            return {ok: true, data: db.getMessagePreferences()}
        } catch {
            return {ok: false, error: '无法读取消息偏好，请重试。'}
        }
    })
    ipcMain.handle('preferences:set-messages', (event, input: unknown): Result<MessagePreferences> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        const result = db.getAccount() ? validateRequiredMessagePreferences(input) : validateMessagePreferences(input)
        if (!result.ok) return result
        try {
            return {ok: true, data: db.setMessagePreferences(result.data)}
        } catch {
            return {ok: false, error: '无法保存消息偏好，请重试。'}
        }
    })
}

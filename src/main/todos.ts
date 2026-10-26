import {ipcMain, type IpcMainInvokeEvent} from 'electron'
import type {AppDatabase} from './database'
import type {AccountService} from './accounts'
import type {Result} from '../shared/accounts'
import {TodoError, TodoService} from './todo-service'
import {TodoReminderService} from './todo-reminders'

export function registerTodoHandlers(db: AppDatabase, accounts: AccountService,
                                     trusted: (event: IpcMainInvokeEvent) => boolean, onReminderClick: () => void) {
    const service = new TodoService(db)
    const reminders = new TodoReminderService(db, onReminderClick)

    function handle<T>(channel: string, action: (username: string, input: unknown) => T) {
        ipcMain.handle(channel, (event, input): Result<T> => {
            if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
            try {
                const account = accounts.getState()
                if (account.status !== 'signed-in' || !account.username) return {ok: false, error: '请先登录账号。'}
                return {ok: true, data: action(account.username, input)}
            } catch (error) {
                return {ok: false, error: error instanceof TodoError ? error.message : '待办操作失败，请重试。'}
            }
        })
    }

    handle('todos:list', username => db.getTodos(username))
    handle('todos:save', (username, input) => {
        const todo = service.save(username, input)
        reminders.changed(username, todo.id)
        return todo
    })
    handle('todos:remove', (username, input) => {
        const result = service.remove(username, input)
        reminders.changed(username, input as string)
        return result
    })
}

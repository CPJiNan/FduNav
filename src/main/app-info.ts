import {app, ipcMain, type IpcMainInvokeEvent, shell} from 'electron'
import type {Result} from '../shared/accounts'
import type {AppInfo} from '../shared/app-info'

const repository = 'https://github.com/CPJiNan/FduNav'

export function registerAppInfoHandlers(trusted: (event: IpcMainInvokeEvent) => boolean) {
    ipcMain.handle('app:info', (event): Result<AppInfo> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        return {ok: true, data: {version: app.getVersion(), repository}}
    })
    ipcMain.handle('app:open-repository', async (event): Promise<Result<void>> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        try {
            await shell.openExternal(repository)
            return {ok: true, data: undefined}
        } catch {
            return {ok: false, error: '无法打开 GitHub 仓库。'}
        }
    })
}

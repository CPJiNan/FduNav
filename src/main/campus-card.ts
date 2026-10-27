import {BrowserWindow, ipcMain, type IpcMainInvokeEvent} from 'electron'
import type {AccountService} from './accounts'
import {AuthError} from './fudan-auth'
import type {CampusCardBalance} from '../shared/campus-card'
import type {Result} from '../shared/accounts'

const cacheDuration = 5 * 60_000

export function registerCampusCardHandlers(accounts: AccountService, trusted: (event: IpcMainInvokeEvent) => boolean) {
    let cached: { key: string; data: CampusCardBalance } | null = null
    let pending: { key: string; interactive: boolean; promise: Promise<Result<CampusCardBalance>> } | null = null

    function accountKey() {
        const account = accounts.getState()
        if (account.status !== 'signed-in' || !account.username) throw new AuthError('请先登录账号。')
        return JSON.stringify([account.username, account.lastLogin])
    }

    ipcMain.handle('campus-card:open-records', async (event): Promise<Result<void>> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        try {
            const key = accountKey()
            // Let a balance query finish saving any newly authenticated cookies first.
            if (pending) await pending.promise
            if (accountKey() !== key) throw new AuthError('账号已变更，请重新打开消费记录。')
            await accounts.openCampusCardRecords(BrowserWindow.fromWebContents(event.sender) ?? undefined)
            return {ok: true, data: undefined}
        } catch (error) {
            return {ok: false, error: error instanceof AuthError ? error.message : '无法打开校园卡消费记录，请重试。'}
        }
    })

    ipcMain.handle('campus-card:balance', async (event, refresh: unknown): Promise<Result<CampusCardBalance>> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        try {
            if (refresh !== undefined && typeof refresh !== 'boolean') throw new AuthError('校园卡查询参数无效。')
            const key = accountKey()
            if (cached?.key !== key) cached = null
            while (pending) {
                if (pending.key !== key) throw new AuthError('正在查询校园卡余额，请稍候。')
                const current = pending
                const result = await current.promise
                if (accountKey() !== key) throw new AuthError('账号已变更，请重新查询校园卡余额。')
                if (!refresh || current.interactive || result.ok) return result
            }
            if (!refresh && cached && Date.now() - Date.parse(cached.data.updatedAt) < cacheDuration) {
                return {ok: true, data: cached.data}
            }
            const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
            const promise = accounts.readCampusCardBalance(refresh === true, parent).then((balance): Result<CampusCardBalance> => {
                if (accountKey() !== key) throw new AuthError('账号已变更，请重新查询校园卡余额。')
                const data = {balance, updatedAt: new Date().toISOString()}
                cached = {key, data}
                return {ok: true, data}
            }).catch((error): Result<CampusCardBalance> => ({
                ok: false,
                error: error instanceof AuthError ? error.message : '校园卡余额查询失败，请稍后重试。',
            })).finally(() => {
                pending = null
            })
            pending = {key, interactive: refresh === true, promise}
            return promise
        } catch (error) {
            return {ok: false, error: error instanceof AuthError ? error.message : '校园卡余额查询失败，请稍后重试。'}
        }
    })
}

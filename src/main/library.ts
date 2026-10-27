import {ipcMain, type IpcMainInvokeEvent} from 'electron'
import type {Result} from '../shared/accounts'
import type {LibraryCrowding} from '../shared/library'

// DanXi uses this public endpoint's campusName and inNum fields.
const endpoint = 'https://mlibrary.fudan.edu.cn/api/common/h5/getspaceseat'

export function parseLibraryCrowding(value: unknown): LibraryCrowding['items'] {
    if (!value || typeof value !== 'object') throw new Error('图书馆返回的数据格式无效。')
    const response = value as Record<string, unknown>
    if (String(response.code) !== '1' || !Array.isArray(response.data) || response.data.length > 100) {
        throw new Error('图书馆人数暂不可用，请稍后重试。')
    }
    const seen = new Set<string>()
    return response.data.map(value => {
        if (!value || typeof value !== 'object') throw new Error('图书馆返回的数据格式无效。')
        const item = value as Record<string, unknown>
        const name = typeof item.campusName === 'string' ? item.campusName.trim() : ''
        if (!name || name.length > 100) throw new Error('无法识别图书馆名称，请稍后重试。')
        const id = typeof item.campusId === 'string' || typeof item.campusId === 'number' ? String(item.campusId) : name
        if (!id || id.length > 100 || seen.has(id)) throw new Error('图书馆返回的数据格式无效。')
        seen.add(id)
        const raw = typeof item.inNum === 'string' || typeof item.inNum === 'number' ? String(item.inNum).trim() : ''
        const count = /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null
        return {id, name, count}
    })
}

export function registerLibraryHandlers(trusted: (event: IpcMainInvokeEvent) => boolean) {
    let cached: LibraryCrowding | null = null
    let pending: Promise<Result<LibraryCrowding>> | null = null
    ipcMain.handle('library:crowding', async (event, refresh: unknown): Promise<Result<LibraryCrowding>> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        if (refresh !== undefined && typeof refresh !== 'boolean') return {ok: false, error: '图书馆查询参数无效。'}
        if (pending) return pending
        if (!refresh && cached && Date.now() - Date.parse(cached.updatedAt) < 60_000) return {ok: true, data: cached}
        pending = (async (): Promise<Result<LibraryCrowding>> => {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
                    headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(15_000),
                })
                if (!response.ok) return {ok: false, error: `图书馆服务返回 HTTP ${response.status}，请稍后重试。`}
                const items = parseLibraryCrowding(await response.json())
                cached = {items, updatedAt: new Date().toISOString()}
                return {ok: true, data: cached}
            } catch {
                return {ok: false, error: '无法获取图书馆人数，请检查网络或稍后刷新重试。'}
            }
        })().finally(() => {
            pending = null
        })
        return pending
    })
}

import {ipcMain, type IpcMainInvokeEvent} from 'electron'
import type {AppDatabase} from './database'
import type {Result} from '../shared/accounts'
import type {LlmSettings, LlmConnectionTest} from '../shared/llm'
import {LlmSettingsService} from './llm-settings'
import {testLlmConnection, fetchLlmModels} from './llm-connection'
import {secureStorage} from './secure-storage'

export function registerLlmHandlers(db: AppDatabase, trusted: (event: IpcMainInvokeEvent) => boolean) {
    const service = new LlmSettingsService(db, secureStorage)
    ipcMain.handle('llm:get', (event): Result<LlmSettings> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        try { return {ok: true, data: service.get()} }
        catch { return {ok: false, error: '无法读取 LLM 设置。'} }
    })
    ipcMain.handle('llm:save', async (event, input: unknown): Promise<Result<LlmSettings>> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        try { return {ok: true, data: await service.save(input)} }
        catch (error) { return {ok: false, error: error instanceof Error ? error.message : '无法保存 LLM 设置。'} }
        finally {
            if (input && typeof input === 'object' && 'apiKey' in input) input.apiKey = ''
        }
    })
    ipcMain.handle('llm:set-enabled', (event, enabled: unknown): Result<LlmSettings> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        try { return {ok: true, data: service.setEnabled(enabled)} }
        catch { return {ok: false, error: '无法更新 LLM 启用状态。'} }
    })
    let testing = false
    ipcMain.handle('llm:test', async (event, input: unknown): Promise<Result<LlmConnectionTest>> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        if (testing) return {ok: false, error: '连接测试正在进行，请等待完成。'}
        testing = true
        let connection: Awaited<ReturnType<LlmSettingsService['getDraftConnection']>> | undefined
        try {
            const signal = service.getRequestSignal()
            connection = await service.getDraftConnection(input)
            return {ok: true, data: await testLlmConnection(connection, undefined, undefined, signal)}
        } catch (error) {
            return {ok: false, error: error instanceof Error ? error.message : '连接测试失败，请重试。'}
        } finally {
            testing = false
            if (connection) connection.apiKey = ''
            if (input && typeof input === 'object' && 'apiKey' in input) input.apiKey = ''
        }
    })
    let fetchingModels = false
    ipcMain.handle('llm:models', async (event, input: unknown): Promise<Result<string[]>> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        if (fetchingModels) return {ok: false, error: '正在获取模型，请等待完成。'}
        fetchingModels = true
        let connection: Awaited<ReturnType<LlmSettingsService['getDraftConnection']>> | undefined
        try {
            const signal = service.getRequestSignal()
            connection = await service.getDraftConnection(input, false)
            return {ok: true, data: await fetchLlmModels(connection, undefined, undefined, signal)}
        } catch (error) {
            return {ok: false, error: error instanceof Error ? error.message : '获取模型失败，请重试。'}
        } finally {
            fetchingModels = false
            if (connection) connection.apiKey = ''
            if (input && typeof input === 'object' && 'apiKey' in input) input.apiKey = ''
        }
    })
    return service
}

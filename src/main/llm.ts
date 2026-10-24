import {ipcMain, safeStorage, type IpcMainInvokeEvent} from 'electron'
import type {AppDatabase} from './database'
import type {Result} from '../shared/accounts'
import type {LlmSettings, LlmConnectionTest} from '../shared/llm'
import {LlmSettingsService} from './llm-settings'
import {testLlmConnection, fetchLlmModels} from './llm-connection'

export function registerLlmHandlers(db: AppDatabase, trusted: (event: IpcMainInvokeEvent) => boolean) {
    const service = new LlmSettingsService(db, {
        available: () => safeStorage.isEncryptionAvailable() &&
            !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
        encrypt: value => safeStorage.encryptString(value),
        decrypt: value => safeStorage.decryptString(Buffer.from(value)),
    })
    ipcMain.handle('llm:get', (event): Result<LlmSettings> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        try { return {ok: true, data: service.get()} }
        catch { return {ok: false, error: '无法读取 LLM 设置。'} }
    })
    ipcMain.handle('llm:save', (event, input: unknown): Result<LlmSettings> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        try { return {ok: true, data: service.save(input)} }
        catch (error) { return {ok: false, error: error instanceof Error ? error.message : '无法保存 LLM 设置。'} }
        finally {
            if (input && typeof input === 'object' && 'apiKey' in input) input.apiKey = ''
        }
    })
    let testing = false
    ipcMain.handle('llm:test', async (event, input: unknown): Promise<Result<LlmConnectionTest>> => {
        if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
        if (testing) return {ok: false, error: '连接测试正在进行，请等待完成。'}
        testing = true
        let connection: ReturnType<LlmSettingsService['getDraftConnection']> | undefined
        try {
            connection = service.getDraftConnection(input)
            return {ok: true, data: await testLlmConnection(connection)}
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
        let connection: ReturnType<LlmSettingsService['getDraftConnection']> | undefined
        try {
            connection = service.getDraftConnection(input, false)
            return {ok: true, data: await fetchLlmModels(connection)}
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

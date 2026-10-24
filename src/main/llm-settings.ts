import type {AppDatabase} from './database'
import {emptyLlmSettings, validateLlmSettings, type LlmSettings} from '../shared/llm.ts'

export interface SecretStorage {
    available(): boolean
    encrypt(value: string): Uint8Array
    decrypt(value: Uint8Array): string
}

export class LlmSettingsService {
    private db: AppDatabase
    private secrets: SecretStorage

    constructor(db: AppDatabase, secrets: SecretStorage) {
        this.db = db
        this.secrets = secrets
    }

    get(): LlmSettings {
        const saved = this.db.getLlmSettings()
        return saved ? {baseUrl: saved.baseUrl, model: saved.model, hasApiKey: !!saved.encryptedApiKey?.length} : emptyLlmSettings()
    }

    save(input: unknown): LlmSettings {
        const result = validateLlmSettings(input)
        if (!result.ok) throw new Error(result.error)
        const value = result.data
        const saved = this.db.getLlmSettings()
        if (saved?.encryptedApiKey?.length && new URL(saved.baseUrl).origin !== new URL(value.baseUrl).origin &&
            !value.apiKey && !value.clearApiKey) {
            throw new Error('更换接口站点时，请重新输入 API Key 或勾选清除已保存的密钥。')
        }
        let encryptedApiKey = value.clearApiKey ? null : saved?.encryptedApiKey ?? null
        if (value.apiKey) {
            if (!this.secrets.available()) throw new Error('系统安全存储不可用，无法保存 API Key。')
            try { encryptedApiKey = this.secrets.encrypt(value.apiKey) }
            catch { throw new Error('API Key 加密失败，设置未保存。') }
        }
        this.db.saveLlmSettings({baseUrl: value.baseUrl, model: value.model, encryptedApiKey})
        return this.get()
    }

    // Main-process-only accessor for the future notification analysis service.
    // Never expose decrypted credentials through IPC.
    getConnection(): {baseUrl: string; model: string; apiKey: string} {
        const saved = this.db.getLlmSettings()
        if (!saved) throw new Error('请先配置 LLM。')
        let apiKey = ''
        if (saved.encryptedApiKey?.length) {
            if (!this.secrets.available()) throw new Error('系统安全存储不可用。')
            try { apiKey = this.secrets.decrypt(saved.encryptedApiKey) }
            catch { throw new Error('无法解密 API Key，请在 LLM 设置中重新保存。') }
        }
        return {baseUrl: saved.baseUrl, model: saved.model, apiKey}
    }

    getDraftConnection(input: unknown, requireModel = true): {baseUrl: string; model: string; apiKey: string} {
        const result = validateLlmSettings(input, requireModel)
        if (!result.ok) throw new Error(result.error)
        const {baseUrl, model, apiKey, clearApiKey} = result.data
        const saved = this.db.getLlmSettings()
        if (apiKey || clearApiKey || !saved?.encryptedApiKey?.length) {
            return {baseUrl, model, apiKey: clearApiKey ? '' : apiKey}
        }
        if (new URL(saved.baseUrl).origin !== new URL(baseUrl).origin) {
            throw new Error('更换接口站点时，请重新输入 API Key 或勾选清除已保存的密钥。')
        }
        return {baseUrl, model, apiKey: this.getConnection().apiKey}
    }
}

import type {Result} from './accounts'

export interface LlmSettings {baseUrl: string; model: string; hasApiKey: boolean; enabled: boolean}
export interface LlmSettingsInput {baseUrl: string; model: string; apiKey: string; clearApiKey: boolean}
export interface LlmConnectionTest {elapsedMs: number}
export interface LlmAPI {
    get(): Promise<Result<LlmSettings>>
    setEnabled(enabled: boolean): Promise<Result<LlmSettings>>
    save(input: LlmSettingsInput): Promise<Result<LlmSettings>>
    test(input: LlmSettingsInput): Promise<Result<LlmConnectionTest>>
    models(input: LlmSettingsInput): Promise<Result<string[]>>
}

export const emptyLlmSettings = (): LlmSettings => ({baseUrl: '', model: '', hasApiKey: false, enabled: false})

export function validateLlmSettings(input: unknown, requireModel = true): Result<LlmSettingsInput> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok: false, error: 'LLM 设置格式无效。'}
    const value = input as Record<string, unknown>
    if (typeof value.baseUrl !== 'string' || !value.baseUrl.trim() || value.baseUrl.length > 2048) {
        return {ok: false, error: '请输入有效的接口地址。'}
    }
    let url: URL
    try { url = new URL(value.baseUrl.trim()) }
    catch { return {ok: false, error: '请输入有效的接口地址。'} }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        url.username || url.password || url.search || url.hash) {
        return {ok: false, error: '接口地址须使用 HTTPS；本机服务可使用 HTTP。网址不能包含账号、密码或查询参数。'}
    }
    if (/\/(chat\/completions|responses)\/?$/i.test(url.pathname)) {
        return {ok: false, error: '请输入基础接口地址，不要包含 /chat/completions 或 /responses。'}
    }
    if (typeof value.model !== 'string' || (requireModel && !value.model.trim()) || value.model.length > 200 || /[\x00-\x1f\x7f]/.test(value.model)) {
        return {ok: false, error: '请输入有效的模型名称（最多 200 个字符）。'}
    }
    if (typeof value.apiKey !== 'string' || value.apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(value.apiKey) ||
        typeof value.clearApiKey !== 'boolean' || (value.clearApiKey && value.apiKey.trim())) {
        return {ok: false, error: 'API Key 设置无效。'}
    }
    return {ok: true, data: {baseUrl: url.href.replace(/\/+$/, ''), model: value.model.trim(),
        apiKey: value.apiKey.trim(), clearApiKey: value.clearApiKey}}
}

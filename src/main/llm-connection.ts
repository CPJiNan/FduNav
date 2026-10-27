import type {LlmConnectionTest} from '../shared/llm'
import {defaultConnectionTestPrompt} from '../shared/llm-prompts'

export interface Connection {
    baseUrl: string;
    model: string;
    apiKey: string
}

export interface ChatMessage {
    role: 'system' | 'user';
    content: string
}

export interface ToolCall {
    id: string
    type: 'function'
    function: {name: string; arguments: string}
}
export type ToolChatMessage = ChatMessage | {role: 'assistant'; content: string | null; tool_calls?: ToolCall[]} |
    {role: 'tool'; tool_call_id: string; content: string}
export interface ChatTool {
    type: 'function'
    function: {name: string; description: string; parameters: Record<string, unknown>}
}

export async function completeLlmWithTools(connection: Connection, messages: ToolChatMessage[], tools: ChatTool[],
                                           signal: AbortSignal): Promise<Extract<ToolChatMessage, {role: 'assistant'}>> {
    const data = await requestLlmJson(connection, '/chat/completions', {
        method: 'POST', body: JSON.stringify({model: connection.model, messages, tools, tool_choice: 'auto', stream: false}),
    }, fetch, 60_000, signal)
    const payload = data as {error?: unknown; choices?: {message?: {content?: unknown; tool_calls?: unknown}}[]} | null
    const message = Array.isArray(payload?.choices) ? payload.choices[0]?.message : undefined
    if (payload?.error || !message) throw new Error('模型未返回有效回复，请确认模型支持工具调用。')
    const content = typeof message.content === 'string' ? message.content.slice(0, 16000) : null
    const calls = message.tool_calls ?? undefined
    if (calls !== undefined && (!Array.isArray(calls) || calls.length > 8 || calls.some(call =>
        !call || typeof call.id !== 'string' || !call.id || call.id.length > 200 || call.type !== 'function' ||
        typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string' ||
        call.function.arguments.length > 16000) || new Set(calls.map(call => call.id)).size !== calls.length)) {
        throw new Error('模型返回了无效的工具调用，请重试。')
    }
    if (!content?.trim() && !calls?.length) throw new Error('模型未返回有效回复。')
    return {role: 'assistant', content, ...(calls?.length ? {tool_calls: calls as ToolCall[]} : {})}
}

export async function completeLlm(connection: Connection, messages: ChatMessage[], signal: AbortSignal,
                                  request: typeof fetch = fetch): Promise<string> {
    const data = await requestLlmJson(connection, '/chat/completions', {
        method: 'POST', body: JSON.stringify({model: connection.model, messages, stream: false}),
    }, request, 60_000, signal)
    const payload = data as { error?: unknown; choices?: { message?: { content?: unknown } }[] } | null
    const content = Array.isArray(payload?.choices) ? payload.choices[0]?.message?.content : undefined
    if (payload?.error || typeof content !== 'string' || !content.trim()) throw new Error('模型未返回有效内容。')
    return content
}

function statusError(status: number): string {
    if (status === 401) return '认证失败，请检查 API Key（HTTP 401）。'
    if (status === 403) return '访问被拒绝，请检查账号或模型权限（HTTP 403）。'
    if (status === 404) return '未找到接口或模型，请检查接口地址和模型名称（HTTP 404）。'
    if (status === 429) return '请求受限，请检查额度或稍后重试（HTTP 429）。'
    if (status >= 500) return `模型服务暂时不可用（HTTP ${status}）。`
    return `请求失败，请检查接口地址、模型名称及接口兼容性（HTTP ${status}）。`
}

export async function testLlmConnection(connection: Connection, request: typeof fetch = fetch,
                                        timeoutMs = 30_000, enabledSignal?: AbortSignal,
                                        prompt = defaultConnectionTestPrompt): Promise<LlmConnectionTest> {
    const start = performance.now()
    const data = await requestLlmJson(connection, '/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
            model: connection.model,
            messages: [{role: 'user', content: prompt}],
            stream: false
        }),
    }, request, timeoutMs, enabledSignal)
    const payload = data as { error?: unknown; choices?: { message?: { content?: unknown } }[] } | null
    const content = Array.isArray(payload?.choices) ? payload.choices[0]?.message?.content : undefined
    if (payload?.error || typeof content !== 'string' || !content.trim()) {
        throw new Error('接口未返回有效的模型回复，请确认支持 Chat Completions。')
    }
    return {elapsedMs: Math.round(performance.now() - start)}
}

export async function fetchLlmModels(connection: Connection, request: typeof fetch = fetch,
                                     timeoutMs = 30_000, enabledSignal?: AbortSignal): Promise<string[]> {
    const data = await requestLlmJson(connection, '/models', {method: 'GET'}, request, timeoutMs, enabledSignal)
    const payload = data as { error?: unknown; data?: { id?: unknown }[] } | null
    if (payload?.error || !Array.isArray(payload?.data)) throw new Error('接口未返回有效的模型列表，请确认支持 /models。')
    const models = [...new Set(payload.data.map(item => item?.id).filter((id): id is string =>
        typeof id === 'string' && !!id.trim() && id.length <= 200 && !/[\x00-\x1f\x7f]/.test(id)))].sort()
    if (!models.length) throw new Error('该接口未返回可用模型。')
    return models
}

async function requestLlmJson(connection: Connection, path: string, init: RequestInit,
                              request: typeof fetch, timeoutMs: number, enabledSignal?: AbortSignal): Promise<unknown> {
    if (enabledSignal?.aborted) throw new Error('LLM 已停用。')
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = enabledSignal ? AbortSignal.any([timeout, enabledSignal]) : timeout
    let response: Response
    try {
        response = await request(`${connection.baseUrl}${path}`, {
            ...init, redirect: 'error', signal,
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json',
                ...(connection.apiKey ? {Authorization: `Bearer ${connection.apiKey}`} : {})
            },
        })
    } catch {
        if (enabledSignal?.aborted) throw new Error('LLM 已停用。')
        throw new Error(signal.aborted ? '连接超时，请稍后重试。' : '无法连接模型服务，请检查接口地址、网络或证书；接口不能重定向。')
    }
    if (!response.ok) {
        await response.body?.cancel().catch(() => {
        })

        throw new Error(statusError(response.status))
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('接口未返回有效内容。')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const {done, value} = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > 1024 * 1024) throw new Error('response too large')
            chunks.push(value)
        }
    } catch {
        if (enabledSignal?.aborted) throw new Error('LLM 已停用。')
        throw new Error(signal.aborted ? '连接超时，请稍后重试。' : '接口响应读取失败或内容过大。')
    } finally {
        await reader.cancel().catch(() => {
        })
        reader.releaseLock()
    }
    let data: unknown
    if (enabledSignal?.aborted) throw new Error('LLM 已停用。')
    try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
        throw new Error('接口未返回有效 JSON，请检查基础接口地址。')
    }
    return data
}

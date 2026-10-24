import type {LlmConnectionTest} from '../shared/llm'

interface Connection {baseUrl: string; model: string; apiKey: string}

function statusError(status: number): string {
    if (status === 401) return '认证失败，请检查 API Key（HTTP 401）。'
    if (status === 403) return '访问被拒绝，请检查账号或模型权限（HTTP 403）。'
    if (status === 404) return '未找到接口或模型，请检查接口地址和模型名称（HTTP 404）。'
    if (status === 429) return '请求受限，请检查额度或稍后重试（HTTP 429）。'
    if (status >= 500) return `模型服务暂时不可用（HTTP ${status}）。`
    return `请求失败，请检查接口地址、模型名称及接口兼容性（HTTP ${status}）。`
}

export async function testLlmConnection(connection: Connection, request: typeof fetch = fetch,
                                        timeoutMs = 30_000): Promise<LlmConnectionTest> {
    const start = performance.now()
    const data = await requestLlmJson(connection, '/chat/completions', {
        method: 'POST',
        body: JSON.stringify({model: connection.model, messages: [{role: 'user', content: 'Reply with only OK.'}], stream: false}),
    }, request, timeoutMs)
    const payload = data as {error?: unknown; choices?: {message?: {content?: unknown}}[]} | null
    const content = Array.isArray(payload?.choices) ? payload.choices[0]?.message?.content : undefined
    if (payload?.error || typeof content !== 'string' || !content.trim()) {
        throw new Error('接口未返回有效的模型回复，请确认支持 Chat Completions。')
    }
    return {elapsedMs: Math.round(performance.now() - start)}
}

export async function fetchLlmModels(connection: Connection, request: typeof fetch = fetch,
                                     timeoutMs = 30_000): Promise<string[]> {
    const data = await requestLlmJson(connection, '/models', {method: 'GET'}, request, timeoutMs)
    const payload = data as {error?: unknown; data?: {id?: unknown}[]} | null
    if (payload?.error || !Array.isArray(payload?.data)) throw new Error('接口未返回有效的模型列表，请确认支持 /models。')
    const models = [...new Set(payload.data.map(item => item?.id).filter((id): id is string =>
        typeof id === 'string' && !!id.trim() && id.length <= 200 && !/[\x00-\x1f\x7f]/.test(id)))].sort()
    if (!models.length) throw new Error('该接口未返回可用模型。')
    return models
}

async function requestLlmJson(connection: Connection, path: string, init: RequestInit,
                              request: typeof fetch, timeoutMs: number): Promise<unknown> {
    const signal = AbortSignal.timeout(timeoutMs)
    let response: Response
    try {
        response = await request(`${connection.baseUrl}${path}`, {
            ...init, redirect: 'error', signal,
            headers: {'Content-Type': 'application/json', Accept: 'application/json',
                ...(connection.apiKey ? {Authorization: `Bearer ${connection.apiKey}`} : {})},
        })
    } catch {
        throw new Error(signal.aborted ? '连接超时，请稍后重试。' : '无法连接模型服务，请检查接口地址、网络或证书；接口不能重定向。')
    }
    if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        // Do not expose provider error bodies: they may echo credentials or request data.
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
        throw new Error(signal.aborted ? '连接超时，请稍后重试。' : '接口响应读取失败或内容过大。')
    } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
    }
    let data: unknown
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new Error('接口未返回有效 JSON，请检查基础接口地址。') }
    return data
}

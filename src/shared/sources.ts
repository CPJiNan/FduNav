import type {Result} from './accounts'

export const sourcePresets = [
    {id: 'generic', name: '通用网页', url: ''},
    {id: 'jwc', name: '教务处', url: 'https://jwc.fudan.edu.cn/9397/list.htm'},
    {id: 'cec', name: '英语教学部', url: 'https://cec.fudan.edu.cn/23080/list.htm'},
] as const
export type SourcePresetId = typeof sourcePresets[number]['id']

export interface SourceInput {
    id?: string
    name: string
    url: string
    enabled: boolean
    preset: SourcePresetId
}

export interface MessageSource extends SourceInput {
    id: string
    revision: number
    listUrl: string | null
    updatedAt: string | null
    lastError: string | null
}

export interface SourcesAPI {
    list(): Promise<Result<MessageSource[]>>
    save(input: SourceInput): Promise<Result<MessageSource[]>>
    remove(id: string): Promise<Result<MessageSource[]>>
}

export const defaultSources = [
    {id: 'jwc', name: '教务处', url: 'https://jwc.fudan.edu.cn/9397/list.htm', enabled: true, preset: 'jwc'},
    {id: 'cec', name: '英语教学部', url: 'https://cec.fudan.edu.cn/23080/list.htm', enabled: true, preset: 'cec'},
] as const

export function sourceUrl(value: string): string {
    let url: URL
    try { url = new URL(value) } catch { throw new Error('请输入有效的网址。') }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
        throw new Error('消息来源需要使用 HTTPS 网址。')
    }
    const host = url.hostname.toLowerCase()
    if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local') ||
        host.endsWith('.internal') || host.startsWith('[') || /^[\d.]+$/.test(host)) {
        throw new Error('请输入公开网站的域名。')
    }
    url.hash = ''
    return url.href
}

export function validateSource(input: unknown): Result<SourceInput> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok: false, error: '来源格式无效。'}
    const value = input as Record<string, unknown>
    if (value.id !== undefined && (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(value.id))) {
        return {ok: false, error: '来源标识无效。'}
    }
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60) {
        return {ok: false, error: '来源名称须为 1—60 个字符。'}
    }
    if (typeof value.enabled !== 'boolean' || typeof value.url !== 'string' || value.url.length > 2048) {
        return {ok: false, error: '来源设置无效。'}
    }
    if (!sourcePresets.some(preset => preset.id === value.preset)) return {ok: false, error: '请选择有效的读取预设。'}
    try {
        return {ok: true, data: {id: value.id as string | undefined, name: value.name.trim(), url: sourceUrl(value.url.trim()), enabled: value.enabled, preset: value.preset as SourcePresetId}}
    } catch (error) {
        return {ok: false, error: (error as Error).message}
    }
}

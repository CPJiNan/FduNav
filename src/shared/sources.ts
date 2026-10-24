import type {Result} from './accounts'

export const defaultSources = [
    {id: 'jwc', name: '教务处', url: 'https://jwc.fudan.edu.cn/9397/list.htm', enabled: true},
    {id: 'gs', name: '研究生院', url: 'https://gs.fudan.edu.cn/tzgg/list.htm', enabled: false},
    {id: 'bwc', name: '保卫处', url: 'https://baoweichu.fudan.edu.cn/6707/list.htm', enabled: false},
    {id: 'zwc', name: '总务处', url: 'https://zongwuchu.fudan.edu.cn/16531/list.htm', enabled: false},
    {id: 'cwc', name: '财务处', url: 'https://cwc.fudan.edu.cn/12185/list.htm', enabled: false},
    {id: 'cec', name: '英语教学部', url: 'https://cec.fudan.edu.cn/23080/list.htm', enabled: false},
] as const

export type SourceId = typeof defaultSources[number]['id']

export interface MessageSource {
    id: SourceId
    name: string
    url: string
    enabled: boolean
    revision: number
    listUrl: string | null
    updatedAt: string | null
    lastError: string | null
}

export interface SourcesAPI {
    list(): Promise<Result<MessageSource[]>>

    setEnabled(id: SourceId, enabled: boolean): Promise<Result<MessageSource[]>>
}

export function isSourceId(value: unknown): value is SourceId {
    return typeof value === 'string' && defaultSources.some(source => source.id === value)
}

export function sourceUrl(value: string): string {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new Error('请输入有效的网址。')
    }
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

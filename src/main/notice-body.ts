import type {AnyNode} from 'domhandler'
import type {NoticeBodyNode, NoticeBodyTag} from '../shared/notices'
import {sourceUrl} from '../shared/sources.ts'

const allowedTags = new Set<NoticeBodyTag>(['p', 'div', 'span', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's',
    'sub', 'sup', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'blockquote',
    'h2', 'h3', 'h4', 'figure', 'figcaption', 'pre'])
const discardedTags = new Set(['script', 'style', 'iframe', 'noscript', 'object', 'embed', 'svg', 'canvas',
    'input', 'button', 'select', 'textarea', 'video', 'audio', 'template'])

export function noticeImageUrl(raw: string, baseUrl: string): string | null {
    try {
        const url = new URL(raw.trim(), baseUrl)
        if (url.protocol === 'http:' && (url.hostname === 'fudan.edu.cn' || url.hostname.endsWith('.fudan.edu.cn'))) url.protocol = 'https:'
        return sourceUrl(url.href)
    } catch {
        return null
    }
}

export function parseNoticeBody(nodes: AnyNode[], baseUrl?: string): NoticeBodyNode[] {
    let count = 0
    const visit = (node: AnyNode, depth: number): NoticeBodyNode[] => {
        if (++count > 20_000 || depth > 64) return []
        if (node.type === 'text') return [{type: 'text', text: node.data}]
        if (node.type !== 'tag') return []
        const attrs = node.attribs
        const style = attrs.style ?? ''
        if (discardedTags.has(node.name) || 'hidden' in attrs ||
            /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(style)) return []
        const dimension = (name: string): number | undefined => {
            const raw = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px\\b`, 'i').exec(style)?.[1] ?? attrs[name]
            if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return undefined
            return Math.min(10_000, Number(raw))
        }
        if (node.name === 'img') {
            if (!baseUrl) return []
            const width = dimension('width'), height = dimension('height')
            if (width === 0 || height === 0) return []
            // WebPlus and common lazy loaders keep the actual image outside src.
            const candidates = [attrs['data-original'], attrs['data-src'], attrs['data-lazy-src'], attrs.src]
            const url = candidates.filter(Boolean).map(raw => noticeImageUrl(raw, baseUrl)).find(Boolean)
            return url ? [{type: 'image', url, alt: (attrs.alt ?? attrs.title ?? '').slice(0, 500), width, height}] : []
        }
        const children = node.children.flatMap(child => visit(child, depth + 1))
        const tag = (node.name === 'h1' ? 'h2' : node.name) as NoticeBodyTag
        if (!allowedTags.has(tag)) return children
        const align = /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\b/i.exec(style)?.[1]?.toLowerCase() ?? attrs.align?.toLowerCase()
        const cellSpan = (value?: string) => value && /^\d+$/.test(value) ? Math.max(1, Math.min(100, Number(value))) : undefined
        return [{
            type: 'element', tag, children,
            ...(['left', 'center', 'right', 'justify'].includes(align) ? {align: align as 'left' | 'center' | 'right' | 'justify'} : {}),
            ...(['td', 'th'].includes(tag) ? {colSpan: cellSpan(attrs.colspan), rowSpan: cellSpan(attrs.rowspan)} : {})
        }]
    }
    return nodes.flatMap(node => visit(node, 0))
}

export function noticeImageUrls(body: NoticeBodyNode[]): string[] {
    return body.flatMap(node => node.type === 'image' ? [node.url] : node.type === 'element' ? noticeImageUrls(node.children) : [])
}

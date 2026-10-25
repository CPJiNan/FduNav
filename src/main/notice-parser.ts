import {load} from 'cheerio'
import type {NoticeDetail, ParsedNotice} from '../shared/notices'
import type {SourceId} from '../shared/sources'
import {sourceReadingRules} from './source-reading-rules.ts'
import {noticeImageUrls, parseNoticeBody} from './notice-body.ts'

export function parseNotices(html: string, baseUrl: string, sourceId: SourceId,
                             allowMissingDate = false): ParsedNotice[] {
    const $ = load(html)
    const rule = sourceReadingRules[sourceId]
    const origin = new URL(baseUrl).origin
    const found = new Map<string, ParsedNotice>()
    $(rule.link).each((_index, element) => {
        const link = $(element), row = link.closest(rule.row)
        if (!row.length) return
        const links = row.find(rule.link)
        if (new Set(links.map((_i, a) => $(a).attr('href')).get()).size !== 1) return
        const copy = row.clone();
        copy.find('a').remove()
        const dateText = rule.date ? row.find(rule.date).toArray().map(element => $(element).text()).join(' ') : ''
        const text = `${copy.text()} ${dateText} ${copy.find('time[datetime]').attr('datetime') ?? ''}`
        const dates = [...new Set([...text.matchAll(/(?<!\d)(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?!\d)/g)]
            .map(match => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`))]
        if (dates.length > 1 || (dates.length === 0 && !allowMissingDate)) return
        const published = dates[0] ?? ''
        if (published) {
            const date = new Date(published)
            if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== published) return
        }
        let url: URL
        try {
            url = new URL(link.attr('href')!, baseUrl)
        } catch {
            return
        }
        const external = rule.external && (url.hostname === 'fudan.edu.cn' || url.hostname.endsWith('.fudan.edu.cn'))
        if (url.protocol !== 'https:' || (url.origin !== origin && !external) || url.username || url.password || url.port ||
            /\.(?:pdf|docx?|xlsx?|zip|jpe?g|png)(?:$|\?)/i.test(url.pathname)) return
        url.hash = ''
        const title = (rule.title ? row.find(rule.title).first().text() : (link.attr('title') || link.text())).trim()
        if (title) found.set(url.href, {url: url.href, title, published})
    })
    return [...found.values()].sort((a, b) => b.published.localeCompare(a.published) || a.title.localeCompare(b.title, 'zh-CN'))
}

export function parseNoticeDate(html: string, selector: string): string | null {
    const $ = load(html)
    const text = $(selector).first().text().replace(/\s+/g, ' ')
    const match = /(?<!\d)(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?!\d)/.exec(text)
    if (!match) return null
    const published = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    const date = new Date(published)
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== published ? null : published
}

export function discoverNoticeLists(html: string, baseUrl: string): string[] {
    const $ = load(html)
    const base = new URL(baseUrl)
    const candidates = new Set<string>()
    $('a[href]').each((_index, element) => {
        const link = $(element)
        const isColumnTitle = (text: string) => /^(?:通知公告|公告通知|通知|公告|通知中心|通知列表|通知通告|notices?|announcements?)$/i.test(text.replace(/\s+/g, ''))
        let matched = isColumnTitle(link.text()) || isColumnTitle(link.attr('title') ?? '')
        if (!matched && /更多|more/i.test(`${link.text()} ${link.attr('class') ?? ''}`)) {
            matched = link.parents().slice(0, 4).toArray().some(parent => {
                const headings = $(parent).find('h1, h2, h3, .title, .tit')
                return headings.length <= 3 && /通知|公告/.test(headings.text())
            })
        }
        if (!matched) return
        try {
            const url = new URL(link.attr('href')!, base)
            url.hash = ''
            if (url.origin === base.origin && url.href !== base.href && !url.username && !url.password &&
                !/page\.htm|\.(?:pdf|docx?|xlsx?|zip)$/i.test(url.pathname)) candidates.add(url.href)
        } catch {
        }
    })
    return [...candidates].slice(0, 3)
}

export function parseNoticeDetail(html: string, baseUrl: string | undefined, sourceId: SourceId): NoticeDetail | null {
    const $ = load(html)
    const rule = sourceReadingRules[sourceId]
    const article = $(rule.article).first()
    if (!article.length) return null
    const attachments: NoticeDetail['attachments'] = []
    if (baseUrl) article.find(rule.pdf).each((_index, element) => {
        const item = $(element)
        const raw = item.attr('pdfsrc') ?? item.attr('href') ?? item.attr('src') ?? item.attr('data')
        if (!raw) return
        try {
            let url = new URL(raw, baseUrl)

            const file = url.searchParams.get('file')
            if (file) url = new URL(file, url)
            if (url.protocol !== 'https:' || url.origin !== new URL(baseUrl).origin || url.username || url.password ||
                !url.pathname.toLowerCase().endsWith('.pdf') || attachments.some(attachment => attachment.url === url.href)) return
            const metadata = item.attr('sudyfile-attr') ?? ''
            const name = /['"]title['"]\s*:\s*['"]([^'"]+)['"]/.exec(metadata)?.[1] || item.attr('title') || item.text().trim() || 'PDF 附件'
            attachments.push({url: url.href, name: name.slice(0, 200)})
        } catch {
        }
    })
    const body = parseNoticeBody(article.contents().toArray(), baseUrl)
    article.find('script, style, iframe, noscript').remove()
    const imageCount = noticeImageUrls(body).length
    article.find('br').replaceWith('\n')
    article.find('td, th').append('\t')
    article.find('p, div, li, tr, h1, h2, h3, h4').append('\n')
    const content = article.text().replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    return content || imageCount || attachments.length ? {
        content,
        body,
        imageCount,
        requiresLogin: false,
        attachments
    } : null
}

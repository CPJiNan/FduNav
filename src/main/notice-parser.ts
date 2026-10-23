import {load} from 'cheerio'
import type {Notice, NoticeDetail} from '../shared/notices'

export function parseNotices(html: string, baseUrl: string): Notice[] {
    const $ = load(html)
    const found = new Map<string, Notice>()
    $('a[href*="page.htm"]').each((_index, element) => {
        const link = $(element), row = link.closest('li, tr')
        if (!row.length) return
        const links = row.find('a[href*="page.htm"]')
        if (new Set(links.map((_i, a) => $(a).attr('href')).get()).size !== 1) return
        const copy = row.clone();
        copy.find('a').remove()
        const dates = [...new Set(copy.text().match(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g) ?? [])]
        if (dates.length !== 1) return
        const published = dates[0]
        const date = new Date(published)
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== published) return
        let url: URL
        try {
            url = new URL(link.attr('href')!, baseUrl)
        } catch {
            return
        }
        if (url.protocol !== 'https:' || url.hostname !== 'jwc.fudan.edu.cn' || url.username || url.password || url.port) return
        const title = (link.attr('title') || link.text()).trim()
        if (title) found.set(url.href, {url: url.href, title, published})
    })
    return [...found.values()].sort((a, b) => b.published.localeCompare(a.published) || a.title.localeCompare(b.title, 'zh-CN'))
}

export function parseNoticeDetail(html: string): NoticeDetail | null {
    const $ = load(html)
    const article = $('.wp_articlecontent, #vsb_content, .v_news_content, article').first()
    if (!article.length) return null
    article.find('script, style, iframe, noscript').remove()
    const imageCount = article.find('img').length
    article.find('br').replaceWith('\n')
    article.find('td, th').append('\t')
    article.find('p, div, li, tr, h1, h2, h3, h4').append('\n')
    const content = article.text().replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    return content || imageCount ? {content, imageCount, requiresLogin: false} : null
}

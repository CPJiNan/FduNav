import type {SourcePresetId} from '../shared/sources'

interface ReadingRule {
    link: string
    row: string
    article: string
    pdf: string
}

export const sourceReadingRules: Record<SourcePresetId, ReadingRule> = {
    generic: {
        link: 'a[href]',
        row: 'li, tr, article, .news-item, .list-item',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article, .article-content, .entry-content',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    jwc: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    cec: {
        link: 'a[href*="page.htm"]',
        row: 'li.list_item, li.news, li, tr',
        article: '.wp_articlecontent, .entry .read',
        pdf: '.wp_pdf_player[pdfsrc], [pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
}

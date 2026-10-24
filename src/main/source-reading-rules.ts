import type {SourceId} from '../shared/sources'

interface ReadingRule {
    link: string
    row: string
    article: string
    pdf: string

    detailDate?: string
}

export const sourceReadingRules: Record<SourceId, ReadingRule> = {
    jwc: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    gs: {
        link: 'a[href*="page.htm"]',
        row: 'li.list_item, li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, .entry .read, article',
        pdf: '.wp_pdf_player[pdfsrc], [pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    bwc: {
        link: 'a[href*="page.htm"]',
        row: 'li.list_item, li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        detailDate: '.Article_PublishDate',
    },
    zwc: {
        link: 'a[href*="page.htm"]',
        row: 'li.list_item, li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    cwc: {
        link: 'a[href*="page.htm"]',
        row: 'li.list_item, li.news, li, tr',
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

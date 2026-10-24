import type {SourceId} from '../shared/sources'

interface ReadingRule {
    link: string
    row: string
    article: string
    pdf: string
    title?: string
    date?: string
    detailDate?: string
    external?: boolean
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
    som: {
        link: 'a[href*="page.htm"]',
        row: 'div.column-news-item, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    chinese: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    dfll: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    xwxy: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    history: {
        link: 'a[href*="info/"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        date: 'span',
    },
    philosophy: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        date: 'span',
    },
    sirpa: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    math: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    phys: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        detailDate: '.Article_PublishDate',
    },
    chemistry: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    law: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        external: true,
    },
    imp: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        detailDate: '.newsInfoTit',
    },
    polymer: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    tourism: {
        link: 'a[href*="info/"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        date: 'span',
    },
    chm: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    fisf: {
        link: 'a[href*="show-"]',
        row: 'li.clearfix, li, tr',
        article: '.detail_con, .wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    econ: {
        link: 'a[href*="info/"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    life: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    environment: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    fdty: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    ices: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    sds: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    xianghui: {
        link: 'a.con[href*="/detail/"]',
        row: 'li.li1, li',
        article: '.main, .m-text, .article, .detail, .txt, .content, .wp_articlecontent, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        title: 'h3',
        date: '.date',
    },
    basicmed: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    sph: {
        link: 'a[href*="/a/"]',
        row: 'li, tr',
        article: '.a-htm, .wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        title: 'a',
    },
    spfdu: {
        link: 'a[href*="page.htm"]',
        row: 'div.jzlb, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    nursing: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    sfms: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    atmsci: {
        link: 'a[href*="page.htm"]',
        row: 'li, tr',
        article: '.content, .wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
    },
    icmne: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        detailDate: '.arti_update',
    },
    ai: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        detailDate: '.arti_update',
    },
    bme: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        title: '.news_title',
        detailDate: '.arti_update',
    },
    ciram: {
        link: 'a[href*="page.htm"]',
        row: 'li.news, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        detailDate: '.arti_info',
    },
    icome: {
        link: 'a[href*="page.htm"]',
        row: 'div.newic-li, li, tr',
        article: '.wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        title: '.li-tt',
        detailDate: '.view-info',
    },
    fit: {
        link: 'a[href*="/Data/View/"]',
        row: 'li, tr',
        article: '.main-right, .right-nr, .wp_articlecontent, #vsb_content, .v_news_content, article',
        pdf: '[pdfsrc], a[href], iframe[src], embed[src], object[data]',
        title: '.data-tt',
        detailDate: '.view-info',
    },
}

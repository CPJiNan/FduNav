import type {Result} from './accounts'

export const defaultSources = [
    {id: 'jwc', name: '教务处', url: 'https://jwc.fudan.edu.cn/9397/list.htm', enabled: true},
    {id: 'gs', name: '研究生院', url: 'https://gs.fudan.edu.cn/tzgg/list.htm', enabled: false},
    {id: 'bwc', name: '保卫处', url: 'https://baoweichu.fudan.edu.cn/6707/list.htm', enabled: false},
    {id: 'zwc', name: '总务处', url: 'https://zongwuchu.fudan.edu.cn/16531/list.htm', enabled: false},
    {id: 'cwc', name: '财务处', url: 'https://cwc.fudan.edu.cn/12185/list.htm', enabled: false},
    {id: 'cec', name: '英语教学部', url: 'https://cec.fudan.edu.cn/23080/list.htm', enabled: false},
    {id: 'som', name: '马克思主义学院', url: 'https://som.fudan.edu.cn/15048/list.htm', enabled: false},
    {id: 'chinese', name: '中国语言文学系', url: 'https://chinese.fudan.edu.cn/tzgg/list.htm', enabled: false},
    {id: 'dfll', name: '外国语言文学学院', url: 'https://dfll.fudan.edu.cn/27751/list.htm', enabled: false},
    {id: 'xwxy', name: '新闻学院', url: 'https://xwxy.fudan.edu.cn/ggl/list.htm', enabled: false},
    {id: 'history', name: '历史学系', url: 'https://history.fudan.edu.cn/xwzx/tzgg.htm', enabled: false},
    {id: 'philosophy', name: '哲学学院', url: 'https://philosophy.fudan.edu.cn/tzgg_20877/list.htm', enabled: false},
    {id: 'sirpa', name: '国际关系与公共事务学院', url: 'https://sirpa.fudan.edu.cn/35036/list.htm', enabled: false},
    {id: 'math', name: '数学科学学院', url: 'https://math.fudan.edu.cn/30286/list.htm', enabled: false},
    {id: 'phys', name: '物理学系', url: 'https://phys.fudan.edu.cn/7453/list.htm', enabled: false},
    {id: 'chemistry', name: '化学系', url: 'https://chemistry.fudan.edu.cn/45208/list.htm', enabled: false},
    {id: 'law', name: '法学院', url: 'https://law.fudan.edu.cn/28093/list.htm', enabled: false},
    {id: 'imp', name: '核科学与技术系', url: 'https://imp.fudan.edu.cn/48897/list.htm', enabled: false},
    {id: 'polymer', name: '高分子科学系', url: 'https://polymer.fudan.edu.cn/31394/list.htm', enabled: false},
    {id: 'tourism', name: '旅游学系', url: 'https://tourism.fudan.edu.cn/xwzx/tzgg.htm', enabled: false},
    {id: 'chm', name: '文物与博物馆学系', url: 'https://www.chm.fudan.edu.cn/tzgg/list.htm', enabled: false},
    {id: 'fisf', name: '国际金融学院', url: 'https://fisf.fudan.edu.cn/lists-notice.html', enabled: false},
    {id: 'econ', name: '经济学院', url: 'https://econ.fudan.edu.cn/xwzx/tzgg.htm', enabled: false},
    {id: 'life', name: '生命科学学院', url: 'https://life.fudan.edu.cn/28139/list.htm', enabled: false},
    {
        id: 'environment',
        name: '环境科学与工程系',
        url: 'https://environment.fudan.edu.cn/26493/list.htm',
        enabled: false
    },
    {id: 'fdty', name: '体育教学部', url: 'https://fdty.fudan.edu.cn/29222/list.htm', enabled: false},
    {id: 'ices', name: '国际文化交流学院', url: 'https://ices.fudan.edu.cn/6758/list.htm', enabled: false},
    {id: 'sds', name: '大数据学院', url: 'https://sds.fudan.edu.cn/zytz/list.htm', enabled: false},
    {id: 'xianghui', name: '相辉学堂', url: 'https://xianghui.fudan.edu.cn/cate/81', enabled: false},
    {id: 'basicmed', name: '基础医学院', url: 'https://basicmed.fudan.edu.cn/30927/list.htm', enabled: false},
    {id: 'sph', name: '公共卫生学院', url: 'https://sph.fudan.edu.cn/ac/7', enabled: false},
    {id: 'spfdu', name: '药学院', url: 'https://spfdu.fudan.edu.cn/28477/list.htm', enabled: false},
    {id: 'nursing', name: '护理学院', url: 'https://nursing.fudan.edu.cn/tzgg/list.htm', enabled: false},
    {id: 'sfms', name: '法医学与法庭科学学院', url: 'https://sfms.fudan.edu.cn/51779/list.htm', enabled: false},
    {id: 'atmsci', name: '大气与海洋科学系', url: 'https://atmsci.fudan.edu.cn/annoucement/list.htm', enabled: false},
    {id: 'icmne', name: '集成电路与微纳电子创新学院', url: 'https://icmne.fudan.edu.cn/tzgg/list.htm', enabled: false},
    {id: 'ai', name: '计算与智能创新学院', url: 'https://ai.fudan.edu.cn/24257/list.htm', enabled: false},
    {
        id: 'bme',
        name: '生物医学工程与技术创新学院',
        url: 'https://bme-college.fudan.edu.cn/tzgg/list.htm',
        enabled: false
    },
    {
        id: 'ciram',
        name: '智能机器人与先进制造创新学院',
        url: 'https://ciram.fudan.edu.cn/tzgg/list.htm',
        enabled: false
    },
    {id: 'icome', name: '智能材料与未来能源创新学院', url: 'https://icome.fudan.edu.cn/49262/list.htm', enabled: false},
    {id: 'fit', name: '未来信息创新学院', url: 'https://fit.fudan.edu.cn/Data/List/event', enabled: false},
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

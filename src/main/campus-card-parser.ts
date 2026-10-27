import {load} from 'cheerio'
import {AuthError} from './fudan-auth'

export function parseCampusCardBalance(html: string): string {
    const $ = load(html)
    if (!$('.custname').text().trim()) {
        throw new AuthError('未能读取校园卡账户，请点击刷新并完成学校身份验证。')
    }
    const text = $('.payway-box-bottom-item > p').first().text().replace(/\s/g, '')
    const match = /^(?:[¥￥]|CNY|RMB)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:元)?$/i.exec(text)
    if (!match) throw new AuthError('无法识别校园卡余额，学校页面可能已更新，请稍后重试。')
    const amount = Number(match[1].replace(/,/g, ''))
    if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100) {
        throw new AuthError('校园卡余额格式无效，请稍后重试。')
    }
    return amount.toFixed(2)
}

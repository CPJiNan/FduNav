import {randomUUID} from 'node:crypto'
import {clearInterval, clearTimeout, setInterval, setTimeout} from 'node:timers'
import {BrowserWindow, session} from 'electron'
import type {CookieJar} from 'tough-cookie'
import {browserCookieJar, browserCookies} from './auth-cookies'
import {AuthError, isAuthUrl, validateUrl} from './fudan-auth'
import {parseCampusCardBalance} from './campus-card-parser'

const entryUrl = 'https://ecard.fudan.edu.cn/epay'
const balanceUrl = 'https://ecard.fudan.edu.cn/epay/myepay/index'
const cardOrigin = new URL(entryUrl).origin

export async function readCampusCardWithBrowser(jar: CookieJar, interactive: boolean, parent?: BrowserWindow) {
    const reader = session.fromPartition(`fdunav-card-${randomUUID()}`, {cache: false})
    reader.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    reader.setPermissionCheckHandler(() => false)
    reader.on('will-download', event => event.preventDefault())
    let window: BrowserWindow | undefined
    try {
        for (const cookie of browserCookies(jar)) await reader.cookies.set(cookie)
        if (parent?.isDestroyed()) throw new AuthError('已取消校园卡查询。')
        const cardWindow = new BrowserWindow({
            show: false, width: 1100, height: 820, minWidth: 480, minHeight: 540,
            title: '校园卡身份验证', autoHideMenuBar: true,
            ...(parent ? {parent, modal: interactive} : {}),
            webPreferences: {session: reader, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false},
        })
        window = cardWindow
        cardWindow.setMenu(null)
        return await new Promise<{balance: string; jar: CookieJar}>((resolve, reject) => {
            let settled = false
            let checking = false
            let ready = false
            let authSince = 0
            let cardSince = 0
            let detailRequested = false
            let parseError = ''
            const finish = (error?: AuthError, result?: {balance: string; jar: CookieJar}) => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                clearInterval(poll)
                parent?.removeListener('closed', cancel)
                if (!cardWindow.isDestroyed()) cardWindow.destroy()
                if (error) reject(error)
                else resolve(result!)
            }
            const cancel = () => finish(new AuthError('已取消校园卡身份验证。'))
            const timeout = interactive
                ? setTimeout(() => finish(new AuthError('校园卡身份验证超时，请重新刷新。')), 300_000)
                : setTimeout(() => finish(new AuthError('校园卡查询超时，请点击刷新重试。')), 30_000)
            const allowed = (url: string) => {
                try { validateUrl(url); return true } catch { return false }
            }
            const navigate = (url: string) => {
                ready = false
                void cardWindow.loadURL(url).catch(error => {
                    if (!settled && error?.code !== 'ERR_ABORTED') finish(new AuthError('无法加载校园卡网站，请检查网络后重试。'))
                })
            }
            const check = async () => {
                if (settled || checking || !ready || cardWindow.isDestroyed()) return
                const current = cardWindow.webContents.getURL()
                if (!allowed(current)) return
                if (isAuthUrl(current)) {
                    if (interactive) {
                        if (!cardWindow.isVisible()) { cardWindow.show(); cardWindow.focus() }
                    } else {
                        authSince ||= Date.now()
                        if (Date.now() - authSince >= 2000) finish(new AuthError('校园卡需要身份验证，请点击刷新后完成验证。'))
                    }
                    return
                }
                if (new URL(current).origin !== cardOrigin) return
                checking = true
                cardSince ||= Date.now()
                try {
                    // Read the authenticated DOM even if unrelated images or subframes are still loading.
                    const html: unknown = await cardWindow.webContents.executeJavaScript('document.documentElement.outerHTML')
                    if (settled || cardWindow.isDestroyed() || cardWindow.webContents.getURL() !== current) return
                    if (typeof html !== 'string') return
                    let balance: string
                    try {
                        balance = parseCampusCardBalance(html)
                    } catch (error) {
                        parseError = error instanceof AuthError ? error.message : '无法读取校园卡余额。'
                        if (!detailRequested && new URL(current).pathname !== '/epay/myepay/index') {
                            detailRequested = true
                            cardSince = Date.now()
                            navigate(balanceUrl)
                        } else if (Date.now() - cardSince >= 10_000) finish(new AuthError(parseError))
                        return
                    }
                    const cookies = await browserCookieJar(await reader.cookies.get({}))
                    finish(undefined, {balance, jar: cookies})
                } catch {
                    if (!settled && Date.now() - cardSince >= 10_000) finish(new AuthError('无法读取校园卡页面，请刷新重试。'))
                } finally {
                    checking = false
                }
            }
            const poll = setInterval(() => void check(), 500)
            parent?.once('closed', cancel)
            cardWindow.once('closed', cancel)
            cardWindow.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
            cardWindow.webContents.on('will-frame-navigate', event => {
                if (event.isMainFrame && !allowed(event.url)) {
                    event.preventDefault()
                    finish(new AuthError('校园卡跳转到了非 HTTPS 复旦地址，已停止查询。'))
                }
            })
            cardWindow.webContents.on('will-redirect', (event, url, _inPlace, mainFrame) => {
                if (mainFrame && !allowed(url)) {
                    event.preventDefault()
                    finish(new AuthError('校园卡跳转到了非 HTTPS 复旦地址，已停止查询。'))
                }
            })
            cardWindow.webContents.on('dom-ready', () => { ready = true; void check() })
            cardWindow.webContents.on('did-navigate-in-page', () => { void check() })
            cardWindow.webContents.on('render-process-gone', () => finish(new AuthError('校园卡认证窗口异常退出，请重试。')))
            cardWindow.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
                if (mainFrame && code !== -3) finish(new AuthError('无法加载校园卡网站，请检查网络后重试。'))
            })
            navigate(entryUrl)
        })
    } finally {
        if (window && !window.isDestroyed()) window.destroy()
        await reader.clearStorageData().catch(() => {})
        await reader.closeAllConnections().catch(() => {})
    }
}

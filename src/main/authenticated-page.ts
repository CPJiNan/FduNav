import {BrowserWindow, session, type Session} from 'electron'
import type {CookieJar} from 'tough-cookie'
import {isAuthUrl, validateUrl} from './fudan-auth'
import {fetchNoticeImage, imageDataUrl} from './notice-image'
import {requestSourceImage} from './source-fetch'

const PARTITION = 'fdunav-reader'
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function clearReaderSession() {
    await session.fromPartition(PARTITION).clearStorageData({storages: ['cookies']})
}

interface SerializedCookie {
    key: string
    value: string
    domain?: string
    path?: string
    hostOnly?: boolean
    secure?: boolean
    httpOnly?: boolean
    expires?: string
}

async function seedCookies(jar: CookieJar, target: Session) {
    const serialized = jar.serializeSync()
    const cookies = (serialized?.cookies ?? []) as unknown as SerializedCookie[]
    for (const cookie of cookies) {
        const host = (cookie.domain || '').replace(/^\./, '')
        if (!host) continue
        const expires = cookie.expires && cookie.expires !== 'Infinity' ? new Date(cookie.expires) : null
        try {
            await target.cookies.set({
                url: `https://${host}${cookie.path || '/'}`,
                name: cookie.key,
                value: cookie.value,
                ...(cookie.hostOnly ? {} : {domain: cookie.domain}),
                path: cookie.path || '/',
                secure: cookie.secure !== false,
                httpOnly: !!cookie.httpOnly,
                ...(expires && !Number.isNaN(expires.getTime()) ? {expirationDate: expires.getTime() / 1000} : {}),
            })
        } catch {
        }
    }
}

export async function readAuthenticatedImage(url: string, referer: string, jar: CookieJar | null): Promise<string> {
    const host = new URL(url).hostname
    if (host !== 'fudan.edu.cn' && !host.endsWith('.fudan.edu.cn')) {
        return imageDataUrl(await requestSourceImage(url, referer))
    }
    const reader = session.fromPartition(PARTITION)
    if (jar) await seedCookies(jar, reader)
    return fetchNoticeImage(url, referer, (input, init) => reader.fetch(validateUrl(input), init))
}

export async function readAuthenticatedPage(value: string, jar: CookieJar | null): Promise<string | null> {
    if (!jar) return null
    const url = validateUrl(value)
    const targetHost = new URL(url).hostname
    const reader = session.fromPartition(PARTITION)
    await seedCookies(jar, reader)
    const window = new BrowserWindow({
        show: false,
        webPreferences: {session: reader, sandbox: true, contextIsolation: true, nodeIntegration: false},
    })
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
    window.webContents.on('will-navigate', (event, next) => {
        try {
            validateUrl(next)
        } catch {
            event.preventDefault()
        }
    })
    try {
        void window.loadURL(url).catch(() => {
        })
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
            if (window.isDestroyed()) return null
            const current = window.webContents.getURL()
            if (current && !window.webContents.isLoading() && !isAuthUrl(current) &&
                new URL(current).hostname === targetHost) {
                const html: unknown = await window.webContents.executeJavaScript('document.documentElement.outerHTML')
                return typeof html === 'string' ? html : null
            }
            await wait(250)
        }
        return null
    } catch {
        return null
    } finally {
        if (!window.isDestroyed()) window.destroy()
    }
}

export async function readExamPage(jar: CookieJar | null): Promise<string | null> {
    if (!jar) return null
    const reader = session.fromPartition(PARTITION)
    await seedCookies(jar, reader)
    const window = new BrowserWindow({
        show: false,
        webPreferences: {session: reader, sandbox: true, contextIsolation: true, nodeIntegration: false},
    })
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
    try {
        await window.loadURL('https://fdjwgl.fudan.edu.cn/student/home')
        await wait(1000)
        const clickDeadline = Date.now() + 6_000
        while (Date.now() < clickDeadline) {
            const clicked = await window.webContents.executeJavaScript(`(() => {
                const link = [...document.querySelectorAll('a')]
                    .find(item => (item.textContent || '').includes('考试信息'))
                if (link) {
                    link.click()
                    return true
                }
                return false
            })()`).catch(() => false)
            if (clicked) break
            await wait(250)
        }
        const deadline = Date.now() + 20_000
        while (Date.now() < deadline) {
            if (window.isDestroyed()) return null
            const html: unknown = await window.webContents.executeJavaScript(`(() => {
                for (const frame of document.querySelectorAll('iframe')) {
                    try {
                        if ((frame.getAttribute('src') || '').includes('exam-arrange') && frame.contentDocument) {
                            return frame.contentDocument.documentElement.outerHTML
                        }
                    } catch {
                    }
                }
                return null
            })()`).catch(() => null)
            if (typeof html === 'string' && /\d{4}[-/.年]\d{1,2}/.test(html) &&
                (html.includes('考试') || html.includes('考场'))) {
                return html
            }
            await wait(500)
        }
        return null
    } catch {
        return null
    } finally {
        if (!window.isDestroyed()) window.destroy()
    }
}

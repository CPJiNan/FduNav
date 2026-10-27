import type {Cookie as BrowserCookie, CookiesSetDetails} from 'electron'
import {Cookie, CookieJar} from 'tough-cookie'

const schoolDomain = (domain: string) => domain === 'fudan.edu.cn' || domain.endsWith('.fudan.edu.cn')

export function browserCookies(jar: CookieJar): CookiesSetDetails[] {
    return (jar.serializeSync()?.cookies ?? []).flatMap<CookiesSetDetails>(value => {
        const cookie = Cookie.fromJSON(value)
        const domain = cookie?.domain?.replace(/^\./, '')
        if (!cookie || !domain || !schoolDomain(domain)) return []
        const expires = cookie.expiryTime() ?? Infinity
        if (expires <= Date.now()) return []
        return [{
            url: `https://${domain}${cookie.path || '/'}`,
            name: cookie.key,
            value: cookie.value,
            ...(cookie.hostOnly ? {} : {domain: `.${domain}`}),
            path: cookie.path || '/',
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            ...(Number.isFinite(expires) ? {expirationDate: expires / 1000} : {}),
            ...(cookie.sameSite === 'none' ? {sameSite: 'no_restriction' as const}
                : cookie.sameSite === 'lax' || cookie.sameSite === 'strict' ? {sameSite: cookie.sameSite} : {}),
        }]
    })
}

export async function browserCookieJar(cookies: BrowserCookie[]): Promise<CookieJar> {
    const jar = new CookieJar()
    for (const value of cookies) {
        const domain = value.domain?.replace(/^\./, '')
        if (!domain || !schoolDomain(domain)) continue
        if (value.expirationDate !== undefined && value.expirationDate * 1000 <= Date.now()) continue
        const hostOnly = value.hostOnly ?? !value.domain?.startsWith('.')
        const cookie = new Cookie({
            key: value.name,
            value: value.value,
            ...(hostOnly ? {} : {domain}),
            path: value.path || '/',
            secure: value.secure,
            httpOnly: value.httpOnly,
            ...(value.expirationDate !== undefined ? {expires: new Date(value.expirationDate * 1000)} : {}),
            ...(value.sameSite === 'no_restriction' ? {sameSite: 'none'}
                : value.sameSite === 'lax' || value.sameSite === 'strict' ? {sameSite: value.sameSite} : {}),
        })
        await jar.setCookie(cookie, `https://${domain}${cookie.path}`)
    }
    return jar
}

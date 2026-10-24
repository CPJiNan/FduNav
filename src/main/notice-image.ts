import {noticeImageUrl} from './notice-body.ts'

const maxImageBytes = 12 * 1024 * 1024

export function imageDataUrl(bytes: Uint8Array): string {
    const data = Buffer.from(bytes)
    const type = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
        : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'jpeg'
        : /^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii')) ? 'gif'
        : data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP' ? 'webp'
        : data.subarray(0, 2).toString('ascii') === 'BM' ? 'bmp' : null
    if (!type || data.length > maxImageBytes) throw new Error('图片格式不支持或文件过大。')
    return `data:image/${type};base64,${data.toString('base64')}`
}

export async function fetchNoticeImage(value: string, referer: string, request: (url: string, init: RequestInit) => Promise<Response>): Promise<string> {
    const start = noticeImageUrl(value, referer)
    if (!start) throw new Error('图片地址无效。')
    let url: string = start
    const signal = AbortSignal.timeout(20_000)
    for (let redirects = 0; redirects < 6; redirects++) {
        if (['id.fudan.edu.cn', 'uis.fudan.edu.cn'].includes(new URL(url).hostname)) throw new Error('图片需要重新登录。')
        const response = await request(url, {redirect: 'manual', signal, headers: {Referer: referer}})
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location')
            await response.body?.cancel()
            const next = location && noticeImageUrl(location, url)
            if (!next) throw new Error('图片重定向地址无效。')
            url = next
            continue
        }
        if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxImageBytes) {
            await response.body?.cancel()
            throw new Error('图片读取失败。')
        }
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let length = 0
        try {
            while (true) {
                const {done, value: chunk} = await reader.read()
                if (done) break
                length += chunk.length
                if (length > maxImageBytes) throw new Error('图片文件过大。')
                chunks.push(chunk)
            }
            return imageDataUrl(Buffer.concat(chunks))
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    }
    throw new Error('图片重定向次数过多。')
}

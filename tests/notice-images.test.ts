import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseNoticeDetail} from '../src/main/notice-parser.ts'
import {noticeImageUrls, noticeImageUrl} from '../src/main/notice-body.ts'
import {fetchNoticeImage, imageDataUrl} from '../src/main/notice-image.ts'
import type {NoticeBodyNode} from '../src/shared/notices.ts'

const base = 'https://cec.fudan.edu.cn/news/page.htm'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxoAAAAASUVORK5CYII=', 'base64')
const flatten = (nodes: NoticeBodyNode[]): string[] => nodes.flatMap(node => node.type === 'text' ? [node.text]
    : node.type === 'image' ? [node.url] : flatten(node.children))

test('article structure preserves image position in paragraphs and table cells, with lazy/relative image URLs', () => {
    const detail = parseNoticeDetail(`<div class="wp_articlecontent"><p>前文<img src="../one.png" width="800" height="400">后文</p><p style="text-align:center"><img src="/placeholder.png" data-original="/two.png"></p><table><tr><td colspan="2">单元格<img data-src="//cec.fudan.edu.cn/three.png"></td></tr></table><p>结尾</p></div>`, base, 'cec')!
    assert.deepEqual(flatten(detail.body!), ['前文', 'https://cec.fudan.edu.cn/one.png', '后文', 'https://cec.fudan.edu.cn/two.png', '单元格', 'https://cec.fudan.edu.cn/three.png', '结尾'])
    assert.equal(detail.imageCount, 3)
    assert.equal(detail.body![1].type === 'element' && detail.body![1].align, 'center')
    assert.match(JSON.stringify(detail.body), /"colSpan":2/)
    assert.match(detail.content, /前文后文/)
})

test('render tree removes executable markup, hidden tracking images and unsafe URLs', () => {
    const detail = parseNoticeDetail(`<article><script>alert(1)</script><style>body{display:none}</style><p onclick="bad()" style="background:url(https://evil.example)">正文<img src="/poster.jpg" onerror="bad()" alt="&lt;script&gt;"></p><img src="/_visitcount" width="0" height="0"><div hidden><img src="/hidden.png"></div><img style="display:none" src="/hidden2.png"><img src="javascript:bad()"><iframe src="https://evil.example"></iframe></article>`, base, 'jwc')!
    assert.deepEqual(noticeImageUrls(detail.body!), ['https://cec.fudan.edu.cn/poster.jpg'])
    assert.equal(detail.imageCount, 1)
    assert.doesNotMatch(JSON.stringify(detail.body), /onclick|onerror|bad\(\)|background|evil\.example|visitcount/)
    for (const raw of ['file:///secret.png', 'data:text/html,secret', 'javascript:bad()', 'https://user:pass@cec.fudan.edu.cn/x', 'https://127.0.0.1/x', 'https://localhost/x']) {
        assert.equal(noticeImageUrl(raw, base), null)
    }
    assert.equal(noticeImageUrl('http://cec.fudan.edu.cn/x.jpg', base), 'https://cec.fudan.edu.cn/x.jpg')
    assert.equal(noticeImageUrl('https://images.example.com/x.jpg', base), 'https://images.example.com/x.jpg')
})

test('image-only articles retain their render tree and existing PDF attachments', () => {
    const detail = parseNoticeDetail('<div class="wp_articlecontent"><p><img src="/poster.png"></p><div pdfsrc="/notice.pdf"></div></div>', base, 'cec')!
    assert.equal(detail.content, '')
    assert.equal(detail.imageCount, 1)
    assert.deepEqual(noticeImageUrls(detail.body!), ['https://cec.fudan.edu.cn/poster.png'])
    assert.equal(detail.attachments[0].url, 'https://cec.fudan.edu.cn/notice.pdf')
})

test('image fetching follows validated redirects and carries a referrer without exposing credentials to the renderer', async () => {
    const requests: string[] = []
    const result = await fetchNoticeImage('/one.png', base, async (url, init) => {
        requests.push(url)
        assert.equal(init.redirect, 'manual')
        assert.equal(new Headers(init.headers).get('Referer'), base)
        assert.ok(init.signal)
        return requests.length === 1 ? new Response(null, {status: 302, headers: {location: '/two.png'}}) : new Response(png)
    })
    assert.deepEqual(requests, ['https://cec.fudan.edu.cn/one.png', 'https://cec.fudan.edu.cn/two.png'])
    assert.equal(result, imageDataUrl(png))
    assert.match(result, /^data:image\/png;base64,/)
})

test('image fetching rejects login pages, non-image payloads, unsafe redirects and oversized downloads', async () => {
    await assert.rejects(fetchNoticeImage('/one.png', base, async () => new Response('<html>login</html>')), /图片格式/)
    await assert.rejects(fetchNoticeImage('/one.png', base, async () => new Response(null, {status: 404})), /读取失败/)
    await assert.rejects(fetchNoticeImage('/one.png', base, async () => new Response(null, {status: 302, headers: {location: 'file:///secret'}})), /重定向/)
    await assert.rejects(fetchNoticeImage('/one.png', base, async () => new Response(null, {status: 302, headers: {location: 'https://id.fudan.edu.cn/login'}})), /重新登录/)
    await assert.rejects(fetchNoticeImage('/one.png', base, async () => new Response(png, {headers: {'content-length': String(13 * 1024 * 1024)}})), /读取失败/)
    await assert.rejects(fetchNoticeImage('/one.png', base, async () => new Response(new Uint8Array(13 * 1024 * 1024))), /文件过大/)
})

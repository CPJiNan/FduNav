import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {AppDatabase} from '../src/main/database.ts'
import {parseNotices, parseNoticeDetail, discoverNoticeLists} from '../src/main/notice-parser.ts'
import {SourceRefreshService, collectSource} from '../src/main/source-service.ts'
import {sourceUrl, validateSource} from '../src/shared/sources.ts'
import {isPublicAddress} from '../src/main/source-fetch.ts'

const notice = {url: 'https://cec.fudan.edu.cn/a/page.htm', title: '英语分级考试', published: '2026-09-01'}
const html = '<ul><li class="list_item"><a href="/a/page.htm">英语分级考试</a><span>2026-09-01</span></li></ul>'

test('legacy database migrates notices, account and preferences; removed defaults stay removed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-sources-'))
    const path = join(directory, 'test.sqlite')
    const raw = new DatabaseSync(path)
    raw.exec(`CREATE TABLE notices (url TEXT PRIMARY KEY, title TEXT NOT NULL, published TEXT NOT NULL);
        CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO preferences VALUES ('theme', 'dark'), ('notices_updated_at', '2026-10-24T00:00:00Z');
        PRAGMA user_version = 2;`)
    raw.prepare('INSERT INTO notices VALUES (?, ?, ?)').run(notice.url, notice.title, notice.published)
    raw.close()
    let db = new AppDatabase(path)
    try {
        assert.equal(db.getNotices().items[0].sourceId, 'jwc')
        assert.equal(db.getNotices().updatedAt, '2026-10-24T00:00:00Z')
        assert.equal(db.getTheme(), 'dark')
        assert.equal(db.getSource('cec')?.url, 'https://cec.fudan.edu.cn/23080/list.htm')
        assert.equal(db.getSource('cec')?.preset, 'cec')
        db.saveAccount({username: 'test', cookies: new Uint8Array([1]), target: 'test', last_login: 'test'})
        db.removeSource('cec')
        db.close()
        db = new AppDatabase(path)
        assert.equal(db.getSources().length, 1)
        assert.equal(db.getAccount()?.username, 'test')
    } finally { db.close(); rmSync(directory, {recursive: true, force: true}) }
})

test('source cache isolates identical URLs, toggles visibility and rejects stale writes', () => {
    const db = new AppDatabase(':memory:')
    try {
        db.saveNotices([notice], 'cec')
        db.saveNotices([notice], 'jwc')
        assert.equal(db.getNotices().items.length, 2)
        const original = db.getSource('cec')!
        db.saveSource({...original, enabled: false})
        assert.equal(db.getNotices().items.length, 1)
        assert.equal(db.saveNotices([notice], 'cec', original.revision), false)
        db.saveSource({...db.getSource('cec')!, enabled: true, name: '英语'})
        assert.equal(db.getNotices().items.find(item => item.sourceId === 'cec')?.sourceName, '英语')
        db.saveSource({...db.getSource('cec')!, preset: 'generic'})
        assert.equal(db.hasNotice(notice.url, 'cec'), false)
        assert.equal(db.saveNotices([notice], 'cec', original.revision), false)
        db.saveNotices([notice], 'cec')
        db.saveSource({...db.getSource('cec')!, url: 'https://example.com/notices'})
        assert.equal(db.hasNotice(notice.url, 'cec'), false)
        db.removeSource('cec')
        assert.equal(db.saveNotices([notice], 'cec'), false)
        assert.equal(db.hasNotice(notice.url, 'jwc'), true)
        assert.throws(() => db.saveSource({name: '重复', url: db.getSource('jwc')!.url, enabled: true, preset: 'jwc'}), /已添加/)
    } finally { db.close() }
})

test('source validation rejects malformed presets and nonpublic destinations', () => {
    for (const url of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost',
        'https://a.local', 'https://a.internal', 'https://user:pass@example.com', 'https://example.com:8000']) {
        assert.throws(() => sourceUrl(url))
    }
    for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '100.64.0.1', '169.254.169.254', '::1', 'fc00::1']) {
        assert.equal(isPublicAddress(address), false)
    }
    assert.equal(isPublicAddress('202.120.224.1'), true)
    assert.equal(validateSource({name: '英语', url: 'https://cec.fudan.edu.cn/', enabled: true, preset: 'unknown'}).ok, false)
    assert.equal(sourceUrl('https://example.com/#test'), 'https://example.com/')
})

test('presets parse dated rows, discover homepage lists and preserve PDF-only articles', async () => {
    const base = 'https://cec.fudan.edu.cn/23080/list.htm'
    assert.deepEqual(parseNotices(html, base, 'cec'), [notice])
    assert.deepEqual(parseNotices(html.replace('2026-09-01', '2026年9月1日'), base, 'generic'), [notice])
    assert.equal(parseNotices(html.replace('2026-09-01', '2026-02-30'), base).length, 0)
    assert.equal(parseNotices(html.replace('/a/page.htm', 'https://example.com/page.htm'), base).length, 0)
    const home = '<div><h3 class="tit">通知公告</h3><a href="/23080/list.htm">更多</a></div>'
    assert.deepEqual(discoverNoticeLists(home, 'https://cec.fudan.edu.cn/'), [base])
    const db = new AppDatabase(':memory:')
    try {
        const result = await collectSource({...db.getSource('cec')!, url: 'https://cec.fudan.edu.cn/'}, async url => ({url, text: url === base ? html : home}))
        assert.deepEqual(result.items, [notice])
        assert.equal(result.listUrl, base)
    } finally { db.close() }
    const detail = parseNoticeDetail(`<div class="wp_articlecontent"><p>&nbsp;</p>
        <div class="wp_pdf_player" pdfsrc="/_upload/exam.pdf" sudyfile-attr="{'title':'分级考试.pdf'}"></div>
        <a href="https://example.com/other.pdf"></a><script>bad()</script></div>`, notice.url, 'cec')!
    assert.equal(detail.content, '')
    assert.deepEqual(detail.attachments, [{name: '分级考试.pdf', url: 'https://cec.fudan.edu.cn/_upload/exam.pdf'}])
    assert.equal(parseNoticeDetail('<div class="wp_articlecontent">正文<br>第二行</div>', notice.url)?.content, '正文\n第二行')
})

test('refresh deduplicates work and retains cached notices on individual failures', async () => {
    const db = new AppDatabase(':memory:')
    try {
        db.saveNotices([notice], 'cec')
        let calls = 0
        const refresh = new SourceRefreshService(db, async url => {
            calls++
            if (url.includes('cec.')) throw new Error('测试连接失败')
            return {url, text: html}
        })
        const first = refresh.refresh()
        assert.equal(first, refresh.refresh())
        const list = await first
        assert.equal(calls, 2)
        assert.equal(list.items.length, 2)
        assert.equal(db.getSource('cec')?.lastError, '测试连接失败')
        assert.equal(db.getSource('jwc')?.lastError, null)
        db.saveSource({...db.getSource('cec')!, enabled: false})
        calls = 0
        await refresh.refresh()
        assert.equal(calls, 1)
    } finally { db.close() }
})

test('editing a source while a refresh is pending cannot repopulate obsolete cache', async () => {
    const db = new AppDatabase(':memory:')
    try {
        let finish!: () => void
        const wait = new Promise<void>(resolve => { finish = resolve })
        const refresh = new SourceRefreshService(db, async url => { await wait; return {url, text: html} })
        const pending = refresh.refresh()
        db.saveSource({...db.getSource('cec')!, url: 'https://example.com/list'})
        db.removeSource('jwc')
        finish()
        assert.equal((await pending).items.length, 0)
        assert.equal(db.getSource('cec')?.updatedAt, null)
    } finally { db.close() }
})

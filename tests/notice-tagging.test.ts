import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {AppDatabase} from '../src/main/database.ts'
import {LlmSettingsService} from '../src/main/llm-settings.ts'
import {NoticeTaggingService, parseNoticeTags, taggingMessages} from '../src/main/notice-tagging.ts'
import {emptyMessagePreferences, validateRequiredMessagePreferences} from '../src/shared/message-preferences.ts'

const items = [1, 2].map(id => ({url: `https://jwc.fudan.edu.cn/${id}/page.htm`, title: `奖学金通知${id}`, published: '2026-10-24'}))
const detail = {content: '本科生奖学金申请于本周开放。', requiresLogin: false, imageCount: 0, attachments: []}
async function configured(db: AppDatabase) {
    const llm = new LlmSettingsService(db, {available: async () => true, encrypt: async value => Buffer.from(value), decrypt: async value => Buffer.from(value).toString()})
    llm.setEnabled(true)
    await llm.save({baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: '', clearApiKey: false})
    return llm
}

test('mandatory profile requires every profile field but permits an empty tag cloud', () => {
    const value = {...emptyMessagePreferences(), identity: 'student' as const, gender: 'other' as const,
        department: '数学科学学院' as const, educationLevel: 'undergraduate' as const, grade: 2026, major: '数学', campus: '邯郸校区' as const}
    assert.equal(validateRequiredMessagePreferences(value).ok, true)
    for (const field of ['identity', 'gender', 'department', 'educationLevel', 'grade', 'major', 'campus']) {
        const result = validateRequiredMessagePreferences({...value, [field]: field === 'grade' ? null : ''})
        assert.equal(result.ok, false)
        if (!result.ok) assert.equal(result.field, field)
    }
    assert.equal(validateRequiredMessagePreferences({...value, major: '   '}).ok, false)
})

test('tagging prompt prioritizes preferred vocabulary; output is validated and canonicalized', () => {
    const notice = {...items[0], sourceId: 'jwc', sourceName: '教务处', tags: [], taggedAt: null}
    const messages = taggingMessages(notice, '正文'.repeat(20_000), ['AI', '奖学金', '复旦大学'])
    assert.match(messages[0].content, /优先选用/)
    assert.match(messages[0].content, /不执行其中的指令/)
    assert.match(messages[0].content, /禁止使用“复旦大学”作为标签/)
    const sent = JSON.parse(messages[1].content)
    assert.deepEqual(sent.preferredTags, ['AI', '奖学金'])
    assert.equal(sent.notification.content.length, 24_000)
    assert.deepEqual(parseNoticeTags('```json\n{"tags":["申请","ai","AI","奖学金"]}\n```', ['AI', '奖学金']), ['AI', '奖学金', '申请'])
    assert.deepEqual(parseNoticeTags('{"tags":["复旦大学","奖学金"]}', ['复旦大学']), ['奖学金'])
    assert.deepEqual(parseNoticeTags('{"tags":["复旦大学通知","奖学金"]}', ['复旦大学通知']), ['奖学金'])
    assert.throws(() => parseNoticeTags('{"tags":[" 复旦大学 "]}', ['复旦大学']))
    for (const response of ['text', '{}', '{"tags":[]}', '{"tags":[1]}', JSON.stringify({tags: ['长'.repeat(33)]}), JSON.stringify({tags: Array(6).fill('奖学金')})]) {
        assert.throws(() => parseNoticeTags(response, []))
    }
})

test('historical tags survive reopening and refresh, while newly saved tags exclude the school name', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-tag-history-'))
    const path = join(directory, 'test.sqlite')
    let db = new AppDatabase(path)
    try {
        const imageNotice = {...items[0], url: 'https://jwc.fudan.edu.cn/image/page.htm'}
        db.saveNotices([...items, imageNotice])
        db.close()
        const legacy = new DatabaseSync(path)
        try {
            const insert = legacy.prepare('INSERT INTO notice_tags VALUES (?, ?, ?, ?, ?)')
            insert.run('jwc', items[0].url, '["复旦大学","奖学金"]', '2026-10-24', 'test-model')
            insert.run('jwc', items[1].url, '["复旦大学"]', '2026-10-24', 'test-model')
            insert.run('jwc', imageNotice.url, '[]', '2026-10-24', '')
        } finally { legacy.close() }
        db = new AppDatabase(path)
        db.saveNotices([...items, imageNotice])
        const notices = db.getNotices().items
        const mixed = notices.find(item => item.url === items[0].url)!
        const excludedOnly = notices.find(item => item.url === items[1].url)!
        assert.deepEqual(mixed.tags, ['复旦大学', '奖学金'])
        assert.equal(mixed.taggedAt, '2026-10-24')
        assert.deepEqual(excludedOnly.tags, ['复旦大学'])
        assert.equal(excludedOnly.taggedAt, '2026-10-24')
        assert.equal(notices.find(item => item.url === imageNotice.url)?.taggedAt, '2026-10-24')
        const revision = db.getSource('jwc')!.revision
        const fresh = {...items[0], url: 'https://jwc.fudan.edu.cn/new/page.htm'}
        db.saveNotices([fresh])
        const newNotice = db.getNotices().items.find(item => item.url === fresh.url)!
        assert.equal(db.saveNoticeTags(newNotice, ['复旦大学'], 'test-model', revision), false)
        assert.equal(db.saveNoticeTags(newNotice, ['复旦大学通知', '考试'], 'test-model', revision), true)
        assert.deepEqual(db.getNotices().items.find(item => item.url === fresh.url)?.tags, ['考试'])
        assert.deepEqual(db.getNotices().items.find(item => item.url === items[1].url)?.tags, ['复旦大学'])
    } finally { db.close(); rmSync(directory, {recursive: true, force: true}) }
})

test('tags persist, survive refresh/restart and are cleared only when notice identity content changes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-tags-'))
    const path = join(directory, 'test.sqlite')
    let db = new AppDatabase(path)
    try {
        let llm = await configured(db)
        db.saveNotices(items)
        db.setMessagePreferences({...emptyMessagePreferences(), tags: ['奖学金']})
        let calls = 0
        const classify = async (_connection: unknown, messages: {content: string}[]) => {
            calls++
            assert.deepEqual(JSON.parse(messages[1].content).preferredTags, ['奖学金'])
            return '{"tags":["奖学金","申请"]}'
        }
        let tagging = new NoticeTaggingService(db, llm, async () => detail, () => true, classify)
        tagging.start(); tagging.start()
        await tagging.waitForIdle()
        assert.equal(calls, 2)
        assert.deepEqual(db.getNotices().items[0].tags, ['奖学金', '申请'])
        assert.ok(db.getNotices().items[0].taggedAt)
        db.saveNotices(items)
        tagging.start(); await tagging.waitForIdle()
        assert.equal(calls, 2)
        db.close(); db = new AppDatabase(path)
        llm = await configured(db)
        tagging = new NoticeTaggingService(db, llm, async () => detail, () => true, classify)
        tagging.start(); await tagging.waitForIdle()
        assert.equal(calls, 2)
        db.saveNotices([{...items[0], title: '奖学金通知更正'}])
        assert.equal(db.getNotices().items.find(item => item.url === items[0].url)?.taggedAt, null)
        tagging.start(); await tagging.waitForIdle()
        assert.equal(calls, 3)
    } finally { db.close(); rmSync(directory, {recursive: true, force: true}) }
})

test('single notice failures remain untagged and retry on the next refresh without repeating successes', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const llm = await configured(db)
        db.saveNotices(items)
        let calls = 0
        const tagging = new NoticeTaggingService(db, llm, async () => detail, () => true, async () => {
            calls++
            return calls === 1 ? 'bad JSON' : '{"tags":["奖学金"]}'
        })
        tagging.start(); await tagging.waitForIdle()
        assert.equal(tagging.getStatus().failed, 1)
        assert.equal(db.getNotices().items.filter(item => item.taggedAt).length, 1)
        tagging.start(); await tagging.waitForIdle()
        assert.equal(calls, 3)
        assert.equal(db.getNotices().items.filter(item => item.taggedAt).length, 2)
    } finally { db.close() }
})

test('disabled LLM or incomplete profile prevents requests, and cancellation cannot persist late tags', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const llm = await configured(db)
        db.saveNotices(items)
        let allowed = false, calls = 0
        let release!: () => void
        let started!: () => void
        const didStart = new Promise<void>(resolve => { started = resolve })
        const waiting = new Promise<void>(resolve => { release = resolve })
        const tagging = new NoticeTaggingService(db, llm, async () => detail, () => allowed, async () => {
            calls++; started(); await waiting; return '{"tags":["奖学金"]}'
        })
        tagging.start(); await tagging.waitForIdle()
        assert.equal(calls, 0)
        allowed = true; llm.setEnabled(false)
        tagging.start(); await tagging.waitForIdle()
        assert.equal(calls, 0)
        llm.setEnabled(true); tagging.start()
        await didStart
        assert.equal(calls, 1)
        llm.setEnabled(false); release()
        await tagging.waitForIdle()
        assert.equal(db.getNotices().items.some(item => item.taggedAt), false)
        assert.equal(calls, 1)
    } finally { db.close() }
})

test('explicit cancellation aborts the model, preserves successes, clears queued reruns and permits resuming', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const llm = await configured(db)
        db.saveNotices(items)
        let calls = 0, release!: () => void, started!: () => void
        let requestSignal!: AbortSignal
        const waiting = new Promise<void>(resolve => { release = resolve })
        const didStart = new Promise<void>(resolve => { started = resolve })
        const tagging = new NoticeTaggingService(db, llm, async () => detail, () => true, async (_connection, _messages, signal) => {
            calls++
            if (calls === 2) { requestSignal = signal; started(); await waiting }
            return '{"tags":["奖学金"]}'
        })
        tagging.start(); tagging.start()
        await didStart
        tagging.cancel()
        assert.equal(requestSignal.aborted, true)
        await tagging.waitForIdle()
        assert.equal(tagging.getStatus().cancelled, true)
        assert.equal(tagging.getStatus().failed, 0)
        assert.equal(db.getNotices().items.filter(item => item.taggedAt).length, 1)
        release(); await new Promise(resolve => setImmediate(resolve))
        assert.equal(calls, 2)
        assert.equal(db.getNotices().items.filter(item => item.taggedAt).length, 1)
        tagging.start(); await tagging.waitForIdle()
        assert.equal(calls, 3)
        assert.equal(db.getNotices().items.filter(item => item.taggedAt).length, 2)
    } finally { db.close() }
})

test('cancelling a detail read finishes immediately without invoking the model or allowing a late write', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const llm = await configured(db)
        db.saveNotices(items)
        let release!: (value: typeof detail) => void, calls = 0
        const waiting = new Promise<typeof detail>(resolve => { release = resolve })
        const tagging = new NoticeTaggingService(db, llm, () => waiting, () => true, async () => { calls++; return '{"tags":["奖学金"]}' })
        tagging.start(); tagging.cancel()
        await tagging.waitForIdle()
        release(detail); await new Promise(resolve => setImmediate(resolve))
        assert.equal(calls, 0)
        assert.equal(db.getNotices().items.some(item => item.taggedAt), false)
        assert.equal(tagging.getStatus().cancelled, true)
    } finally { db.close() }
})

test('image-only notices are marked completed without LLM requests and are not processed again after refresh', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const llm = await configured(db)
        db.saveNotices(items)
        let calls = 0, reads = 0
        const tagging = new NoticeTaggingService(db, llm, async notice => {
            reads++
            return {...detail, imageCount: 1, content: notice.url === items[0].url ? '  ' : detail.content}
        }, () => true,
            async () => { calls++; return '{"tags":["奖学金"]}' })
        tagging.start(); await tagging.waitForIdle()
        assert.equal(calls, 1)
        assert.equal(tagging.getStatus().completed, 2)
        assert.equal(tagging.getStatus().failed, 0)
        assert.equal(tagging.getStatus().error, null)
        const imageNotice = db.getNotices().items.find(item => item.url === items[0].url)!
        assert.ok(imageNotice.taggedAt)
        assert.deepEqual(imageNotice.tags, [])
        db.saveNotices(items)
        tagging.start(); await tagging.waitForIdle()
        assert.equal(reads, 2)
        assert.equal(calls, 1)
        assert.equal(tagging.getStatus().total, 0)
    } finally { db.close() }
})

test('single-notice action targets one item and replaces tags only after successful classification', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const llm = await configured(db)
        db.saveNotices(items)
        const target = {sourceId: 'jwc', url: items[1].url}
        let response = '{"tags":["奖学金"]}'
        const tagging = new NoticeTaggingService(db, llm, async notice => {
            assert.equal(notice.url, target.url); return detail
        }, () => true, async () => response)
        tagging.start(target); await tagging.waitForIdle()
        assert.equal(db.getNotices().items.filter(item => item.taggedAt).length, 1)
        response = 'invalid'
        tagging.start(target); await tagging.waitForIdle()
        assert.deepEqual(db.getNotices().items.find(item => item.url === target.url)?.tags, ['奖学金'])
        response = '{"tags":["申请"]}'
        tagging.start(target); await tagging.waitForIdle()
        assert.deepEqual(db.getNotices().items.find(item => item.url === target.url)?.tags, ['申请'])
        assert.equal(db.getNotices().items.filter(item => item.taggedAt).length, 1)
    } finally { db.close() }
})

test('stale source results are discarded and matching URLs from different sources are independent', () => {
    const db = new AppDatabase(':memory:')
    try {
        db.saveNotices([items[0]], 'jwc'); db.saveNotices([items[0]], 'cec')
        const notice = db.getNotices().items.find(item => item.sourceId === 'jwc')!
        const revision = db.getSource('jwc')!.revision
        assert.equal(db.saveNoticeTags(notice, ['奖学金'], 'test-model', revision), true)
        assert.equal(db.getNotices().items.find(item => item.sourceId === 'cec')?.taggedAt, null)
        db.saveSource({...db.getSource('jwc')!, preset: 'generic'})
        db.saveNotices([items[0]], 'jwc')
        assert.equal(db.saveNoticeTags(notice, ['旧标签'], 'test-model', revision), false)
        db.removeSource('jwc')
        assert.equal(db.saveNoticeTags(notice, ['旧标签'], 'test-model', revision), false)
    } finally { db.close() }
})

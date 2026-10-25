import assert from 'node:assert/strict'
import {test} from 'node:test'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SummaryQueue} from '../src/main/summary-queue.ts'
import {AppDatabase} from '../src/main/database.ts'
import {LlmSettingsService} from '../src/main/llm-settings.ts'
import {NoticeSummaryService, summaryCacheKey} from '../src/main/notice-summary.ts'
import {defaultSummaryPrompt} from '../src/shared/llm.ts'
import type {MessagePreferences} from '../src/shared/message-preferences.ts'
import type {completeLlm} from '../src/main/llm-connection.ts'

const notice = {sourceId: 'jwc', url: 'https://jwc.fudan.edu.cn/test.htm', sourceName: '教务处', title: '报名通知', published: '2026-10-25'}
const result = {content: '摘要', relevance: null, model: 'test', cached: false} as const
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(done => { resolve = done })
    return {promise, resolve}
}

test('队列按顺序执行，记录阶段及完成状态，清理后为空', async () => {
    const queue = new SummaryQueue()
    const gate = deferred<typeof result>()
    let secondStarted = false
    const first = queue.enqueue(notice, 'a', async (_signal, stage) => { stage('generating'); return gate.promise })
    const second = queue.enqueue({...notice, title: '另一条'}, 'a', async () => { secondStarted = true; return result })
    await tick()
    assert.deepEqual(queue.snapshot('a').map(task => task.status), ['generating', 'queued'])
    assert.equal(secondStarted, false)
    gate.resolve(result)
    await Promise.all([first, second])
    assert.deepEqual(queue.snapshot('a').map(task => task.status), ['completed', 'completed'])
    queue.clearFinished('a')
    assert.deepEqual(queue.snapshot('a'), [])
})

test('多选取消运行中和等待任务，实际中止信号，不执行被取消的等待任务', async () => {
    const queue = new SummaryQueue()
    let signal!: AbortSignal
    let waitingRan = false
    const first = queue.enqueue(notice, 'a', async value => { signal = value; return new Promise(() => {}) })
    const second = queue.enqueue(notice, 'a', async () => { waitingRan = true; return result })
    const failures = Promise.all([assert.rejects(first, /已取消/), assert.rejects(second, /已取消/)])
    await tick()
    queue.cancel(queue.snapshot('a').map(task => task.id), 'a')
    await failures
    assert.equal(signal.aborted, true)
    assert.equal(waitingRan, false)
    assert.deepEqual(queue.snapshot('a').map(task => task.status), ['cancelled', 'cancelled'])
    assert.deepEqual(await queue.enqueue(notice, 'a', async () => result), result)
})

test('失败后继续执行，取消和清理不会影响其他账号', async () => {
    const queue = new SummaryQueue()
    const gate = deferred<typeof result>()
    const other = queue.enqueue(notice, 'b', async () => gate.promise)
    const failed = queue.enqueue(notice, 'a', async () => { throw new Error('模型失败') })
    const failure = assert.rejects(failed, /模型失败/)
    const next = queue.enqueue(notice, 'a', async () => result)
    await tick()
    queue.cancel(queue.snapshot('b').map(task => task.id), 'a')
    assert.equal(queue.snapshot('b')[0].status, 'reading')
    gate.resolve(result)
    await Promise.all([other, failure, next])
    assert.equal(queue.snapshot('a')[0].error, '模型失败')
    queue.clearFinished('a')
    assert.equal(queue.snapshot('a').length, 0)
    assert.equal(queue.snapshot('b').length, 1)
})

async function fixture(complete: typeof completeLlm, read?: () => Promise<string>) {
    const db = new AppDatabase(':memory:')
    db.saveAccount({username: 'a', cookies: Buffer.from('cookies'), target: '', last_login: '2026-10-25'})
    const preferences: MessagePreferences = {
        identity: 'student', gender: 'female', department: '数学科学学院', educationLevel: 'undergraduate',
        grade: 2024, major: '数学', campus: '邯郸校区'
    }
    db.setMessagePreferences(preferences)
    db.saveNotices([notice])
    const llm = new LlmSettingsService(db, {
        available: async () => true, encrypt: async value => Buffer.from(value), decrypt: async value => Buffer.from(value).toString()
    })
    await llm.save({baseUrl: 'https://example.com/v1', model: 'test', apiKey: '', clearApiKey: false, summaryPrompt: defaultSummaryPrompt})
    llm.setEnabled(true)
    const service = new NoticeSummaryService(db, llm, async () => ({
        content: read ? await read() : '通知正文', requiresLogin: false, imageCount: 0, attachments: []
    }), complete)
    return {db, llm, service, key: summaryCacheKey(notice, preferences, llm.get(), 'a')}
}

test('取消正在生成的摘要会传递中止信号，迟到结果不写缓存，取消后可以重试', async () => {
    const gate = deferred<string>()
    let signal!: AbortSignal
    let calls = 0
    const {db, service, key} = await fixture(async (_connection, _messages, value) => {
        signal = value
        calls++
        return calls === 1 ? gate.promise : JSON.stringify({summary: '新摘要', relevance: 'related'})
    })
    try {
        const first = service.summarize(notice)
        const failure = assert.rejects(first, /已取消/)
        await tick()
        service.queue.cancel(service.queue.snapshot('a').map(task => task.id), 'a')
        await failure
        assert.equal(signal.aborted, true)
        gate.resolve(JSON.stringify({summary: '不应保存', relevance: 'related'}))
        await tick()
        assert.equal(db.getNoticeSummary(notice.sourceId, notice.url, key), null)
        assert.equal((await service.summarize(notice)).content, '新摘要')
    } finally { db.close() }
})

test('读取正文时取消后不再调用模型，下一条队列可以继续', async () => {
    const gate = deferred<string>()
    let calls = 0
    const {db, service} = await fixture(async () => { calls++; return '{}' }, () => gate.promise)
    try {
        const pending = service.summarize(notice)
        const failure = assert.rejects(pending, /已取消/)
        await tick()
        service.queue.cancel(service.queue.snapshot('a').map(task => task.id), 'a')
        await failure
        gate.resolve('迟到的正文')
        await tick()
        assert.equal(calls, 0)
    } finally { db.close() }
})

test('重复请求合并为一条队列记录，缓存命中不新增任务', async () => {
    let calls = 0
    const {db, service} = await fixture(async () => { calls++; return JSON.stringify({summary: '摘要', relevance: 'maybe'}) })
    try {
        await Promise.all([service.summarize(notice), service.summarize(notice)])
        assert.equal(service.queue.snapshot('a').length, 1)
        assert.equal(calls, 1)
        assert.equal((await service.summarize(notice)).cached, true)
        assert.equal(service.queue.snapshot('a').length, 1)
    } finally { db.close() }
})

test('删除运行中的卡片会取消任务，迟到的结果不会重新出现', async () => {
    const queue = new SummaryQueue()
    const gate = deferred<typeof result>()
    const first = queue.enqueue(notice, 'a', async () => gate.promise)
    const failure = assert.rejects(first, /已取消/)
    await tick()
    queue.remove([queue.snapshot('a')[0].id], 'a')
    await failure
    assert.deepEqual(queue.snapshot('a'), [])
    gate.resolve(result)
    await tick()
    assert.deepEqual(queue.snapshot('a'), [])
})

test('全部清除只移除已完成摘要，保留其他状态且不影响其他账号', async () => {
    const queue = new SummaryQueue()
    await queue.enqueue(notice, 'a', async () => result)
    await queue.enqueue(notice, 'b', async () => result)
    await assert.rejects(queue.enqueue(notice, 'a', async () => { throw new Error('失败') }), /失败/)
    const cancelled = queue.enqueue(notice, 'a', async () => new Promise(() => {}))
    const cancellation = assert.rejects(cancelled, /已取消/)
    queue.cancel(queue.snapshot('a').filter(task => task.status === 'queued').map(task => task.id), 'a')
    await cancellation
    const gate = deferred<typeof result>()
    let signal!: AbortSignal
    const active = queue.enqueue(notice, 'a', async value => { signal = value; return gate.promise })
    const waiting = queue.enqueue(notice, 'a', async () => result)
    await tick()
    queue.clear('a')
    assert.deepEqual(queue.snapshot('a').map(task => task.status), ['failed', 'cancelled', 'reading', 'queued'])
    assert.equal(signal.aborted, false)
    assert.equal(queue.snapshot('b').length, 1)
    gate.resolve(result)
    await Promise.all([active, waiting])
    assert.deepEqual(queue.snapshot('a').map(task => task.status), ['failed', 'cancelled', 'completed', 'completed'])
})

test('删除已完成卡片不会删除摘要缓存', async () => {
    const {db, service} = await fixture(async () => JSON.stringify({summary: '已缓存摘要', relevance: 'related'}))
    try {
        await service.summarize(notice)
        service.queue.remove(service.queue.snapshot('a').map(task => task.id), 'a')
        assert.deepEqual(service.queue.snapshot('a'), [])
        assert.equal((await service.summarize(notice)).cached, true)
    } finally { db.close() }
})

test('重新摘要已缓存通知会新增队列任务并更新缓存', async () => {
    let calls = 0
    const {db, service} = await fixture(async () => JSON.stringify({summary: `摘要 ${++calls}`, relevance: 'related'}))
    try {
        assert.equal((await service.summarize(notice)).content, '摘要 1')
        const refreshed = await service.summarize(notice, true)
        assert.equal(refreshed.cached, false)
        assert.equal(refreshed.content, '摘要 2')
        assert.equal(service.queue.snapshot('a').length, 2)
        const cached = await service.summarize(notice)
        assert.equal(cached.cached, true)
        assert.equal(cached.content, '摘要 2')
        assert.equal(calls, 2)
    } finally { db.close() }
})

test('批量筛选跳过已有摘要和排队中的通知，只保留未摘要通知', async () => {
    const gate = deferred<string>()
    const {db, service} = await fixture(() => gate.promise)
    const other = {...notice, url: 'https://jwc.fudan.edu.cn/other.htm'}
    try {
        db.saveNotices([other])
        assert.equal(service.needsSummary(notice), true)
        const pending = service.summarize(notice)
        assert.equal(service.needsSummary(notice), false)
        gate.resolve(JSON.stringify({summary: '已生成摘要', relevance: 'related'}))
        await pending
        assert.deepEqual([notice, other].filter(ref => service.needsSummary(ref)), [other])
        assert.equal(service.queue.snapshot('a').length, 1)
    } finally { db.close() }
})

test('确认有关后覆盖可能有关，缓存及重新摘要均保留手动选择', async () => {
    const {db, service} = await fixture(async () => JSON.stringify({summary: '摘要', relevance: 'maybe'}))
    try {
        assert.equal((await service.summarize(notice)).relevance, 'maybe')
        db.setNoticeRelevanceChoice('a', notice.sourceId, notice.url, 'related')
        assert.equal(service.relevanceFor(notice), 'related')
        assert.equal((await service.summarize(notice)).relevance, 'related')
        assert.equal((await service.summarize(notice, true)).relevance, 'related')
        db.setNoticeRelevanceChoice('a', notice.sourceId, notice.url, 'none')
        assert.equal(service.relevanceFor(notice), null)
        assert.equal((await service.summarize(notice)).relevance, null)
        assert.equal((await service.summarize(notice, true)).relevance, null)
    } finally { db.close() }
})

test('生成过程中确认不相关，迟到的模型结果不会恢复相关标记', async () => {
    const gate = deferred<string>()
    const {db, service} = await fixture(() => gate.promise)
    try {
        const pending = service.summarize(notice)
        await tick()
        db.setNoticeRelevanceChoice('a', notice.sourceId, notice.url, 'none')
        gate.resolve(JSON.stringify({summary: '摘要', relevance: 'related'}))
        assert.equal((await pending).relevance, null)
        assert.equal(service.relevanceFor(notice), null)
    } finally { db.close() }
})

test('相关性确认按账号持久化，未确认和否可区分', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-relevance-'))
    const path = join(directory, 'test.sqlite')
    try {
        const db = new AppDatabase(path)
        db.saveNotices([notice])
        assert.equal(db.getNoticeRelevanceChoice('a', notice.sourceId, notice.url), null)
        db.setNoticeRelevanceChoice('a', notice.sourceId, notice.url, 'none')
        db.setNoticeRelevanceChoice('b', notice.sourceId, notice.url, 'related')
        db.setNoticeRelevanceChoice('d', notice.sourceId, notice.url, 'maybe')
        db.close()
        const reopened = new AppDatabase(path)
        try {
            assert.equal(reopened.getNoticeRelevanceChoice('a', notice.sourceId, notice.url), 'none')
            assert.equal(reopened.getNoticeRelevanceChoice('b', notice.sourceId, notice.url), 'related')
            assert.equal(reopened.getNoticeRelevanceChoice('c', notice.sourceId, notice.url), null)
            assert.equal(reopened.getNoticeRelevanceChoice('d', notice.sourceId, notice.url), 'maybe')
        } finally { reopened.close() }
    } finally { rmSync(directory, {recursive: true, force: true}) }
})

test('三种相关性可反复切换，缓存和重新摘要不会覆盖手动选择', async () => {
    const {db, service} = await fixture(async () => JSON.stringify({summary: '摘要', relevance: 'related'}))
    try {
        await service.summarize(notice)
        for (const choice of ['none', 'maybe', 'related', 'maybe'] as const) {
            db.setNoticeRelevanceChoice('a', notice.sourceId, notice.url, choice)
            const expected = choice === 'none' ? null : choice
            assert.equal(service.relevanceFor(notice), expected)
            assert.equal((await service.summarize(notice)).relevance, expected)
            assert.equal((await service.summarize(notice, true)).relevance, expected)
        }
    } finally { db.close() }
})

test('旧版是非选择迁移后保留记录并支持可能有关', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-relevance-migration-'))
    const path = join(directory, 'test.sqlite')
    try {
        const db = new AppDatabase(path)
        db.saveNotices([notice])
        db.close()
        const legacy = new DatabaseSync(path)
        try {
            legacy.exec(`
                DROP TABLE notice_relevance_choices;
                CREATE TABLE notice_relevance_choices (
                    username TEXT NOT NULL, source_id TEXT NOT NULL, url TEXT NOT NULL,
                    related INTEGER NOT NULL CHECK (related IN (0, 1)),
                    PRIMARY KEY (username, source_id, url),
                    FOREIGN KEY (source_id, url) REFERENCES notices (source_id, url) ON DELETE CASCADE
                );
            `)
            const insert = legacy.prepare('INSERT INTO notice_relevance_choices VALUES (?, ?, ?, ?)')
            insert.run('a', notice.sourceId, notice.url, 1)
            insert.run('b', notice.sourceId, notice.url, 0)
        } finally { legacy.close() }
        const migrated = new AppDatabase(path)
        try {
            assert.equal(migrated.getNoticeRelevanceChoice('a', notice.sourceId, notice.url), 'related')
            assert.equal(migrated.getNoticeRelevanceChoice('b', notice.sourceId, notice.url), 'none')
            assert.equal(migrated.getNoticeRelevanceChoice('c', notice.sourceId, notice.url), null)
            migrated.setNoticeRelevanceChoice('a', notice.sourceId, notice.url, 'maybe')
        } finally { migrated.close() }
        const reopened = new AppDatabase(path)
        try {
            assert.equal(reopened.getNoticeRelevanceChoice('a', notice.sourceId, notice.url), 'maybe')
            assert.equal(reopened.getNoticeRelevanceChoice('b', notice.sourceId, notice.url), 'none')
        } finally { reopened.close() }
    } finally { rmSync(directory, {recursive: true, force: true}) }
})

import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {AppDatabase} from '../src/main/database.ts'
import {LlmSettingsService} from '../src/main/llm-settings.ts'
import {NoticeSummaryService, summaryCacheKey, summaryMessages} from '../src/main/notice-summary.ts'
import type {completeLlm} from '../src/main/llm-connection.ts'
import {defaultSummaryPrompt, summaryPromptMaxLength, validateLlmSettings} from '../src/shared/llm.ts'
import {emptyMessagePreferences, type MessagePreferences} from '../src/shared/message-preferences.ts'

const notice = {
    sourceId: 'jwc',
    sourceName: '教务处',
    url: 'https://jwc.fudan.edu.cn/test.htm',
    title: '报名通知',
    published: '2026-10-25'
}
const preferences: MessagePreferences = {
    identity: 'student', gender: 'female', department: '数学科学学院', educationLevel: 'undergraduate',
    grade: 2024, major: '数学与应用数学', campus: '邯郸校区'
}
const input = {
    baseUrl: 'https://model.example/v1',
    model: 'example',
    apiKey: '',
    clearApiKey: false,
    summaryPrompt: defaultSummaryPrompt
}
const secrets = {
    available: async () => true,
    encrypt: async (value: string) => Buffer.from(value),
    decrypt: async (value: Uint8Array) => Buffer.from(value).toString()
}

test('摘要请求包含全部偏好及通知，使用保存的提示词', () => {
    const messages = summaryMessages(notice, '本科生报名，研究生无需办理。', preferences, '只列与用户相关的截止日期。')
    assert.deepEqual(messages[0], {role: 'system', content: '只列与用户相关的截止日期。'})
    const data = JSON.parse(messages[1].content)
    assert.deepEqual(data.messagePreferences, {
        身份: '学生',
        性别: '女',
        院系: '数学科学学院',
        学历阶段: '本科生',
        年级: '2024级',
        专业: '数学与应用数学',
        校区: '邯郸校区'
    })
    assert.equal(data.notice.content, '本科生报名，研究生无需办理。')
    const empty = JSON.parse(summaryMessages(notice, '正文', emptyMessagePreferences(), defaultSummaryPrompt)[1].content)
    assert.ok(Object.values(empty.messagePreferences).every(value => value === '未填写'))
})

test('任一偏好、提示词或接口变化均使摘要缓存失效', () => {
    const hash = (prefs: MessagePreferences, prompt = defaultSummaryPrompt, url = input.baseUrl) =>
        summaryCacheKey(notice, prefs, {...input, summaryPrompt: prompt, baseUrl: url, enabled: true, hasApiKey: false}, 'student')
    const original = hash(preferences)
    for (const key of Object.keys(preferences) as (keyof MessagePreferences)[]) {
        assert.notEqual(hash({...preferences, [key]: emptyMessagePreferences()[key]}), original, key)
    }
    assert.notEqual(hash(preferences, '新提示词'), original)
    assert.notEqual(hash(preferences, defaultSummaryPrompt, 'https://other.example/v1'), original)
    assert.equal(hash({...preferences}), original)
})

async function setupSummary(path = ':memory:', complete?: typeof completeLlm) {
    const db = new AppDatabase(path)
    db.saveAccount({username: 'student-a', cookies: Buffer.from('test-cookies'), target: '', last_login: '2026-10-25'})
    db.setMessagePreferences(preferences)
    db.saveNotices([notice])
    const llm = new LlmSettingsService(db, secrets)
    await llm.save(input)
    llm.setEnabled(true)
    let reads = 0
    let calls = 0
    const service = new NoticeSummaryService(db, llm, async () => {
        reads++
        return {content: '本科生报名。', requiresLogin: false, imageCount: 0, attachments: []}
    }, async (...args) => {
        calls++
        return complete ? complete(...args) : `摘要 ${calls}`
    })
    return {db, llm, service, counts: () => ({reads, calls})}
}

test('重复请求和刷新通知列表命中缓存，不再读取原文或调用模型', async () => {
    const {db, service, llm, counts} = await setupSummary()
    try {
        const first = await service.summarize(notice)
        assert.equal(first.cached, false)
        db.saveNotices([notice])
        llm.setEnabled(false)
        assert.deepEqual(await service.summarize(notice), {...first, cached: true})
        assert.deepEqual(counts(), {reads: 1, calls: 1})
    } finally { db.close() }
})

test('模型、偏好和账号各自缓存，切换回来可复用原结果', async () => {
    const {db, service, llm, counts} = await setupSummary()
    try {
        const first = await service.summarize(notice)
        await llm.save({...input, model: 'other-model'})
        assert.equal((await service.summarize(notice)).cached, false)
        await llm.save(input)
        db.setMessagePreferences({...preferences, grade: 2025})
        assert.equal((await service.summarize(notice)).cached, false)
        db.setMessagePreferences(preferences)
        db.saveAccount({...db.getAccount()!, username: 'student-b'})
        assert.equal((await service.summarize(notice)).cached, false)
        db.saveAccount({...db.getAccount()!, username: 'student-a'})
        assert.deepEqual(await service.summarize(notice), {...first, cached: true})
        assert.deepEqual(counts(), {reads: 4, calls: 4})
    } finally { db.close() }
})

test('相同输入的并发请求只生成一次，重新生成替换对应缓存', async () => {
    const {db, service, counts} = await setupSummary()
    try {
        const results = await Promise.all([service.summarize(notice), service.summarize(notice), service.summarize(notice, true)])
        assert.ok(results.every(result => result.content === '摘要 1'))
        assert.deepEqual(counts(), {reads: 1, calls: 1})
        const refreshed = await service.summarize(notice, true)
        assert.equal(refreshed.content, '摘要 2')
        assert.deepEqual(await service.summarize(notice), {...refreshed, cached: true})
    } finally { db.close() }
})

test('生成失败不缓存，强制刷新失败保留旧摘要，失败后可以重试', async () => {
    let fail = true
    const {db, service, counts} = await setupSummary(undefined, async () => {
        if (fail) throw new Error('请求超时')
        return '有效摘要'
    })
    try {
        await assert.rejects(service.summarize(notice), /请求超时/)
        fail = false
        const saved = await service.summarize(notice)
        fail = true
        await assert.rejects(service.summarize(notice, true), /请求超时/)
        assert.deepEqual(await service.summarize(notice), {...saved, cached: true})
        assert.deepEqual(counts(), {reads: 3, calls: 3})
    } finally { db.close() }
})

test('生成过程中偏好变化时丢弃旧结果，不写入缓存', async () => {
    let release!: (value: string) => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const {db, service} = await setupSummary(undefined, () => {
        started()
        return new Promise<string>(resolve => { release = resolve })
    })
    try {
        const pending = service.summarize(notice)
        await ready
        db.setMessagePreferences({...preferences, grade: 2025})
        release('旧偏好的摘要')
        await assert.rejects(pending, /已变化/)
        const key = summaryCacheKey(db.getNotice(notice.sourceId, notice.url)!, preferences,
            {...input, enabled: true, hasApiKey: false}, 'student-a')
        assert.equal(db.getNoticeSummary(notice.sourceId, notice.url, key), null)
    } finally { db.close() }
})

test('重启后从 SQLite 读取缓存，即使原文和模型不可用', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-cache-'))
    try {
        const path = join(directory, 'test.sqlite')
        const first = await setupSummary(path)
        const saved = await first.service.summarize(notice)
        first.db.close()
        const db = new AppDatabase(path)
        try {
            const unavailable = async (): Promise<never> => { throw new Error('不应调用外部服务') }
            const service = new NoticeSummaryService(db, new LlmSettingsService(db, secrets), unavailable, unavailable)
            assert.deepEqual(await service.summarize(notice), {...saved, cached: true})
        } finally { db.close() }
    } finally { rmSync(directory, {recursive: true, force: true}) }
})

test('缓存键不受偏好字段顺序影响，模型和账号变化不会串用', () => {
    const settings = {...input, enabled: true, hasApiKey: false}
    const original = summaryCacheKey(notice, preferences, settings, 'a')
    const reordered = Object.fromEntries(Object.entries(preferences).reverse()) as unknown as MessagePreferences
    assert.equal(summaryCacheKey(notice, reordered, settings, 'a'), original)
    assert.notEqual(summaryCacheKey(notice, preferences, {...settings, model: 'other'}, 'a'), original)
    assert.notEqual(summaryCacheKey(notice, preferences, settings, 'b'), original)
})

test('提示词、接口和通知标题更新后重新生成，不复用旧摘要', async () => {
    const {db, llm, service, counts} = await setupSummary()
    try {
        await service.summarize(notice)
        await llm.save({...input, summaryPrompt: '仅总结截止日期'})
        assert.equal((await service.summarize(notice)).cached, false)
        await llm.save({...input, baseUrl: 'https://other.example/v1'})
        assert.equal((await service.summarize(notice)).cached, false)
        db.saveNotices([{...notice, title: '更新后的报名通知'}])
        assert.equal((await service.summarize(notice)).cached, false)
        assert.deepEqual(counts(), {reads: 4, calls: 4})
    } finally { db.close() }
})

test('生成中停用 LLM 时不缓存迟到的结果', async () => {
    let release!: (value: string) => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const {db, llm, service} = await setupSummary(undefined, () => {
        started()
        return new Promise<string>(resolve => { release = resolve })
    })
    try {
        const pending = service.summarize(notice)
        await ready
        llm.setEnabled(false)
        release('不应保存的结果')
        await assert.rejects(pending, /LLM 已停用/)
        await assert.rejects(service.summarize(notice), /启用 LLM/)
    } finally { db.close() }
})

test('旧摘要缓存迁移后不复用无法确认账号的内容', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-cache-migration-'))
    try {
        const path = join(directory, 'test.sqlite')
        const fixture = await setupSummary(path)
        fixture.db.close()
        const legacy = new DatabaseSync(path)
        legacy.exec(`DROP TABLE notice_summary_cache;
            CREATE TABLE notice_summaries (source_id TEXT, url TEXT, content_hash TEXT, model TEXT, summary TEXT, created_at TEXT);
            PRAGMA user_version = 10;`)
        legacy.prepare('INSERT INTO notice_summaries VALUES (?, ?, ?, ?, ?, ?)')
            .run(notice.sourceId, notice.url, 'legacy-key', input.model, '旧账号的摘要', '2026-10-25')
        legacy.close()
        const db = new AppDatabase(path)
        try {
            assert.equal(db.getNoticeSummary(notice.sourceId, notice.url, 'legacy-key'), null)
            assert.equal(db.getNotice(notice.sourceId, notice.url)?.title, notice.title)
            const service = new NoticeSummaryService(db, new LlmSettingsService(db, secrets), async () => ({
                content: '正文', requiresLogin: false, imageCount: 0, attachments: []
            }), async () => '新的个人摘要')
            assert.equal((await service.summarize(notice)).content, '新的个人摘要')
            assert.equal((await service.summarize(notice)).cached, true)
        } finally { db.close() }
    } finally { rmSync(directory, {recursive: true, force: true}) }
})

test('提示词拒绝空白、非字符串和超长内容', () => {
    for (const summaryPrompt of ['', '  \n ', null, 12, '字'.repeat(summaryPromptMaxLength + 1)]) {
        assert.equal(validateLlmSettings({...input, summaryPrompt}).ok, false)
    }
    const result = validateLlmSettings({...input, summaryPrompt: '  自定义提示词\n '})
    assert.ok(result.ok)
    assert.equal(result.data.summaryPrompt, '自定义提示词')
})

test('LLM 设置服务保存、读取及恢复默认提示词', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const service = new LlmSettingsService(db, secrets)
        assert.equal(service.get().summaryPrompt, defaultSummaryPrompt)
        await service.save({...input, summaryPrompt: '仅总结相关报名事项。'})
        assert.equal(new LlmSettingsService(db, secrets).get().summaryPrompt, '仅总结相关报名事项。')
        await service.save(input)
        assert.equal(service.get().summaryPrompt, defaultSummaryPrompt)
    } finally {
        db.close()
    }
})

test('旧版数据库升级后保留接口和密钥，并补入默认提示词', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-summary-'))
    const path = join(directory, 'test.sqlite')
    try {
        const db = new AppDatabase(path)
        db.saveLlmSettings({
            baseUrl: input.baseUrl,
            model: input.model,
            encryptedApiKey: Buffer.from('encrypted'),
            summaryPrompt: '旧提示词'
        })
        db.close()
        const legacy = new DatabaseSync(path)
        legacy.exec('ALTER TABLE llm_settings DROP COLUMN summary_prompt; PRAGMA user_version = 9;')
        legacy.close()
        const migrated = new AppDatabase(path)
        try {
            const saved = migrated.getLlmSettings()!
            assert.equal(saved.summaryPrompt, defaultSummaryPrompt)
            assert.equal(saved.baseUrl, input.baseUrl)
            assert.equal(saved.model, input.model)
            assert.equal(Buffer.from(saved.encryptedApiKey!).toString(), 'encrypted')
        } finally {
            migrated.close()
        }
    } finally {
        rmSync(directory, {recursive: true, force: true})
    }
})

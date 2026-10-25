import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {AppDatabase} from '../src/main/database.ts'
import {LlmSettingsService} from '../src/main/llm-settings.ts'
import {summaryContentHash, summaryMessages} from '../src/main/notice-summary.ts'
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
        summaryContentHash(summaryMessages(notice, '正文', prefs, prompt), url)
    const original = hash(preferences)
    for (const key of Object.keys(preferences) as (keyof MessagePreferences)[]) {
        assert.notEqual(hash({...preferences, [key]: emptyMessagePreferences()[key]}), original, key)
    }
    assert.notEqual(hash(preferences, '新提示词'), original)
    assert.notEqual(hash(preferences, defaultSummaryPrompt, 'https://other.example/v1'), original)
    assert.equal(hash({...preferences}), original)
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

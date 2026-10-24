import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto'
import {AppDatabase} from '../src/main/database.ts'
import {LlmSettingsService, type SecretStorage} from '../src/main/llm-settings.ts'
import {emptyLlmSettings, validateLlmSettings} from '../src/shared/llm.ts'

const input = {baseUrl: 'https://example.com/v1/', model: 'model-test', apiKey: 'fixture-key', clearApiKey: false}
const key = randomBytes(32)
const secrets: SecretStorage = {
    available: async () => true,
    async encrypt(value) {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        const encrypted = Buffer.concat([cipher.update(value), cipher.final()])
        return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    async decrypt(value) {
        const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
        decipher.setAuthTag(value.subarray(12, 28))
        return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString()
    },
}

test('async encryption saves atomically and rejects overlapping saves', async () => {
    const db = new AppDatabase(':memory:')
    try {
        await new LlmSettingsService(db, secrets).save(input)
        const before = db.getLlmSettings()
        let release!: () => void, started!: () => void
        const waiting = new Promise<void>(resolve => { release = resolve })
        const didStart = new Promise<void>(resolve => { started = resolve })
        const service = new LlmSettingsService(db, {...secrets, encrypt: async value => {
            started(); await waiting; return secrets.encrypt(value)
        }})
        const pending = service.save({...input, apiKey: 'replacement'})
        await didStart
        assert.deepEqual(db.getLlmSettings(), before)
        await assert.rejects(service.save({...input, clearApiKey: true, apiKey: ''}), /正在保存/)
        release(); await pending
        service.setEnabled(true)
        assert.equal((await service.getConnection()).apiKey, 'replacement')
    } finally { db.close() }
})

test('disabling LLM while async decryption is pending invalidates the old request even after re-enabling', async () => {
    const db = new AppDatabase(':memory:')
    try {
        let release!: () => void, started!: () => void
        const waiting = new Promise<void>(resolve => { release = resolve })
        const didStart = new Promise<void>(resolve => { started = resolve })
        const service = new LlmSettingsService(db, {...secrets, decrypt: async value => {
            started(); await waiting; return secrets.decrypt(value)
        }})
        await service.save(input)
        service.setEnabled(true)
        const pending = service.getDraftConnection({...input, apiKey: ''})
        await didStart
        service.setEnabled(false); service.setEnabled(true)
        release()
        await assert.rejects(pending, /已停用/)
        assert.equal((await service.getConnection()).apiKey, input.apiKey)
        const unavailable = new LlmSettingsService(db, {...secrets, available: async () => { throw new Error('sensitive diagnostic') }})
        await assert.rejects(unavailable.getConnection(), /安全存储不可用/)
    } finally { db.close() }
})

test('LLM settings persist with encrypted credentials and expose only key presence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-llm-'))
    const path = join(directory, 'test.sqlite')
    let db = new AppDatabase(path)
    try {
        let service = new LlmSettingsService(db, secrets)
        assert.deepEqual(service.get(), emptyLlmSettings())
        service.setEnabled(true)
        await assert.rejects(() => service.getConnection(), /先配置/)
        db.setTheme('dark')
        const sources = db.getSources()
        const result = await service.save(input)
        assert.deepEqual(result, {baseUrl: 'https://example.com/v1', model: 'model-test', hasApiKey: true, enabled: true})
        assert.equal(JSON.stringify(result).includes('fixture-key'), false)
        assert.equal(Buffer.from(db.getLlmSettings()!.encryptedApiKey!).includes(Buffer.from('fixture-key')), false)
        db.close()
        db = new AppDatabase(path)
        service = new LlmSettingsService(db, secrets)
        assert.deepEqual(service.get(), result)
        assert.equal((await service.getConnection()).apiKey, 'fixture-key')
        assert.equal(db.getTheme(), 'dark')
        assert.deepEqual(db.getSources(), sources)
        await service.save({...input, model: 'updated', apiKey: ''})
        assert.equal((await service.getConnection()).apiKey, 'fixture-key')
        assert.equal((await service.getConnection()).model, 'updated')
        await service.save({...input, apiKey: 'replacement'})
        assert.equal((await service.getConnection()).apiKey, 'replacement')
        await service.save({...input, apiKey: '', clearApiKey: true})
        assert.equal(service.get().hasApiKey, false)
        assert.equal(db.getLlmSettings()!.encryptedApiKey, null)
        assert.equal((await service.getConnection()).apiKey, '')
    } finally { db.close(); rmSync(directory, {recursive: true, force: true}) }
})

test('encryption failures are atomic and decryption errors never expose credentials', async () => {
    const db = new AppDatabase(':memory:')
    try {
        db.setLlmEnabled(true)
        await new LlmSettingsService(db, secrets).save(input)
        const before = db.getLlmSettings()
        const unavailable = new LlmSettingsService(db, {...secrets, available: async () => false})
        await assert.rejects(() => unavailable.save({...input, apiKey: 'new-key'}), /安全存储不可用/)
        assert.deepEqual(db.getLlmSettings(), before)
        assert.equal(unavailable.get().hasApiKey, true)
        const broken = new LlmSettingsService(db, {...secrets,
            encrypt: async () => { throw new Error('sensitive diagnostic') },
            decrypt: async () => { throw new Error('sensitive diagnostic') },
        })
        await assert.rejects(() => broken.save(input), /加密失败/)
        assert.deepEqual(db.getLlmSettings(), before)
        await assert.rejects(() => broken.getConnection(), /无法解密/)
        await unavailable.save({...input, apiKey: '', clearApiKey: true})
        assert.equal(unavailable.get().hasApiKey, false)
    } finally { db.close() }
})

test('changing endpoint origin requires replacement or explicit removal of a saved key', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const service = new LlmSettingsService(db, secrets)
        service.setEnabled(true)
        await service.save(input)
        await assert.rejects(() => service.save({...input, baseUrl: 'https://other.example/v1', apiKey: ''}), /更换接口站点/)
        assert.equal(service.get().baseUrl, 'https://example.com/v1')
        await service.save({...input, baseUrl: 'https://example.com/v2', apiKey: ''})
        assert.equal((await service.getConnection()).apiKey, input.apiKey)
        await service.save({...input, baseUrl: 'http://localhost:11434/v1', apiKey: '', clearApiKey: true})
        assert.equal(service.get().hasApiKey, false)
    } finally { db.close() }
})

test('LLM validation normalizes inputs and rejects malformed credentials and endpoints', async () => {
    for (const value of [null, [], {}, {...input, model: ''}, {...input, model: 'a\nb'},
        {...input, model: 'x'.repeat(201)}, {...input, apiKey: 1}, {...input, apiKey: 'a\r\nb'},
        {...input, clearApiKey: true}, {...input, clearApiKey: 'false'}]) {
        assert.equal(validateLlmSettings(value).ok, false)
    }
    for (const baseUrl of ['invalid', 'http://example.com/v1', 'file:///secret', 'https://user:key@example.com',
        'https://example.com/?key=secret', 'https://example.com/#secret', 'https://example.com/v1/chat/completions']) {
        assert.equal(validateLlmSettings({...input, baseUrl}).ok, false)
    }
    for (const baseUrl of ['http://localhost:11434/v1', 'http://127.0.0.1:8000/v1', 'http://[::1]:8000/v1']) {
        assert.equal(validateLlmSettings({...input, baseUrl, apiKey: ''}).ok, true)
    }
    assert.deepEqual(validateLlmSettings({...input, model: ' test ', apiKey: ' key '}),
        {ok: true, data: {...input, baseUrl: 'https://example.com/v1', model: 'test', apiKey: 'key'}})
})

test('draft requests use current values or the saved key without persisting or crossing origins', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const service = new LlmSettingsService(db, secrets)
        service.setEnabled(true)
        const draft = {...input, model: '', apiKey: ''}
        assert.deepEqual(await service.getDraftConnection(draft, false), {baseUrl: 'https://example.com/v1', model: '', apiKey: ''})
        assert.equal(db.getLlmSettings(), null)
        await assert.rejects(() => service.getDraftConnection(draft), /模型名称/)
        await service.save(input)
        const saved = db.getLlmSettings()
        assert.equal((await service.getDraftConnection({...input, model: 'new-model', apiKey: ''})).apiKey, input.apiKey)
        assert.equal((await service.getDraftConnection({...input, apiKey: 'new-key'})).apiKey, 'new-key')
        assert.equal((await service.getDraftConnection({...draft, clearApiKey: true}, false)).apiKey, '')
        await assert.rejects(() => service.getDraftConnection({...draft, baseUrl: 'https://other.example/v1'}, false), /更换接口站点/)
        assert.deepEqual(db.getLlmSettings(), saved)
    } finally { db.close() }
})

test('master switch defaults off, gates all connection access and preserves configuration', async () => {
    const db = new AppDatabase(':memory:')
    try {
        const service = new LlmSettingsService(db, secrets)
        assert.equal(service.get().enabled, false)
        await assert.rejects(() => service.getConnection(), /已停用/)
        await assert.rejects(() => service.getDraftConnection(input), /已停用/)
        await assert.rejects(() => service.getDraftConnection({...input, model: ''}, false), /已停用/)
        assert.throws(() => service.getRequestSignal(), /已停用/)
        assert.throws(() => service.setEnabled('true'), /无效/)
        service.setEnabled(true)
        await service.save(input)
        const config = db.getLlmSettings()
        const oldSignal = service.getRequestSignal()
        assert.equal(oldSignal.aborted, false)
        service.setEnabled(false)
        assert.equal(oldSignal.aborted, true)
        assert.equal(new LlmSettingsService(db, secrets).get().enabled, false)
        assert.deepEqual(db.getLlmSettings(), config)
        await assert.rejects(() => service.getConnection(), /已停用/)
        await assert.rejects(() => service.getDraftConnection(input), /已停用/)
        service.setEnabled(true)
        assert.equal(service.getRequestSignal().aborted, false)
        assert.notEqual(service.getRequestSignal(), oldSignal)
        assert.equal((await service.getConnection()).apiKey, input.apiKey)
    } finally { db.close() }
})

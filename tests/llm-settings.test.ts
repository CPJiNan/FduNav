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
    available: () => true,
    encrypt(value) {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        const encrypted = Buffer.concat([cipher.update(value), cipher.final()])
        return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decrypt(value) {
        const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
        decipher.setAuthTag(value.subarray(12, 28))
        return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString()
    },
}

test('LLM settings persist with encrypted credentials and expose only key presence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-llm-'))
    const path = join(directory, 'test.sqlite')
    let db = new AppDatabase(path)
    try {
        let service = new LlmSettingsService(db, secrets)
        assert.deepEqual(service.get(), emptyLlmSettings())
        assert.throws(() => service.getConnection(), /先配置/)
        db.setTheme('dark')
        const sources = db.getSources()
        const result = service.save(input)
        assert.deepEqual(result, {baseUrl: 'https://example.com/v1', model: 'model-test', hasApiKey: true})
        assert.equal(JSON.stringify(result).includes('fixture-key'), false)
        assert.equal(Buffer.from(db.getLlmSettings()!.encryptedApiKey!).includes(Buffer.from('fixture-key')), false)
        db.close()
        db = new AppDatabase(path)
        service = new LlmSettingsService(db, secrets)
        assert.deepEqual(service.get(), result)
        assert.equal(service.getConnection().apiKey, 'fixture-key')
        assert.equal(db.getTheme(), 'dark')
        assert.deepEqual(db.getSources(), sources)
        service.save({...input, model: 'updated', apiKey: ''})
        assert.equal(service.getConnection().apiKey, 'fixture-key')
        assert.equal(service.getConnection().model, 'updated')
        service.save({...input, apiKey: 'replacement'})
        assert.equal(service.getConnection().apiKey, 'replacement')
        service.save({...input, apiKey: '', clearApiKey: true})
        assert.equal(service.get().hasApiKey, false)
        assert.equal(db.getLlmSettings()!.encryptedApiKey, null)
        assert.equal(service.getConnection().apiKey, '')
    } finally { db.close(); rmSync(directory, {recursive: true, force: true}) }
})

test('encryption failures are atomic and decryption errors never expose credentials', () => {
    const db = new AppDatabase(':memory:')
    try {
        new LlmSettingsService(db, secrets).save(input)
        const before = db.getLlmSettings()
        const unavailable = new LlmSettingsService(db, {...secrets, available: () => false})
        assert.throws(() => unavailable.save({...input, apiKey: 'new-key'}), /安全存储不可用/)
        assert.deepEqual(db.getLlmSettings(), before)
        assert.equal(unavailable.get().hasApiKey, true)
        const broken = new LlmSettingsService(db, {...secrets,
            encrypt: () => { throw new Error('sensitive diagnostic') },
            decrypt: () => { throw new Error('sensitive diagnostic') },
        })
        assert.throws(() => broken.save(input), /加密失败/)
        assert.deepEqual(db.getLlmSettings(), before)
        assert.throws(() => broken.getConnection(), /无法解密/)
        unavailable.save({...input, apiKey: '', clearApiKey: true})
        assert.equal(unavailable.get().hasApiKey, false)
    } finally { db.close() }
})

test('changing endpoint origin requires replacement or explicit removal of a saved key', () => {
    const db = new AppDatabase(':memory:')
    try {
        const service = new LlmSettingsService(db, secrets)
        service.save(input)
        assert.throws(() => service.save({...input, baseUrl: 'https://other.example/v1', apiKey: ''}), /更换接口站点/)
        assert.equal(service.get().baseUrl, 'https://example.com/v1')
        service.save({...input, baseUrl: 'https://example.com/v2', apiKey: ''})
        assert.equal(service.getConnection().apiKey, input.apiKey)
        service.save({...input, baseUrl: 'http://localhost:11434/v1', apiKey: '', clearApiKey: true})
        assert.equal(service.get().hasApiKey, false)
    } finally { db.close() }
})

test('LLM validation normalizes inputs and rejects malformed credentials and endpoints', () => {
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

test('draft requests use current values or the saved key without persisting or crossing origins', () => {
    const db = new AppDatabase(':memory:')
    try {
        const service = new LlmSettingsService(db, secrets)
        const draft = {...input, model: '', apiKey: ''}
        assert.deepEqual(service.getDraftConnection(draft, false), {baseUrl: 'https://example.com/v1', model: '', apiKey: ''})
        assert.equal(db.getLlmSettings(), null)
        assert.throws(() => service.getDraftConnection(draft), /模型名称/)
        service.save(input)
        const saved = db.getLlmSettings()
        assert.equal(service.getDraftConnection({...input, model: 'new-model', apiKey: ''}).apiKey, input.apiKey)
        assert.equal(service.getDraftConnection({...input, apiKey: 'new-key'}).apiKey, 'new-key')
        assert.equal(service.getDraftConnection({...draft, clearApiKey: true}, false).apiKey, '')
        assert.throws(() => service.getDraftConnection({...draft, baseUrl: 'https://other.example/v1'}, false), /更换接口站点/)
        assert.deepEqual(db.getLlmSettings(), saved)
    } finally { db.close() }
})

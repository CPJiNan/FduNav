import {test} from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {fetchLlmModels, testLlmConnection} from '../src/main/llm-connection.ts'

const connection = {baseUrl: 'https://example.com/v1', model: 'model-test', apiKey: 'fixture-key'}

test('connection test checks an actual model response with a minimal isolated request', async () => {
    const request: typeof fetch = async (url, init) => {
        assert.equal(url, 'https://example.com/v1/chat/completions')
        assert.equal(init?.method, 'POST')
        assert.equal(init?.redirect, 'error')
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-key')
        assert.equal(new Headers(init?.headers).has('Cookie'), false)
        assert.deepEqual(JSON.parse(String(init?.body)), {model: 'model-test', messages: [{role: 'user', content: 'Reply with only OK.'}], stream: false})
        return Response.json({choices: [{message: {role: 'assistant', content: 'OK'}}]})
    }
    const result = await testLlmConnection(connection, request)
    assert.ok(result.elapsedMs >= 0)
    assert.deepEqual(Object.keys(result), ['elapsedMs'])
})

test('models endpoint uses GET and deduplicates valid model IDs without requiring a selected model', async () => {
    const request: typeof fetch = async (url, init) => {
        assert.equal(url, 'https://example.com/v1/models')
        assert.equal(init?.method, 'GET')
        assert.equal(init?.body, undefined)
        assert.equal(init?.redirect, 'error')
        assert.equal(new Headers(init?.headers).has('Authorization'), false)
        return Response.json({data: [{id: 'z-model'}, {id: 'a-model'}, {id: 'a-model'}, {id: ''}, {id: 1}, {id: 'a\nb'}, null]})
    }
    assert.deepEqual(await fetchLlmModels({...connection, model: '', apiKey: ''}, request), ['a-model', 'z-model'])
})

test('HTTP errors remain actionable and never return provider bodies or credentials', async () => {
    for (const action of [testLlmConnection, fetchLlmModels]) {
        for (const status of [400, 401, 403, 404, 429, 500, 503]) {
            await assert.rejects(action(connection, async () => new Response('fixture-key secret diagnostic', {status})), error => {
                assert.ok(error instanceof Error)
                assert.match(error.message, new RegExp(`HTTP ${status}`))
                assert.equal(error.message.includes('fixture-key'), false)
                assert.equal(error.message.includes('diagnostic'), false)
                return true
            })
        }
    }
})

test('successful HTTP responses still require valid JSON and the expected API structure', async () => {
    await assert.rejects(testLlmConnection(connection, async () => new Response('<html>Login</html>')), /有效 JSON/)
    for (const value of [null, {}, {error: {message: 'secret'}}, {choices: []}, {choices: [{message: {content: ''}}]}]) {
        await assert.rejects(testLlmConnection(connection, async () => Response.json(value)), /有效的模型回复/)
    }
    await assert.rejects(fetchLlmModels(connection, async () => Response.json({models: []})), /有效的模型列表/)
    await assert.rejects(fetchLlmModels(connection, async () => Response.json({data: []})), /未返回可用模型/)
    await assert.rejects(fetchLlmModels(connection, async () => new Response('x'.repeat(1024 * 1024 + 1))), /内容过大/)
})

test('network errors and timeouts are sanitized', async () => {
    await assert.rejects(testLlmConnection(connection, async () => { throw new Error('secret network details') }), /无法连接模型服务/)
    const request: typeof fetch = async (_url, init) => {
        await delay(1000, undefined, {signal: init?.signal ?? undefined})
        return Response.json({})
    }
    await assert.rejects(testLlmConnection(connection, request, 10), /连接超时/)
    await assert.rejects(fetchLlmModels(connection, request, 10), /连接超时/)
})

test('disabling LLM aborts pending model and connection requests and prevents starting new requests', async () => {
    for (const action of [testLlmConnection, fetchLlmModels]) {
        const controller = new AbortController()
        let called = false
        const request: typeof fetch = async (_url, init) => {
            called = true
            await delay(1000, undefined, {signal: init?.signal ?? undefined})
            return Response.json({})
        }
        const pending = action(connection, request, 30_000, controller.signal)
        assert.equal(called, true)
        controller.abort()
        await assert.rejects(pending, /LLM 已停用/)
        called = false
        await assert.rejects(action(connection, request, 30_000, controller.signal), /LLM 已停用/)
        assert.equal(called, false)
    }
})

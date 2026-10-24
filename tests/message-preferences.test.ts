import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {AppDatabase} from '../src/main/database.ts'
import {departments, emptyMessagePreferences, normalizeTags, splitTagInput, validateMessagePreferences} from '../src/shared/message-preferences.ts'

test('empty preferences remain optional and fresh', () => {
    assert.deepEqual(validateMessagePreferences(emptyMessagePreferences()), {ok: true, data: emptyMessagePreferences()})
    const first = emptyMessagePreferences()
    first.tags.push('选课')
    assert.deepEqual(emptyMessagePreferences().tags, [])
})

test('tag vocabulary supports batch input, trims whitespace and deduplicates', () => {
    assert.deepEqual(normalizeTags(splitTagInput(' 奖学金，选课;AI\r\nai； 学术   讲座,奖学金,, ')),
        {ok: true, data: ['奖学金', '选课', 'AI', '学术 讲座']})
    assert.equal(normalizeTags(['过'.repeat(33)]).ok, false)
    assert.equal(normalizeTags(Array.from({length: 51}, (_, index) => `标签${index}`)).ok, false)
    assert.equal(normalizeTags(['选课', 1]).ok, false)
    assert.equal(normalizeTags(Array(60).fill('重复')).ok, true)
})

test('profile choices and IPC payload validation reject invalid data', () => {
    const defaults = emptyMessagePreferences()
    for (const input of [null, [], {}, {...defaults, gender: 'invalid'}, {...defaults, major: 42},
        {...defaults, identity: 'teacher'}, {...defaults, gender: 'unspecified'},
        {...defaults, department: '不存在的院系'}, {...defaults, educationLevel: 'postdoc'},
        {...defaults, grade: '2024'}, {...defaults, grade: 2024.5},
        {...defaults, grade: NaN}, {...defaults, grade: 2101}, {...defaults, grade: 1899},
        {...defaults, tags: '奖学金'}, {...defaults, tags: [null]}]) {
        assert.equal(validateMessagePreferences(input).ok, false)
    }
    assert.equal(validateMessagePreferences({...defaults, identity: 'staff', gender: 'other'}).ok, true)
    for (const department of departments) {
        assert.equal(validateMessagePreferences({...defaults, department}).ok, true)
    }
    assert.equal(departments.length, 40)
    assert.equal(new Set(departments).size, 40)
})

test('preferences survive database reopening, update and clear without changing theme or notices', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-preferences-'))
    const path = join(directory, 'test.sqlite')
    let db = new AppDatabase(path)
    try {
        assert.deepEqual(db.getMessagePreferences(), emptyMessagePreferences())
        db.setTheme('dark')
        const notices = [{url: 'https://example.com/notice', title: '测试通知', published: '2026-10-24'}]
        db.saveNotices(notices)
        const value = {...emptyMessagePreferences(), identity: 'student' as const, gender: 'female' as const,
            department: '计算与智能创新学院' as const, educationLevel: 'undergraduate' as const, grade: 2024,
            major: ' 计算机科学与技术 ', tags: ['奖学金', '选课', '奖学金']}
        const expected = {...value, major: value.major.trim(), tags: ['奖学金', '选课']}
        assert.deepEqual(db.setMessagePreferences(value), expected)
        db.close()
        db = new AppDatabase(path)
        assert.deepEqual(db.getMessagePreferences(), expected)
        assert.throws(() => db.setMessagePreferences({...expected, grade: 2101}))
        assert.deepEqual(db.getMessagePreferences(), expected)
        db.setMessagePreferences({...expected, major: '数学', tags: ['保研']})
        assert.equal(db.getMessagePreferences().major, '数学')
        db.setMessagePreferences(emptyMessagePreferences())
        assert.deepEqual(db.getMessagePreferences(), emptyMessagePreferences())
        assert.equal(db.getTheme(), 'dark')
        assert.deepEqual(db.getNotices().items.map(item => ({...item})), notices.map(item => ({...item, sourceId: 'jwc', sourceName: '教务处'})))
    } finally {
        db.close()
        rmSync(directory, {recursive: true, force: true})
    }
})

test('legacy profiles migrate without losing gender, cohort, major or tags', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-legacy-preferences-'))
    const path = join(directory, 'test.sqlite')
    const db = new AppDatabase(path)
    const raw = new DatabaseSync(path)
    try {
        for (const gender of ['female', 'unspecified']) {
            const legacy = {gender, enrollmentYear: 1998, graduationYear: 2002, major: '中文', tags: ['选课']}
            raw.prepare("INSERT OR REPLACE INTO preferences (key, value) VALUES ('message_preferences', ?)")
                .run(JSON.stringify(legacy))
            const expected = {...emptyMessagePreferences(), gender: gender === 'unspecified' ? '' : gender,
                grade: 1998, major: '中文', tags: ['选课']}
            assert.deepEqual(db.getMessagePreferences(), expected)
            const stored = JSON.parse(String(raw.prepare("SELECT value FROM preferences WHERE key = 'message_preferences'").get()?.value))
            assert.deepEqual(stored, expected)
            assert.equal('enrollmentYear' in stored, false)
            assert.equal('graduationYear' in stored, false)
        }
    } finally {
        raw.close()
        db.close()
        rmSync(directory, {recursive: true, force: true})
    }
})

import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {AppDatabase} from '../src/main/database.ts'
import {TodoService} from '../src/main/todo-service.ts'
import {validateTodo} from '../src/shared/todos.ts'

const input = {title: '完成作业', notes: '提交到课程网站', dueDate: '2026-10-26', completed: false}

test('新增、编辑、完成、恢复和删除待办', () => {
    const db = new AppDatabase(':memory:')
    const service = new TodoService(db)
    try {
        const created = service.save('a', {...input, title: '  完成作业  '})
        assert.equal(created.title, '完成作业')
        assert.ok(created.id)
        assert.deepEqual(db.getTodos('a'), [created])
        const edited = service.save('a', {...created, title: '提交作业', dueDate: '', notes: ''})
        assert.equal(edited.id, created.id)
        assert.equal(edited.createdAt, created.createdAt)
        assert.equal(edited.dueDate, '')
        assert.equal(edited.title, '提交作业')
        const completed = service.save('a', {...edited, completed: true})
        assert.equal(db.getTodo('a', created.id)?.completed, true)
        service.save('a', {...completed, completed: false})
        assert.equal(db.getTodo('a', created.id)?.completed, false)
        service.remove('a', created.id)
        assert.deepEqual(db.getTodos('a'), [])
        assert.throws(() => service.save('a', created), /不存在/)
    } finally { db.close() }
})

test('不同账号的待办隔离，不能修改或删除其他账号记录', () => {
    const db = new AppDatabase(':memory:')
    const service = new TodoService(db)
    try {
        const a = service.save('a', input)
        const b = service.save('b', input)
        assert.deepEqual(db.getTodos('a'), [a])
        assert.deepEqual(db.getTodos('b'), [b])
        assert.equal(db.getTodo('b', a.id), null)
        assert.throws(() => service.save('b', {...a, completed: true}), /不存在/)
        assert.throws(() => service.remove('b', a.id), /不存在/)
        assert.deepEqual(db.getTodo('a', a.id), a)
        service.remove('a', a.id)
        assert.deepEqual(db.getTodos('b'), [b])
    } finally { db.close() }
})

test('待办保存至数据库，重启后保留内容和完成状态', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fdunav-todos-'))
    const path = join(directory, 'test.sqlite')
    try {
        const db = new AppDatabase(path)
        const service = new TodoService(db)
        const todo = service.save('a', {...input, completed: true})
        db.close()
        const reopened = new AppDatabase(path)
        try {
            assert.deepEqual(reopened.getTodos('a'), [todo])
            assert.deepEqual(reopened.getTodos('b'), [])
        } finally { reopened.close() }
    } finally { rmSync(directory, {recursive: true, force: true}) }
})

test('待办校验拒绝空标题、超长内容、非法日期、状态和编号', () => {
    for (const invalid of [null, [], {}, {...input, title: '  '}, {...input, title: '长'.repeat(201)},
        {...input, notes: '长'.repeat(5001)}, {...input, dueDate: '2026-02-30'}, {...input, dueDate: null},
        {...input, dueDate: '2101-01-01'}, {...input, completed: 'false'}, {...input, id: 'not-an-id'}]) {
        assert.equal(validateTodo(invalid).ok, false)
    }
    assert.equal(validateTodo({...input, dueDate: ''}).ok, true)
    assert.equal(validateTodo({...input, dueDate: '2028-02-29'}).ok, true)
})

test('无效更新不会破坏已保存待办', () => {
    const db = new AppDatabase(':memory:')
    const service = new TodoService(db)
    try {
        const todo = service.save('a', input)
        assert.throws(() => service.save('a', {...todo, title: ''}), /待办名称/)
        assert.deepEqual(db.getTodo('a', todo.id), todo)
    } finally { db.close() }
})

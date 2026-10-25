import {useEffect, useRef, useState} from 'react'
import {type Todo, type TodoInput, validateTodo} from '../../shared/todos'
import {localToday} from '../../shared/calendar'
import {Icon} from './Icon'
import {TodoDialog} from './TodoDialog'
import './styles/todos.css'

const filters = [{value: 'pending', label: '待完成'}, {value: 'completed', label: '已完成'}, {
    value: 'all',
    label: '全部'
}] as const
type Filter = typeof filters[number]['value']
type TodoTransition = { todo: Todo; stage: 'line' | 'exit' }
const emptyTodo = (): TodoInput => ({title: '', notes: '', dueDate: '', completed: false})

export function TodosPage() {
    const [todos, setTodos] = useState<Todo[]>([])
    const [filter, setFilter] = useState<Filter>('pending')
    const [loading, setLoading] = useState(true)
    const [loaded, setLoaded] = useState(false)
    const [busy, setBusy] = useState(false)
    const [transitions, setTransitions] = useState<Record<string, TodoTransition>>({})
    const [toggling, setToggling] = useState<Set<string>>(new Set())
    const [error, setError] = useState('')
    const [editor, setEditor] = useState<TodoInput | null>(null)
    const [today, setToday] = useState(localToday)
    const active = useRef(true)
    const pending = useRef(false)
    const pendingToggles = useRef(new Set<string>())
    const previousFocus = useRef<HTMLElement | null>(null)
    const addButton = useRef<HTMLButtonElement>(null)
    const restoreFocus = useRef(false)
    const api = window.todos

    async function load() {
        if (!api) {
            setLoading(false);
            return
        }
        setLoading(true)
        setError('')
        try {
            const result = await api.list()
            if (!active.current) return
            if (result.ok) {
                setTodos(result.data);
                setLoaded(true)
            } else setError(result.error)
        } catch {
            if (active.current) setError('无法读取待办，请重试。')
        } finally {
            if (active.current) setLoading(false)
        }
    }

    useEffect(() => {
        active.current = true
        // Deferring the initial read also prevents duplicate requests under Strict Mode.
        const start = window.setTimeout(() => void load(), 0)
        const timer = window.setInterval(() => setToday(localToday()), 60_000)
        return () => {
            active.current = false;
            window.clearTimeout(start);
            window.clearInterval(timer)
        }
    }, [])

    function openEditor(todo: TodoInput) {
        previousFocus.current = document.activeElement as HTMLElement
        setEditor({...todo})
        setError('')
    }

    const editing = editor !== null
    useEffect(() => {
        if (restoreFocus.current && !busy && !editing && toggling.size === 0) {
            restoreFocus.current = false
            if (previousFocus.current?.isConnected) previousFocus.current.focus()
            else addButton.current?.focus()
            previousFocus.current = null
        }
    }, [busy, editing, toggling])

    function closeEditor() {
        restoreFocus.current = true
        setError('')
        setEditor(null)
    }

    async function save(input: TodoInput, close = false) {
        if (!api || pending.current) return
        const checked = validateTodo(input)
        if (!checked.ok) {
            setError(checked.error);
            return
        }
        pending.current = true
        setBusy(true)
        setError('')
        try {
            const result = await api.save(checked.data)
            if (!active.current) return
            if (result.ok) {
                setTodos(current => [result.data, ...current.filter(todo => todo.id !== result.data.id)])
                if (close) {
                    if (!input.id) setFilter('pending')
                    closeEditor()
                }
            } else setError(result.error)
        } catch {
            if (active.current) setError('无法保存待办，请重试。')
        } finally {
            pending.current = false;
            if (active.current) setBusy(false)
        }
    }

    async function remove(todo: Todo) {
        if (!api || pending.current) return
        pending.current = true
        setBusy(true)
        setError('')
        try {
            const result = await api.remove(todo.id)
            if (!active.current) return
            if (result.ok) {
                setTodos(current => current.filter(item => item.id !== todo.id))
                restoreFocus.current = true
            } else setError(result.error)
        } catch {
            if (active.current) setError('无法删除待办，请重试。')
        } finally {
            pending.current = false;
            if (active.current) setBusy(false)
        }
    }

    function unlockToggle(id: string) {
        pendingToggles.current.delete(id)
        setToggling(new Set(pendingToggles.current))
    }

    async function toggleCompleted(todo: Todo) {
        if (!api || pending.current || pendingToggles.current.has(todo.id)) return
        pendingToggles.current.add(todo.id)
        setToggling(new Set(pendingToggles.current))
        setError('')
        let animating = false
        try {
            const result = await api.save({...todo, completed: !todo.completed})
            if (!active.current) return
            if (result.ok) {
                // Keep the row in its current list until both animation stages finish.
                animating = true
                setTransitions(current => ({...current, [todo.id]: {todo: result.data, stage: 'line'}}))
            } else setError(result.error)
        } catch {
            if (active.current) setError('无法更新待办状态，请重试。')
        } finally {
            if (!animating) {
                if (active.current) unlockToggle(todo.id)
                else pendingToggles.current.delete(todo.id)
            }
        }
    }

    function finishTransition(id: string, row: HTMLLIElement) {
        const transition = transitions[id]
        if (!transition || transition.stage !== 'exit' || !pendingToggles.current.has(id)) return
        if (filter !== 'all' && row.contains(document.activeElement)) {
            previousFocus.current = null
            restoreFocus.current = true
        }
        setTodos(current => current.map(todo => todo.id === transition.todo.id ? transition.todo : todo))
        setTransitions(current => {
            const next = {...current}
            delete next[id]
            return next
        })
        unlockToggle(id)
    }

    const remaining = todos.filter(todo => !todo.completed).length
    const visible = todos.filter(todo => filter === 'all' || todo.completed === (filter === 'completed'))
        .sort((left, right) => Number(left.completed) - Number(right.completed) ||
            (left.dueDate || '9999').localeCompare(right.dueDate || '9999') || right.createdAt.localeCompare(left.createdAt))

    return <section className="todos-page" aria-label="TODO">
        <div className="todos-toolbar">
            <div className="todos-filters" role="group" aria-label="筛选待办">
                {filters.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value}
                                             disabled={busy || toggling.size > 0}
                                             onClick={() => setFilter(item.value)}>
                    {item.label}<span>{item.value === 'all' ? todos.length : item.value === 'pending' ? remaining : todos.length - remaining}</span>
                </button>)}
            </div>
            <button ref={addButton} type="button" className="primary-button todos-add"
                    disabled={!loaded || busy || editing || toggling.size > 0} onClick={() => openEditor(emptyTodo())}>
                <Icon name="plus"/>新增待办
            </button>
        </div>
        {!api && <p className="account-notice">请在桌面应用中使用 TODO；若已打开桌面应用，请重启以加载待办服务。</p>}
        {error && !editor && <div className="account-error" role="alert">{error}{!loaded && api &&
            <button type="button" className="text-button" disabled={loading}
                    onClick={() => void load()}>重试</button>}</div>}
        {editor && <TodoDialog draft={editor} busy={busy} error={error}
                               onChange={draft => {
                                   setEditor(draft);
                                   setError('')
                               }}
                               onSave={() => void save(editor, true)} onClose={closeEditor}/>}
        {loading && <p className="todos-empty" role="status">正在读取待办…</p>}
        {loaded && !loading && <>
            <ul className="todo-list" aria-label="待办列表" aria-busy={busy || toggling.size > 0}>
                {visible.map(todo => {
                    const transition = transitions[todo.id]
                    return <li key={todo.id} className={`todo-row${todo.completed ? ' is-completed' : ''}${
                        transition ? ` is-transitioning ${transition.todo.completed ? 'is-completing' : 'is-reopening'}${transition.stage === 'exit' ? ' is-leaving' : ''}` : ''}`}
                               onAnimationEnd={event => {
                                   if (event.target === event.currentTarget && event.animationName === 'todo-row-exit') finishTransition(todo.id, event.currentTarget)
                               }}>
                        <button className="icon-button todo-check" type="button" aria-pressed={todo.completed}
                                aria-disabled={busy || editing || toggling.has(todo.id)}
                                disabled={busy || editing} title={todo.completed ? '标记为待完成' : '标记为已完成'}
                                aria-label={`${todo.completed ? '标记为待完成' : '标记为已完成'}：${todo.title}`}
                                onClick={() => void toggleCompleted(todo)}><Icon name="check"/></button>
                        <button className="todo-content" type="button" disabled={busy || editing || toggling.size > 0}
                                aria-label={`编辑待办：${todo.title}`} onClick={() => openEditor(todo)}>
                        <span className="todo-title"><span className="todo-title-text" onAnimationEnd={event => {
                            if (event.target === event.currentTarget && transition?.todo.id === todo.id && transition.stage === 'line' &&
                                (event.animationName === 'todo-strike-in' || event.animationName === 'todo-strike-out')) {
                                setTransitions(current => current[todo.id]?.stage === 'line'
                                    ? {...current, [todo.id]: {...current[todo.id], stage: 'exit'}} : current)
                            }
                        }}>{todo.title}</span></span>
                            {todo.notes && <span className="todo-notes">{todo.notes}</span>}
                            {todo.dueDate && <span
                                className={`todo-due${!todo.completed && todo.dueDate < today ? ' is-overdue' : ''}`}>
                            <Icon name="calendar"/><time dateTime={todo.dueDate}>{todo.dueDate}</time>
                                {!todo.completed && (todo.dueDate < today ? '已逾期' : todo.dueDate === today ? '今天截止' : '')}
                        </span>}
                        </button>
                        <button type="button" className="icon-button todo-delete"
                                disabled={busy || editing || toggling.has(todo.id)}
                                aria-label={`删除待办：${todo.title}`} title="删除待办"
                                onClick={() => void remove(todo)}><Icon name="close"/></button>
                    </li>
                })}
            </ul>
            {!visible.length && <div className="todos-empty" role="status"><Icon name="todo"/>
                <p>{filter === 'completed' ? '暂无已完成的待办' : filter === 'pending' ? '暂无待完成的代办' : '暂无待办'}</p>
            </div>}
        </>}
    </section>
}

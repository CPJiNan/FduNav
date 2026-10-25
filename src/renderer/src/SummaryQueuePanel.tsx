import {useEffect, useRef, useState} from 'react'
import {type NoticeRef, type SummaryTask, summaryTaskFinished} from '../../shared/notices'
import {Icon} from './Icon'
import './styles/summary-queue.css'

const statusLabels: Record<SummaryTask['status'], string> = {
    queued: '等待中', reading: '读取正文', generating: '生成摘要', saving: '保存摘要',
    completed: '已完成', failed: '失败', cancelled: '已取消'
}

export function SummaryQueuePanel({username, onOpenNotice}: {
    username: string | null | undefined; onOpenNotice: (notice: NoticeRef) => Promise<void>
}) {
    const [tasks, setTasks] = useState<SummaryTask[]>([])
    const [open, setOpen] = useState(false)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const container = useRef<HTMLDivElement>(null)
    const button = useRef<HTMLButtonElement>(null)
    const api = window.notices

    useEffect(() => {
        setTasks([])
        setOpen(false)
        setError('')
        if (!api || !username) return
        let active = true
        let version = 0
        const unsubscribe = api.onSummaryQueueChanged(value => {
            version++
            if (active) setTasks(value)
        })
        void api.summaryQueue().then(result => {
            if (active && version === 0 && result.ok) setTasks(result.data)
        }).catch(() => {
            if (active) setError('无法读取摘要队列。')
        })
        return () => {
            active = false;
            unsubscribe()
        }
    }, [api, username])

    useEffect(() => {
        if (!tasks.length) setOpen(false)
    }, [tasks])

    useEffect(() => {
        if (!open) return
        const close = (event: PointerEvent) => {
            if (!container.current?.contains(event.target as Node)) setOpen(false)
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                button.current?.focus()
            }
        }
        document.addEventListener('pointerdown', close)
        document.addEventListener('keydown', escape)
        return () => {
            document.removeEventListener('pointerdown', close)
            document.removeEventListener('keydown', escape)
        }
    }, [open])

    async function remove(id?: string) {
        if (!api || busy) return
        setBusy(true)
        setError('')
        try {
            const result = id ? await api.removeSummaries([id]) : await api.clearSummaryQueue()
            if (!result.ok) setError(result.error)
        } catch {
            setError('无法更新摘要队列，请重试。')
        } finally {
            setBusy(false)
        }
    }

    async function openNotice(task: SummaryTask) {
        if (busy) return
        setBusy(true)
        setError('')
        try {
            await onOpenNotice({sourceId: task.sourceId, url: task.url})
            setOpen(false)
        } catch (error) {
            setError(error instanceof Error ? error.message : '无法打开通知，请重试。')
        } finally {
            setBusy(false)
        }
    }

    if (!tasks.length) return null
    const pending = tasks.filter(task => !summaryTaskFinished(task))
    const orderedTasks = [...pending, ...tasks.filter(summaryTaskFinished).reverse()]
    return <div className="summary-queue-anchor" ref={container}>
        <button ref={button} type="button" className={`icon-button rail-button ${open ? 'is-active' : ''}`}
                aria-label={`摘要队列，${pending.length} 项待完成`} title="摘要队列"
                aria-expanded={open} aria-controls="summary-queue-panel" onClick={() => setOpen(value => !value)}>
            <Icon name="sparkles"/>{pending.length > 0 && <span className="summary-queue-count">{pending.length}</span>}
        </button>
        {open && <section id="summary-queue-panel" className="summary-queue-panel" aria-label="摘要队列">
            <div className="summary-queue-scroll">
                {error && <p className="summary-queue-error" role="alert">{error}</p>}
                <ul className="summary-queue-list">
                    {orderedTasks.map(task => {
                        const active = !summaryTaskFinished(task) && task.status !== 'queued'
                        return <li key={task.id} className={`summary-queue-card ${active ? 'is-running' : ''}`}>
                            <button type="button" className="summary-queue-card-open" disabled={busy}
                                    aria-label={`打开通知：${task.title}`} onClick={() => void openNotice(task)}>
                                <span className="summary-queue-card-meta">
                                    <span className={`summary-queue-card-status is-${task.status}`}>
                                        <Icon
                                            name={task.status === 'completed' ? 'check' : task.status === 'failed' ? 'info' : 'sparkles'}/>
                                        {statusLabels[task.status]}
                                    </span>
                                </span>
                                <span className="summary-queue-task-title">{task.title}</span>
                                {active && <progress className="summary-queue-progress summary-queue-task-progress"
                                                     aria-label={`${task.title}：${statusLabels[task.status]}`}/>}
                                {task.error && <span className="summary-queue-error">{task.error}</span>}
                            </button>
                            <button type="button" className="icon-button summary-queue-delete" disabled={busy}
                                    title="删除卡片" aria-label={`删除卡片：${task.title}`}
                                    onClick={() => void remove(task.id)}><Icon name="close"/></button>
                        </li>
                    })}
                </ul>
            </div>
            <footer className="summary-queue-footer">
                <button type="button" className="summary-queue-command"
                        disabled={busy || !tasks.some(task => task.status === 'completed')}
                        onClick={() => void remove()}>全部清除
                </button>
            </footer>
        </section>}
    </div>
}

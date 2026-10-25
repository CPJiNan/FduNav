import {useEffect, useRef, useState} from 'react'
import type {MessageSource, SourceId} from '../../shared/sources'
import {Icon} from './Icon'
import './styles/sources.css'

export function SourcesPanel({active}: { active: boolean }) {
    const [sources, setSources] = useState<MessageSource[]>([])
    const [busy, setBusy] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState('')
    const [retry, setRetry] = useState(0)
    const [dragging, setDragging] = useState<SourceId | null>(null)
    const [dropTarget, setDropTarget] = useState<{id: SourceId; after: boolean} | null>(null)
    const [status, setStatus] = useState('')
    const mutation = useRef(false)
    const requestVersion = useRef(0)
    const api = window.sources

    useEffect(() => {
        if (!active || !api) return
        let cancelled = false
        const version = ++requestVersion.current
        setBusy(true)
        setError('')
        void api.list().then(result => {
            if (cancelled || version !== requestVersion.current) return
            if (result.ok) {
                setSources(result.data);
                setLoaded(true)
            } else setError(result.error)
        }).catch(() => {
            if (!cancelled && version === requestVersion.current) setError('无法读取消息来源。')
        }).finally(() => {
            if (!cancelled && version === requestVersion.current) setBusy(false)
        })
        return () => {
            cancelled = true
        }
    }, [active, api, retry])

    async function toggle(source: MessageSource, enabled: boolean) {
        if (!api || busy || mutation.current) return
        mutation.current = true
        const version = ++requestVersion.current
        setBusy(true)
        setError('')
        try {
            const result = await api.setEnabled(source.id, enabled)
            if (version !== requestVersion.current) return
            if (result.ok) setSources(result.data)
            else setError(result.error)
        } catch {
            if (version === requestVersion.current) setError('来源操作失败，请重试。')
        } finally {
            mutation.current = false
            if (version === requestVersion.current) setBusy(false)
        }
    }

    async function move(id: SourceId, target: SourceId, after: boolean) {
        setDragging(null)
        setDropTarget(null)
        if (!api || busy || mutation.current || id === target) return
        const source = sources.find(item => item.id === id)
        if (!source) return
        const next = sources.filter(item => item.id !== id)
        const index = next.findIndex(item => item.id === target)
        if (index < 0) return
        next.splice(index + Number(after), 0, source)
        if (next.every((item, position) => item.id === sources[position].id)) return
        mutation.current = true
        const version = ++requestVersion.current
        setBusy(true)
        setError('')
        setStatus('')
        setSources(next)
        try {
            const result = await api.reorder(next.map(item => item.id))
            if (version !== requestVersion.current) return
            if (result.ok) {
                setSources(result.data)
                setStatus(`已将${source.name}移至第 ${index + Number(after) + 1} 位`)
            } else { setSources(sources); setError(result.error) }
        } catch {
            if (version === requestVersion.current) { setSources(sources); setError('排序保存失败，请重试。') }
        } finally {
            mutation.current = false
            if (version === requestVersion.current) setBusy(false)
        }
    }

    return <div className="sources-panel" aria-busy={busy}>
        <span className="source-sort-announcement" role="status">{status}</span>
        {busy && <span className="source-status" role="status">处理中…</span>}
        {!api && <p className="account-error" role="alert">消息来源服务不可用。</p>}
        {error && <div className="source-error">
            <p className="account-error" role="alert">{error}</p>
            {!loaded && api && <button type="button" className="secondary-button" disabled={busy}
                                       onClick={() => setRetry(value => value + 1)}>重试</button>}
        </div>}
        <ul className="source-list" aria-label="消息来源">
            {sources.map((source, index) => <li key={source.id}
                className={`${dragging === source.id ? 'is-dragging' : ''} ${dropTarget?.id === source.id ? dropTarget.after ? 'drop-after' : 'drop-before' : ''}`}
                onDragOver={event => {
                    if (!dragging || busy) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    const bounds = event.currentTarget.getBoundingClientRect()
                    setDropTarget({id: source.id, after: event.clientY > bounds.top + bounds.height / 2})
                }}
                onDragLeave={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
                }}
                onDrop={event => {
                    event.preventDefault()
                    if (!dragging) return
                    const bounds = event.currentTarget.getBoundingClientRect()
                    void move(dragging, source.id, event.clientY > bounds.top + bounds.height / 2)
                }}>
                <button type="button" className="icon-button source-drag-handle" draggable={!busy && !!api}
                        aria-label={`排序 ${source.name}`} aria-disabled={busy || !api}
                        title="拖动排序"
                        onDragStart={event => {
                            if (busy || !api) { event.preventDefault(); return }
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', source.id)
                            setDragging(source.id)
                        }}
                        onDragEnd={() => { setDragging(null); setDropTarget(null) }}
                        onKeyDown={event => {
                            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                            event.preventDefault()
                            const after = event.key === 'ArrowDown'
                            const target = sources[index + (after ? 1 : -1)]
                            if (target) void move(source.id, target.id, after)
                        }}><Icon name="grip"/></button>
                <div className="source-info"><strong>{source.name}</strong><span
                    className="source-url">{source.url}</span>
                    {source.lastError && <span className="source-status source-failed">{source.lastError}</span>}
                </div>
                <label className="source-enabled"><input type="checkbox" checked={source.enabled}
                                                         aria-label={`启用来源 ${source.name}`} disabled={busy || !api}
                                                         onChange={event => void toggle(source, event.target.checked)}/>启用</label>
            </li>)}
        </ul>
        {loaded && !sources.length && <p className="source-status" role="status">暂无来源</p>}
    </div>
}

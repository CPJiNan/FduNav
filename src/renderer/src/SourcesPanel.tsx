import {useEffect, useState} from 'react'
import type {MessageSource} from '../../shared/sources'
import './styles/sources.css'

export function SourcesPanel({active}: { active: boolean }) {
    const [sources, setSources] = useState<MessageSource[]>([])
    const [busy, setBusy] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState('')
    const [retry, setRetry] = useState(0)
    const api = window.sources

    useEffect(() => {
        if (!active || !api) return
        let cancelled = false
        setBusy(true)
        setError('')
        void api.list().then(result => {
            if (cancelled) return
            if (result.ok) {
                setSources(result.data);
                setLoaded(true)
            } else setError(result.error)
        }).catch(() => {
            if (!cancelled) setError('无法读取消息来源。')
        }).finally(() => {
            if (!cancelled) setBusy(false)
        })
        return () => {
            cancelled = true
        }
    }, [active, api, retry])

    async function toggle(source: MessageSource, enabled: boolean) {
        if (!api || busy) return
        setBusy(true)
        setError('')
        try {
            const result = await api.setEnabled(source.id, enabled)
            if (result.ok) setSources(result.data)
            else setError(result.error)
        } catch {
            setError('来源操作失败，请重试。')
        } finally {
            setBusy(false)
        }
    }

    return <div className="sources-panel" aria-busy={busy}>
        {busy && <span className="source-status" role="status">处理中…</span>}
        {!api && <p className="account-error" role="alert">消息来源服务不可用。</p>}
        {error && <div className="source-error">
            <p className="account-error" role="alert">{error}</p>
            {!loaded && api && <button type="button" className="secondary-button" disabled={busy}
                                       onClick={() => setRetry(value => value + 1)}>重试</button>}
        </div>}
        <ul className="source-list" aria-label="消息来源">
            {sources.map(source => <li key={source.id}>
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

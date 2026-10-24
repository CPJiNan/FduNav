import {type FormEvent, useEffect, useRef, useState} from 'react'
import type {Result} from '../../shared/accounts'
import {sourcePresets, validateSource, type MessageSource, type SourceInput} from '../../shared/sources'
import './styles/sources.css'

export function SourcesPanel({active}: {active: boolean}) {
    const [sources, setSources] = useState<MessageSource[]>([])
    const [draft, setDraft] = useState<SourceInput | null>(null)
    const [busy, setBusy] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState('')
    const [retry, setRetry] = useState(0)
    const [deleting, setDeleting] = useState<MessageSource | null>(null)
    const dialog = useRef<HTMLDialogElement>(null)
    const cancelDelete = useRef<HTMLButtonElement>(null)
    const nameInput = useRef<HTMLInputElement>(null)
    const addButton = useRef<HTMLButtonElement>(null)
    const api = window.sources

    useEffect(() => {
        if (!active || !api) return
        let cancelled = false
        setBusy(true)
        setError('')
        void api.list().then(result => {
            if (cancelled) return
            if (result.ok) { setSources(result.data); setLoaded(true) }
            else setError(result.error)
        }).catch(() => {
            if (!cancelled) setError('无法读取消息来源。')
        }).finally(() => { if (!cancelled) setBusy(false) })
        return () => { cancelled = true }
    }, [active, api, retry])

    useEffect(() => {
        if (draft) nameInput.current?.focus()
    }, [draft?.id, draft !== null])

    useEffect(() => {
        const element = dialog.current
        if (!deleting || !element) return
        element.showModal()
        cancelDelete.current?.focus()
        return () => { if (element.open) element.close() }
    }, [deleting])

    function closeDialog() {
        if (busy) return
        dialog.current?.close()
        setDeleting(null)
    }

    async function perform(action: () => Promise<Result<MessageSource[]>>) {
        if (busy) return false
        setBusy(true)
        setError('')
        try {
            const result = await action()
            if (!result.ok) { setError(result.error); return false }
            setSources(result.data)
            return true
        } catch {
            setError('来源操作失败，请重试。')
            return false
        } finally { setBusy(false) }
    }

    async function save(event: FormEvent) {
        event.preventDefault()
        if (!api || !draft) return
        const result = validateSource(draft)
        if (!result.ok) { setError(result.error); return }
        if (await perform(() => api.save(result.data))) {
            setDraft(null)
            addButton.current?.focus()
        }
    }

    async function remove() {
        if (!api || !deleting) return
        const id = deleting.id
        // Close before the request so an error remains visible in the panel.
        closeDialog()
        if (await perform(() => api.remove(id))) addButton.current?.focus()
    }

    return <div className="sources-panel" aria-busy={busy}>
        <div className="source-toolbar">
            <button ref={addButton} type="button" className="secondary-button" disabled={!api || busy || !loaded || !!draft}
                    onClick={() => { setDraft({name: '', url: '', enabled: true, preset: 'generic'}); setError('') }}>新增来源</button>
            {busy && <span className="source-status" role="status">处理中…</span>}
        </div>
        {!api && <p className="account-error" role="alert">消息来源服务不可用。</p>}
        {error && <div className="source-error">
            <p className="account-error" role="alert">{error}</p>
            {!loaded && api && <button type="button" className="secondary-button" disabled={busy}
                                      onClick={() => setRetry(value => value + 1)}>重试</button>}
        </div>}
        {draft && <form className="source-form" onSubmit={save}>
            <fieldset disabled={busy}>
                <div className="source-field">
                    <label htmlFor="source-preset">读取预设</label>
                    <select id="source-preset" value={draft.preset} onChange={event => {
                        const preset = sourcePresets.find(item => item.id === event.target.value)!
                        setDraft({...draft, preset: preset.id, ...(preset.url ? {name: preset.name, url: preset.url} : {})})
                    }}>
                        {sourcePresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                    </select>
                </div>
                <div className="source-field">
                    <label htmlFor="source-name">名称</label>
                    <input ref={nameInput} id="source-name" value={draft.name} maxLength={60} required
                           onChange={event => setDraft({...draft, name: event.target.value})}/>
                </div>
                <div className="source-field">
                    <label htmlFor="source-url">网址</label>
                    <input id="source-url" type="url" value={draft.url} maxLength={2048} required
                           onChange={event => setDraft({...draft, url: event.target.value})}/>
                </div>
                <label className="source-enabled"><input type="checkbox" checked={draft.enabled}
                       onChange={event => setDraft({...draft, enabled: event.target.checked})}/>启用</label>
                <div className="source-actions">
                    <button type="submit" className="primary-button">保存</button>
                    <button type="button" className="secondary-button" onClick={() => {
                        setDraft(null); setError(''); addButton.current?.focus()
                    }}>取消</button>
                </div>
            </fieldset>
        </form>}
        <ul className="source-list" aria-label="消息来源">
            {sources.map(source => <li key={source.id}>
                <div className="source-info"><strong>{source.name}</strong><span className="source-url">{source.url}</span>
                    {source.lastError && <span className="source-status source-failed">{source.lastError}</span>}
                </div>
                <div className="source-actions">
                    <label className="source-enabled"><input type="checkbox" checked={source.enabled}
                           aria-label={`启用来源 ${source.name}`} disabled={busy || !!draft || !api}
                           onChange={event => {
                               const enabled = event.target.checked
                               if (api) void perform(() => api.save({...source, enabled}))
                           }}/>启用</label>
                    <button type="button" className="secondary-button" disabled={busy || !!draft}
                            aria-label={`编辑来源 ${source.name}`} onClick={() => {
                                setDraft({id: source.id, name: source.name, url: source.url, enabled: source.enabled, preset: source.preset}); setError('')
                            }}>编辑</button>
                    <button type="button" className="secondary-button" disabled={busy || !!draft}
                            aria-label={`删除来源 ${source.name}`} onClick={() => setDeleting(source)}>删除</button>
                </div>
            </li>)}
        </ul>
        {loaded && !sources.length && !draft && <p className="source-status" role="status">暂无来源</p>}
        <dialog ref={dialog} className="source-delete-dialog" aria-labelledby="source-delete-question"
                onCancel={event => { event.preventDefault(); closeDialog() }}
                onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}>
            <p id="source-delete-question">删除来源“{deleting?.name}”及其缓存通知？</p>
            <div className="source-actions">
                <button ref={cancelDelete} type="button" className="secondary-button" onClick={closeDialog}>取消</button>
                <button type="button" className="primary-button" onClick={() => void remove()}>删除</button>
            </div>
        </dialog>
    </div>
}

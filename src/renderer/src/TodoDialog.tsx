import {useEffect, useRef} from 'react'
import type {TodoInput} from '../../shared/todos'
import {Icon} from './Icon'
import './styles/calendar.css'

export function TodoDialog({draft, busy, error, onChange, onSave, onClose}: {
    draft: TodoInput; busy: boolean; error: string;
    onChange: (draft: TodoInput) => void; onSave: () => void; onClose: () => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const title = useRef<HTMLInputElement>(null)
    useEffect(() => {
        dialog.current?.showModal()
        title.current?.focus()
    }, [])

    return <dialog className="calendar-dialog" ref={dialog} aria-label={draft.id ? '编辑待办' : '新建待办'}
                   aria-busy={busy} onClose={onClose}
                   onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
                   onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
                   onClick={event => {
                       if (busy || event.target !== dialog.current) return
                       const bounds = event.currentTarget.getBoundingClientRect()
                       if (event.clientX < bounds.left || event.clientX > bounds.right ||
                           event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
                   }}>
        <div className="calendar-dialog-header">
            <strong>{draft.id ? '编辑待办' : '新建待办'}</strong>
            <button type="button" className="icon-button" aria-label="关闭待办" disabled={busy}
                    onClick={onClose}><Icon name="close"/></button>
        </div>
        <form className="calendar-event-form" onSubmit={event => { event.preventDefault(); onSave() }}>
            <label>名称<input ref={title} autoFocus value={draft.title} required maxLength={200} disabled={busy}
                              onChange={event => onChange({...draft, title: event.target.value})}/></label>
            <label>截止日期<input type="date" min="1900-01-01" max="2100-12-31" value={draft.dueDate}
                                        disabled={busy} onChange={event => onChange({...draft, dueDate: event.target.value})}/></label>
            <label>备注<textarea rows={3} maxLength={5000} value={draft.notes} disabled={busy}
                                 onChange={event => onChange({...draft, notes: event.target.value})}/></label>
            {error && <p className="account-error" role="alert">{error}</p>}
            <div className="calendar-dialog-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
                <button type="submit" className="primary-button" disabled={busy}>{busy ? '正在保存…' : '保存'}</button>
            </div>
        </form>
    </dialog>
}

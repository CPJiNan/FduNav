import {useEffect, useRef} from 'react'
import './styles/calendar.css'

export function NoticeReadDialog({count, busy, error, onConfirm, onClose}: {
    count: number; busy: boolean; error: string; onConfirm: () => void; onClose: () => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    useEffect(() => {
        const element = dialog.current!
        element.showModal()
        return () => element.close()
    }, [])

    return <dialog ref={dialog} className="calendar-dialog" aria-labelledby="notice-read-title"
                   aria-describedby="notice-read-description" aria-busy={busy}
                   onCancel={event => {
                       event.preventDefault()
                       if (!busy) onClose()
                   }} onKeyDown={event => {
                       if (event.key === 'Escape') event.stopPropagation()
                   }}>
        <div className="calendar-dialog-header"><strong id="notice-read-title">一键已读</strong></div>
        <p id="notice-read-description">确认将当前 {count} 条未读通知标记为已读？</p>
        {error && <p className="account-error" role="alert">{error}</p>}
        <div className="calendar-dialog-actions">
            <button type="button" className="secondary-button" autoFocus disabled={busy} onClick={onClose}>取消</button>
            <button type="button" className="primary-button" disabled={busy}
                    onClick={onConfirm}>{busy ? '正在标记…' : '确认已读'}</button>
        </div>
    </dialog>
}

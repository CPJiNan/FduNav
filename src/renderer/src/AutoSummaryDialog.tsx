import {useEffect, useRef} from 'react'
import './styles/calendar.css'

export function AutoSummaryDialog({busy, error, onConfirm, onClose}: {
    busy: boolean; error: string; onConfirm: () => void; onClose: () => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    useEffect(() => {
        const element = dialog.current!
        element.showModal()
        return () => element.close()
    }, [])

    return <dialog ref={dialog} className="calendar-dialog" aria-labelledby="auto-summary-title"
                   aria-describedby="auto-summary-description" aria-busy={busy}
                   onCancel={event => {
                       event.preventDefault()
                       if (!busy) onClose()
                   }} onKeyDown={event => {
        if (event.key === 'Escape') event.stopPropagation()
    }}>
        <div className="calendar-dialog-header"><strong id="auto-summary-title">开启自动 AI 摘要</strong></div>
        <p id="auto-summary-description">开启后，将自动为新通知生成 AI 摘要，可能产生 API 费用。确认开启？</p>
        {error && <p className="account-error" role="alert">{error}</p>}
        <div className="calendar-dialog-actions">
            <button type="button" className="secondary-button" autoFocus disabled={busy} onClick={onClose}>取消</button>
            <button type="button" className="primary-button" disabled={busy}
                    onClick={onConfirm}>{busy ? '正在开启…' : '确认开启'}</button>
        </div>
    </dialog>
}

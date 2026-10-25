import {useEffect, useId, useRef, useState} from 'react'
import type {NoticeRef, NoticeRelevance, NoticeRelevanceChoice} from '../../shared/notices'
import {Icon} from './Icon'

const choices: { value: NoticeRelevanceChoice; label: string }[] = [
    {value: 'related', label: '与我有关'},
    {value: 'maybe', label: '可能有关'},
    {value: 'none', label: '与我无关'}
]

export function NoticeRelevanceMenu({notice, relevance, onChanged}: {
    notice: NoticeRef; relevance: NoticeRelevance | null | undefined;
    onChanged: (value: NoticeRelevance | null) => void
}) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const root = useRef<HTMLDivElement>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    const items = useRef<(HTMLButtonElement | null)[]>([])
    const active = useRef(true)
    const menuId = useId()
    const value = relevance ?? 'none'

    useEffect(() => {
        active.current = true
        return () => {
            active.current = false
        }
    }, [])

    useEffect(() => {
        if (!open) return
        items.current[choices.findIndex(choice => choice.value === value)]?.focus()
        const dismiss = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('pointerdown', dismiss)
        return () => document.removeEventListener('pointerdown', dismiss)
    }, [open, value])

    async function choose(choice: NoticeRelevanceChoice) {
        if (saving || !window.notices) return
        setSaving(true)
        setError('')
        setOpen(false)
        trigger.current?.focus()
        try {
            const result = await window.notices.setRelevance(notice, choice)
            if (!active.current) return
            if (result.ok) onChanged(result.data)
            else setError(result.error)
        } catch {
            if (active.current) setError('无法保存选择，请重试。')
        } finally {
            if (active.current) setSaving(false)
        }
    }

    return <div className="notice-relevance-select" ref={root}
                onBlur={event => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
                }}
                onKeyDown={event => {
                    if (event.key === 'Escape' && open) {
                        event.preventDefault()
                        event.stopPropagation()
                        setOpen(false)
                        trigger.current?.focus()
                    }
                }}>
        <button ref={trigger} type="button" className="text-button notice-relevance-trigger"
                aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
                aria-disabled={saving || !window.notices} aria-busy={saving}
                onClick={() => {
                    if (saving || !window.notices) return
                    setOpen(current => !current)
                }} onKeyDown={event => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !saving && window.notices) {
                event.preventDefault()
                setOpen(true)
            }
        }}>
            {choices.find(choice => choice.value === value)!.label}<Icon name="chevron"/>
        </button>
        {open && <div id={menuId} className="notice-relevance-menu" role="menu" aria-label="通知相关性"
                      onKeyDown={event => {
                          const index = items.current.indexOf(document.activeElement as HTMLButtonElement)
                          const next = event.key === 'ArrowDown' ? (index + 1) % choices.length
                              : event.key === 'ArrowUp' ? (index + choices.length - 1) % choices.length
                                  : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : -1
                          if (next >= 0) {
                              event.preventDefault();
                              items.current[next]?.focus()
                          }
                      }}>
            {choices.map((choice, index) => <button key={choice.value} type="button" role="menuitemradio"
                                                    aria-checked={value === choice.value} tabIndex={-1}
                                                    ref={element => {
                                                        items.current[index] = element
                                                    }}
                                                    onClick={() => void choose(choice.value)}>
                {choice.label}{value === choice.value && <Icon name="check"/>}
            </button>)}
        </div>}
        {error && <p className="account-error notice-relevance-error" role="alert">{error}</p>}
    </div>
}

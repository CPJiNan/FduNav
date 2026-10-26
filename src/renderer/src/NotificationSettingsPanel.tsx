import {useEffect, useState} from 'react'
import {
    isNoticeRefreshInterval,
    isNoticeReminderMode,
    noticeReminderOptions,
    noticeRefreshOptions,
    type NotificationSettings,
} from '../../shared/notification-settings'
import {AutoSummaryDialog} from './AutoSummaryDialog'
import {calendarReminderOptions, isCalendarReminderMinutes} from '../../shared/calendar-reminders'
import './styles/general.css'
import './styles/llm.css'

export function NotificationSettingsPanel() {
    const [settings, setSettings] = useState<NotificationSettings | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [retry, setRetry] = useState(0)
    const [confirmAutoSummary, setConfirmAutoSummary] = useState(false)
    const api = window.notificationSettings

    useEffect(() => {
        if (!api) return
        let active = true
        setBusy(true)
        setError('')
        void api.get().then(result => {
            if (!active) return
            if (result.ok) setSettings(result.data)
            else setError(result.error)
        }).catch(() => {
            if (active) setError('无法读取通知设置，请重试。')
        }).finally(() => {
            if (active) setBusy(false)
        })
        return () => { active = false }
    }, [api, retry])

    async function setRefreshInterval(interval: number) {
        if (!api || busy || !settings || !isNoticeRefreshInterval(interval)) return
        setBusy(true)
        setError('')
        try {
            const result = await api.setRefreshInterval(interval)
            if (result.ok) {
                setSettings(result.data)
            } else setError(result.error)
        } catch {
            setError('无法保存通知设置，请重试。')
        } finally {
            setBusy(false)
        }
    }

    async function setReminderMode(mode: string) {
        if (!api || busy || !settings || !isNoticeReminderMode(mode)) return
        setBusy(true)
        setError('')
        try {
            const result = await api.setReminderMode(mode)
            if (result.ok) {
                setSettings(result.data)
            } else setError(result.error)
        } catch {
            setError('无法保存通知设置，请重试。')
        } finally {
            setBusy(false)
        }
    }

    async function setAutoSummary(enabled: boolean) {
        if (!api || busy || !settings) return
        setBusy(true)
        setError('')
        try {
            const result = await api.setAutoSummary(enabled)
            if (result.ok) {
                setSettings(result.data)
                setConfirmAutoSummary(false)
            } else setError(result.error)
        } catch {
            setError('无法保存通知设置，请重试。')
        } finally {
            setBusy(false)
        }
    }

    async function setDefaultReminder(kind: 'calendar' | 'todo', minutes: number) {
        if (!api || busy || !settings || !isCalendarReminderMinutes(minutes)) return
        setBusy(true)
        setError('')
        try {
            const result = await (kind === 'calendar' ? api.setCalendarDefaultReminder(minutes) : api.setTodoDefaultReminder(minutes))
            if (result.ok) {
                setSettings(result.data)
            } else setError(result.error)
        } catch {
            setError('无法保存默认提醒时间，请重试。')
        } finally {
            setBusy(false)
        }
    }

    return <div className="general-panel">
        <fieldset className="general-setting-group" aria-busy={busy}>
            <legend>通知</legend>
            <div className="general-setting-row">
                <label htmlFor="notice-reminder-mode">新通知提醒</label>
                <select id="notice-reminder-mode" value={settings?.reminderMode ?? 'all'}
                        disabled={!api || !settings || busy}
                        onChange={event => void setReminderMode(event.target.value)}>
                    {noticeReminderOptions.map(option =>
                        <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </div>
            <div className="general-setting-row">
                <label htmlFor="notice-refresh-interval">自动刷新通知</label>
                <select id="notice-refresh-interval" value={settings?.refreshInterval ?? 0}
                        disabled={!api || !settings || busy}
                        onChange={event => void setRefreshInterval(Number(event.target.value))}>
                    {noticeRefreshOptions.map(option =>
                        <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </div>
            <div className="general-setting-row">
                <label id="auto-summary-label" htmlFor="auto-summary">自动 AI 摘要</label>
                <button id="auto-summary" type="button" className="llm-switch" role="switch"
                        aria-labelledby="auto-summary-label" aria-checked={settings?.autoSummary ?? false}
                        disabled={!api || !settings || busy}
                        onClick={() => {
                            if (settings?.autoSummary) void setAutoSummary(false)
                            else {
                                setError('')
                                setConfirmAutoSummary(true)
                            }
                        }}>
                    <span className="llm-switch-track" aria-hidden="true"><span/></span>
                </button>
            </div>
        </fieldset>
        <fieldset className="general-setting-group" aria-busy={busy}>
            <legend>日历</legend>
            <div className="general-setting-row">
                <label htmlFor="calendar-default-reminder">默认提醒时间</label>
                <select id="calendar-default-reminder" value={settings?.calendarDefaultReminder ?? 30}
                        disabled={!api || !settings || busy}
                        onChange={event => void setDefaultReminder('calendar', Number(event.target.value))}>
                    {calendarReminderOptions.map(option =>
                        <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </div>
        </fieldset>
        <fieldset className="general-setting-group" aria-busy={busy}>
            <legend>待办</legend>
            <div className="general-setting-row">
                <label htmlFor="todo-default-reminder">默认提醒时间</label>
                <select id="todo-default-reminder" value={settings?.todoDefaultReminder ?? 120}
                        disabled={!api || !settings || busy}
                        onChange={event => void setDefaultReminder('todo', Number(event.target.value))}>
                    {calendarReminderOptions.map(option =>
                        <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </div>
        </fieldset>
        <div>
            {!api && <p className="account-notice">请在桌面应用中设置。</p>}
            {busy && <p className="save-status" role="status">{settings ? '正在保存…' : '正在读取设置…'}</p>}
            {error && !confirmAutoSummary && <p className="account-error" role="alert">{error}{!settings &&
                <button type="button" className="text-button" disabled={busy}
                        onClick={() => setRetry(value => value + 1)}>重试</button>}</p>}
        </div>
        {confirmAutoSummary && <AutoSummaryDialog busy={busy} error={error}
                                                 onConfirm={() => void setAutoSummary(true)} onClose={() => {
                                                     setConfirmAutoSummary(false)
                                                     setError('')
                                                 }}/>}
    </div>
}

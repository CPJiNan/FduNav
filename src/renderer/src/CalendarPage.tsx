import {useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react'
import {dateAfter, type Timetable} from '../../shared/timetable'
import {calendarDate, calendarOccurrences, calendarRange, calendarViews, dayDifference, localToday,
    weekStartDate, type CalendarEvent, type CalendarOccurrence, type CalendarView} from '../../shared/calendar'
import {CalendarAgenda, CalendarMonth, CalendarTimeline, CalendarYear} from './CalendarViews'
import {CalendarEventDialog} from './CalendarEventDialog'
import {Icon} from './Icon'
import './styles/calendar.css'

export function CalendarPage() {
    const [view, setView] = useState<CalendarView>('week')
    const [date, setDate] = useState(localToday)
    const [today, setToday] = useState(localToday)
    const [timetable, setTimetable] = useState<Timetable | null>(null)
    const [events, setEvents] = useState<CalendarEvent[]>([])
    const [busy, setBusy] = useState(false)
    const [eventsLoading, setEventsLoading] = useState(false)
    const [error, setError] = useState('')
    const [eventError, setEventError] = useState('')
    const [agendaDays, setAgendaDays] = useState(30)
    const [editor, setEditor] = useState<{item: CalendarOccurrence | null; create: boolean} | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const requestId = useRef(0)
    const eventRequestId = useRef(0)
    const pending = useRef(false)
    const previousFocus = useRef<HTMLElement | null>(null)
    const page = useRef<HTMLElement | null>(null)

    async function loadTimetable(refresh = false, semesterId?: string) {
        if (pending.current) return
        if (!window.timetable) { setError('请在桌面应用中获取课表。'); return }
        pending.current = true
        const id = ++requestId.current
        setBusy(true)
        setError('')
        try {
            const result = await window.timetable.get({refresh, semesterId})
            if (id !== requestId.current) return
            if (!result.ok) setError(result.error)
            else {
                setTimetable(result.data)
                if (semesterId && semesterId !== timetable?.semesterId && result.data.startDate) setDate(result.data.startDate)
                if (!result.data.startDate) setSettingsOpen(true)
            }
        } catch { if (id === requestId.current) setError('无法连接课表服务，请重试。') }
        finally { if (id === requestId.current) { pending.current = false; setBusy(false) } }
    }

    async function loadEvents() {
        if (!window.calendar) return
        const id = ++eventRequestId.current
        setEventsLoading(true)
        setEventError('')
        try {
            const result = await window.calendar.list()
            if (id !== eventRequestId.current) return
            if (result.ok) setEvents(result.data)
            else setEventError(result.error)
        } catch { if (id === eventRequestId.current) setEventError('无法读取个人日程，请重试。') }
        finally { if (id === eventRequestId.current) setEventsLoading(false) }
    }

    useEffect(() => {
        const timer = window.setTimeout(() => { void loadTimetable(); void loadEvents() }, 0)
        const todayTimer = window.setInterval(() => setToday(localToday()), 60_000)
        return () => { window.clearTimeout(timer); window.clearInterval(todayTimer); requestId.current++; eventRequestId.current++; pending.current = false }
    }, [])
    useEffect(() => { setAgendaDays(30) }, [date, view])
    useEffect(() => { page.current?.querySelector('.calendar-view')?.scrollTo({top: 0}) }, [date, view])

    async function changeStartDate(value: string) {
        if (!window.timetable || pending.current || !value) return
        pending.current = true
        const id = ++requestId.current
        setBusy(true)
        setError('')
        try {
            const result = await window.timetable.setStartDate(value)
            if (id !== requestId.current) return
            if (!result.ok) setError(result.error)
            else { setTimetable(result.data); setDate(value) }
        } catch { if (id === requestId.current) setError('无法保存开学日期，请重试。') }
        finally { if (id === requestId.current) { pending.current = false; setBusy(false) } }
    }

    const range = calendarRange(date, view)
    if (view === 'agenda') range[1] = dateAfter(date, agendaDays - 1)
    const items = useMemo(() => calendarOccurrences(timetable, events, range[0], range[1]), [timetable, events, range[0], range[1]])
    const week = timetable?.startDate ? Math.floor(dayDifference(weekStartDate(date), timetable.startDate) / 7) + 1 : null
    const weekCount = timetable ? Math.max(18, ...timetable.courses.flatMap(course => course.weeks)) : 18
    const title = view === 'year' ? `${date.slice(0, 4)}年` : `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`

    function chooseDate(next: string, nextView?: CalendarView) {
        if (!calendarDate(next)) return
        setDate(next)
        if (nextView) setView(nextView)
    }
    function openItem(item: CalendarOccurrence | null) {
        previousFocus.current = document.activeElement as HTMLElement
        setEditor({item, create: !item})
    }
    function closeEditor() {
        setEditor(null)
        requestAnimationFrame(() => previousFocus.current?.isConnected && previousFocus.current.focus())
    }
    function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        const offsets: Record<string, number> = {ArrowRight: 1, ArrowLeft: -1, Home: -index, End: calendarViews.length - 1 - index}
        if (!(event.key in offsets)) return
        event.preventDefault()
        const next = calendarViews[(index + offsets[event.key] + calendarViews.length) % calendarViews.length]
        setView(next.id)
        document.getElementById(`calendar-tab-${next.id}`)?.focus()
    }
    return <section ref={page} className="calendar-page" aria-label="日历">
        <div className="calendar-toolbar">
            <label className="calendar-date-picker"><span>{title}</span><Icon name="chevron"/>
                <input type="date" min="1900-01-01" max="2100-12-31" aria-label="选择日期" value={date} onChange={event => chooseDate(event.target.value)}/>
            </label>
            <div className="calendar-actions">
                <button className="icon-button" aria-label="课表设置" title="课表设置" aria-expanded={settingsOpen}
                        onClick={() => setSettingsOpen(value => !value)}><Icon name="settings"/></button>
                <button className="icon-button" aria-label="刷新日历" title="刷新日历" disabled={busy || eventsLoading}
                        onClick={() => { void loadTimetable(true, timetable?.semesterId || undefined); void loadEvents() }}><Icon name="refresh"/></button>
            </div>
        </div>
        {settingsOpen && <div className="calendar-settings">
            {!!timetable?.semesters.length && <label>学期<select aria-label="学期" value={timetable.semesterId} disabled={busy} onChange={event => void loadTimetable(true, event.target.value)}>
                {timetable.semesters.map(semester => <option key={semester.id} value={semester.id}>{semester.name}</option>)}</select></label>}
            {timetable && <label>开学日期<input type="date" aria-label="开学日期" value={timetable.startDate ?? ''} disabled={busy} onChange={event => void changeStartDate(event.target.value)}/></label>}
        </div>}
        <div className="calendar-view-bar">
            <div className="calendar-view-tabs" role="tablist" aria-label="日历视图">{calendarViews.map((item, index) =>
                <button key={item.id} id={`calendar-tab-${item.id}`} role="tab" aria-selected={view === item.id} tabIndex={view === item.id ? 0 : -1}
                        aria-controls={`calendar-panel-${view}`} onKeyDown={event => tabKey(event, index)} onClick={() => setView(item.id)}>{item.label}</button>)}</div>
            {timetable?.startDate && <select aria-label="教学周" className={`calendar-teaching-week ${view !== 'week' ? 'is-hidden' : ''}`} value={week && week >= 1 && week <= weekCount ? week : ''}
                onChange={event => chooseDate(dateAfter(timetable.startDate!, (Number(event.target.value) - 1) * 7))}>
                <option value="" disabled>非教学周</option>{Array.from({length: weekCount}, (_, index) => <option value={index + 1} key={index}>第 {index + 1} 周</option>)}
            </select>}
        </div>
        {error && <p className="account-error" role="alert">{error}</p>}
        {eventError && <p className="account-error" role="alert">{eventError}</p>}
        {(busy || eventsLoading) && <p className="calendar-loading" role="status">正在同步…</p>}
        {timetable && !timetable.startDate && <p className="account-error" role="alert">请设置开学日期以显示课程。</p>}
        <div className="calendar-view" role="tabpanel" id={`calendar-panel-${view}`} aria-labelledby={`calendar-tab-${view}`}>
            {view === 'year' && <CalendarYear date={date} today={today} items={items} onMonth={value => chooseDate(value, 'month')}/>}
            {view === 'month' && <CalendarMonth date={date} today={today} items={items} onDate={value => chooseDate(value, 'day')} onOpen={openItem}/>}
            {(view === 'week' || view === 'day') && <CalendarTimeline mode={view} date={date} today={today} items={items} onDate={value => chooseDate(value, view === 'week' ? 'day' : undefined)} onOpen={openItem}/>}
            {view === 'agenda' && <CalendarAgenda items={items} onOpen={openItem} onMore={agendaDays < 360 ? () => setAgendaDays(value => value + 30) : undefined}/>}
        </div>
        {editor && <CalendarEventDialog date={date} item={editor.item} create={editor.create} onClose={closeEditor}
            onSaved={event => {
                eventRequestId.current++
                setEventsLoading(false)
                setEventError('')
                setEvents(current => [...current.filter(item => item.id !== event.id), event])
                setDate(event.startDate)
            }}
            onRemoved={id => {
                eventRequestId.current++
                setEventsLoading(false)
                setEventError('')
                setEvents(current => current.filter(item => item.id !== id))
            }}/>}
    </section>
}

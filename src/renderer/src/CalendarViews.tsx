import {useEffect, useRef, type CSSProperties} from 'react'
import {asDate, calendarWeekdays, layoutCalendarDay, lunarDate, monthDates, timeLabel, weekStartDate, type CalendarOccurrence} from '../../shared/calendar'
import {dateAfter} from '../../shared/timetable'
import {courseColor} from './timetable-colors'

export const occurrenceColor = (item: CalendarOccurrence) => courseColor(item.course ?? {name: `日程:${item.event?.id}`, teachers: []})
const occurrenceBackground = (item: CalendarOccurrence) => item.event ? 'var(--palette-white)' : occurrenceColor(item)
export const eventTime = (item: CalendarOccurrence) => item.allDay ? '全天' : `${timeLabel(item.startMinute)}–${timeLabel(item.endMinute)}`
const dateLabel = (date: string) => `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`
const groupByDate = (items: CalendarOccurrence[]) => {
    const groups = new Map<string, CalendarOccurrence[]>()
    for (const item of items) groups.set(item.date, [...(groups.get(item.date) ?? []), item])
    return groups
}

interface ViewProps {
    date: string
    today: string
    items: CalendarOccurrence[]
    onDate: (date: string) => void
    onOpen: (item: CalendarOccurrence) => void
}

export function CalendarYear({date, today, items, onMonth}: Omit<ViewProps, 'onDate' | 'onOpen'> & {onMonth: (date: string) => void}) {
    const activeDates = new Set(items.map(item => item.date))
    return <div className="calendar-year">{Array.from({length: 12}, (_, month) => {
        const start = `${date.slice(0, 4)}-${String(month + 1).padStart(2, '0')}-01`
        return <button className={`calendar-mini-month ${start.slice(0, 7) === today.slice(0, 7) ? 'is-current-month' : ''}`}
                       key={start} aria-label={`${date.slice(0, 4)}年${month + 1}月`} onClick={() => onMonth(start)}>
            <strong>{month + 1}月</strong>
            <span className="calendar-mini-grid">{calendarWeekdays.map(day => <span className="calendar-mini-weekday" key={day}>{day}</span>)}
                {monthDates(start).map(day => <span key={day} aria-hidden={day.slice(0, 7) !== start.slice(0, 7)}
                    className={`calendar-mini-day ${day.slice(0, 7) !== start.slice(0, 7) ? 'is-hidden' : ''} ${day === today ? 'is-today' : ''} ${day === date ? 'is-selected' : ''} ${activeDates.has(day) ? 'has-events' : ''}`}>
                    {Number(day.slice(8))}
                </span>)}
            </span>
        </button>
    })}</div>
}

export function CalendarMonth({date, today, items, onDate, onOpen}: ViewProps) {
    const groups = groupByDate(items.filter(item => item.event))
    return <div className="calendar-month">
        <div className="calendar-month-weekdays">{calendarWeekdays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-month-grid">{monthDates(date).map(day => {
            const events = groups.get(day) ?? []
            return <div className={`calendar-month-cell ${day.slice(0, 7) !== date.slice(0, 7) ? 'is-outside' : ''}`} key={day}>
                <button className={`calendar-date-button ${day === today ? 'is-today' : ''} ${day === date ? 'is-selected' : ''}`}
                        aria-label={dateLabel(day)} aria-current={day === today ? 'date' : undefined} onClick={() => onDate(day)}>
                    <span>{Number(day.slice(8))}</span><small>{lunarDate(day)}</small>
                </button>
                <div className="calendar-month-events">{events.slice(0, 3).map(item => <button key={item.key}
                    className="calendar-event calendar-month-event" style={{backgroundColor: occurrenceBackground(item)}}
                    aria-label={`${eventTime(item)} ${item.title}`} onClick={() => onOpen(item)}>
                    <span>{item.title}</span>
                </button>)}
                    {events.length > 3 && <button className="calendar-more" onClick={() => onDate(day)}>+{events.length - 3} 项</button>}
                </div>
            </div>
        })}</div>
    </div>
}

export function CalendarDateStrip({date, today, onDate}: Pick<ViewProps, 'date' | 'today' | 'onDate'>) {
    const first = weekStartDate(date)
    return <div className="calendar-date-strip"><span aria-hidden="true"/>{calendarWeekdays.map((day, index) => {
        const dayDate = dateAfter(first, index)
        return <button key={day} className={`calendar-date-button ${dayDate === today ? 'is-today' : ''} ${dayDate === date ? 'is-selected' : ''}`}
                       aria-label={dateLabel(dayDate)} aria-pressed={dayDate === date} onClick={() => onDate(dayDate)}>
            <small>{day}</small><span>{Number(dayDate.slice(8))}</span><small>{lunarDate(dayDate)}</small>
        </button>
    })}</div>
}

export function CalendarTimeline({date, today, items, onDate, onOpen, mode}: ViewProps & {mode: 'week' | 'day'}) {
    const scroll = useRef<HTMLDivElement>(null)
    const start = mode === 'week' ? weekStartDate(date) : date
    const dates = Array.from({length: mode === 'week' ? 7 : 1}, (_, index) => dateAfter(start, index))
    useEffect(() => {
        if (scroll.current) scroll.current.scrollTop = 7 * 64
    }, [start, mode])
    return <div className={`calendar-timeline calendar-timeline-${mode}`}>
        <div className="calendar-time-scroll" ref={scroll} tabIndex={0} aria-label={mode === 'week' ? '每周课表' : '当天时间轴'}>
            <div className="calendar-time-content" style={{'--calendar-days': dates.length} as CSSProperties}>
                <div className="calendar-time-heading">
                    <CalendarDateStrip date={date} today={today} onDate={onDate}/>
                    <div className="calendar-time-columns calendar-all-day"><span>全天</span>
                        {dates.map(day => <div key={day}>{items.filter(item => item.date === day && item.allDay).map(item =>
                            <button key={item.key} className="calendar-event calendar-all-day-event" style={{backgroundColor: occurrenceBackground(item)}}
                                    onClick={() => onOpen(item)}><span>{item.title}</span></button>)}</div>)}
                    </div>
                </div>
                <div className="calendar-time-columns calendar-hour-grid">
                    <div className="calendar-hours">{Array.from({length: 24}, (_, hour) => <div key={hour}><span>{String(hour).padStart(2, '0')}:00</span></div>)}</div>
                    {dates.map(day => <div className="calendar-time-day-column" key={day}>
                        {Array.from({length: 24}, (_, hour) => <div className="calendar-hour-line" key={hour}/>) }
                        {layoutCalendarDay(items.filter(item => item.date === day && !item.allDay)).map(({item, lane, lanes}) =>
                            <button className="calendar-event calendar-timed-event" key={item.key} onClick={() => onOpen(item)}
                                style={{backgroundColor: occurrenceBackground(item), top: `calc(${item.startMinute / 60} * var(--calendar-hour-height) + 2px)`,
                                    height: `max(24px, calc(${(item.endMinute - item.startMinute) / 60} * var(--calendar-hour-height) - 4px))`,
                                    left: `calc(${100 * lane / lanes}% + 3px)`, width: `calc(${100 / lanes}% - 6px)`}}
                                aria-label={`${item.title}，${eventTime(item)}，${item.location}`}>
                                <strong>{item.title}</strong><span>{eventTime(item)}</span>{item.location && <span>{item.location}</span>}
                                {item.course && <small>第 {item.course.startUnit}–{item.course.endUnit} 节</small>}
                            </button>)}
                    </div>)}
                </div>
            </div>
        </div>
    </div>
}

export function CalendarAgenda({items, onOpen, onMore}: Pick<ViewProps, 'items' | 'onOpen'> & {onMore?: () => void}) {
    return <div className="calendar-agenda">
        {items.length === 0 && <p className="calendar-empty" role="status">暂无日程</p>}
        {[...groupByDate(items)].map(([date, events]) => <section className="calendar-agenda-group" key={date}>
            <div className="calendar-agenda-date">{Number(date.slice(5, 7))}月{Number(date.slice(8))}日 星期{calendarWeekdays[(asDate(date).getUTCDay() + 6) % 7]}
                <span>农历{lunarDate(date, true)}</span></div>
            <div className="calendar-agenda-card">{events.map(item => <button key={item.key} className="calendar-agenda-event" onClick={() => onOpen(item)}>
                <span className="calendar-agenda-time">{item.allDay ? '全天' : timeLabel(item.startMinute)}{!item.allDay && <small>{timeLabel(item.endMinute)}</small>}</span>
                <span className="calendar-agenda-bar" style={{backgroundColor: occurrenceColor(item)}}/>
                <span className="calendar-agenda-text"><strong>{item.title}</strong>{item.location && <span>{item.location}</span>}</span>
            </button>)}</div>
        </section>)}
        {onMore && <button className="secondary-button calendar-load-more" onClick={onMore}>显示更多</button>}
    </div>
}

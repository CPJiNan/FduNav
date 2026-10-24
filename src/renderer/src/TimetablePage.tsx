import {useEffect, useRef, useState} from 'react'
import {courseStartTimes, currentWeek, dateAfter, type Timetable, type TimetableCourse} from '../../shared/timetable'
import {Icon} from './Icon'
import {courseColor} from './timetable-colors'
import './styles/timetable.css'

const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const maxWeek = (data: Timetable) => Math.max(18, ...data.courses.flatMap(course => course.weeks))
const clampWeek = (data: Timetable) => Math.max(1, Math.min(maxWeek(data), currentWeek(data.startDate)))

function layoutDay(courses: TimetableCourse[]) {
    const groups: TimetableCourse[][] = []
    for (const course of [...courses].sort((a, b) => a.startUnit - b.startUnit || a.endUnit - b.endUnit)) {
        const group = groups.at(-1)
        if (group && course.startUnit <= Math.max(...group.map(item => item.endUnit))) group.push(course)
        else groups.push([course])
    }
    return groups.flatMap(group => {
        const ends: number[] = []
        const entries = group.map(course => {
            let lane = ends.findIndex(end => end < course.startUnit)
            if (lane < 0) lane = ends.length
            ends[lane] = course.endUnit
            return {course, lane}
        })
        return entries.map(entry => ({...entry, lanes: ends.length}))
    })
}

export function TimetablePage() {
    const [data, setData] = useState<Timetable | null>(null)
    const [week, setWeek] = useState(1)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [selected, setSelected] = useState<TimetableCourse | null>(null)
    const requestId = useRef(0)
    const pending = useRef(false)
    const dialog = useRef<HTMLDialogElement>(null)

    async function load(refresh = false, semesterId?: string) {
        if (pending.current) return
        const api = window.timetable
        if (!api) { setError('请在桌面应用中获取课表。'); return }
        pending.current = true
        const id = ++requestId.current
        setBusy(true)
        setError('')
        try {
            const result = await api.get({refresh, semesterId})
            if (id !== requestId.current) return
            if (!result.ok) setError(result.error)
            else {
                setData(result.data)
                setWeek(value => !data || data.semesterId !== result.data.semesterId
                    ? clampWeek(result.data) : Math.min(value, maxWeek(result.data)))
            }
        } catch { if (id === requestId.current) setError('无法连接课表服务，请重试。') }
        finally {
            if (id === requestId.current) { pending.current = false; setBusy(false) }
        }
    }

    useEffect(() => {
        const timer = window.setTimeout(() => { void load() }, 0)
        return () => { window.clearTimeout(timer); requestId.current++; pending.current = false }
    }, [])

    useEffect(() => {
        if (selected) dialog.current?.showModal()
    }, [selected])

    async function changeStartDate(date: string) {
        if (!window.timetable || pending.current || !date) return
        pending.current = true
        const id = ++requestId.current
        setBusy(true)
        setError('')
        try {
            const result = await window.timetable.setStartDate(date)
            if (id !== requestId.current) return
            if (!result.ok) setError(result.error)
            else { setData(result.data); setWeek(clampWeek(result.data)) }
        } catch { if (id === requestId.current) setError('无法保存开学日期，请重试。') }
        finally { if (id === requestId.current) { pending.current = false; setBusy(false) } }
    }

    const courses = data?.courses.filter(course => course.weeks.includes(week)) ?? []
    const weekStart = data?.startDate ? dateAfter(data.startDate, (week - 1) * 7) : null
    const weekCount = data ? maxWeek(data) : 18
    const today = new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date())

    return <section className="timetable-page" aria-label="课表" aria-busy={busy}>
        <div className="timetable-toolbar">
            {data?.semesters.length ? <label className="timetable-field"><span>学期</span>
                <select aria-label="学期" value={data.semesterId} disabled={busy}
                        onChange={event => void load(true, event.target.value)}>
                    {data.semesters.map(semester => <option key={semester.id} value={semester.id}>{semester.name}</option>)}
                </select>
            </label> : null}
            {data && <label className="timetable-field"><span>开学日期</span>
                <input type="date" aria-label="开学日期" value={data.startDate ?? ''} disabled={busy}
                       onChange={event => void changeStartDate(event.target.value)}/>
            </label>}
            <button className="secondary-button timetable-refresh" disabled={busy || !window.timetable}
                    onClick={() => void load(true, data?.semesterId || undefined)}>
                <Icon name="refresh"/>{busy ? '正在获取…' : '刷新课表'}
            </button>
        </div>
        <div className="timetable-week-controls">
            <button className="icon-button timetable-previous" aria-label="上一周" title="上一周"
                    disabled={week <= 1 || !data} onClick={() => setWeek(value => value - 1)}><Icon name="chevron"/></button>
            <select aria-label="周次" value={week} disabled={!data} onChange={event => setWeek(Number(event.target.value))}>
                {Array.from({length: weekCount}, (_, index) => <option key={index} value={index + 1}>第 {index + 1} 周</option>)}
            </select>
            <button className="icon-button" aria-label="下一周" title="下一周"
                    disabled={week >= weekCount || !data} onClick={() => setWeek(value => value + 1)}><Icon name="chevron"/></button>
            <button className="secondary-button" disabled={!data?.startDate} onClick={() => data && setWeek(clampWeek(data))}>本周</button>
            {weekStart && <span className="timetable-range">{weekStart.slice(5).replace('-', '/')} — {dateAfter(weekStart, 6).slice(5).replace('-', '/')}</span>}
        </div>
        {error && <p className="account-error" role="alert">{error}</p>}
        {!data && busy && <p className="timetable-status" role="status">正在获取课表…</p>}
        {data && courses.length === 0 && <p className="timetable-status" role="status">本周暂无课程</p>}
        <div className="timetable-scroll" tabIndex={0} aria-label="每周课表">
            <div className="timetable-grid">
                <div className="timetable-week-header">
                    <div className="timetable-corner">节次</div>
                    {days.map((day, index) => {
                        const date = weekStart ? dateAfter(weekStart, index) : null
                        return <div key={day} className={date === today ? 'is-today' : ''} aria-current={date === today ? 'date' : undefined}>
                            <span>{day}</span>{date && <small>{date.slice(5).replace('-', '/')}</small>}
                        </div>
                    })}
                </div>
                <div className="timetable-columns">
                    <div className="timetable-times">{courseStartTimes.map((time, index) => <div key={time}>
                        <span>{index + 1}</span><small>{time}</small>
                    </div>)}</div>
                    {days.map((day, index) => <div className="timetable-day" key={day} aria-label={day}>
                        {courseStartTimes.map(time => <div key={time} className="timetable-slot" aria-hidden="true"/>)}
                        {layoutDay(courses.filter(course => course.weekday === index + 1)).map(({course, lane, lanes}) =>
                            <button key={course.id} className="timetable-course" onClick={() => setSelected(course)}
                                    style={{backgroundColor: courseColor(course), top: `calc(${course.startUnit - 1} * var(--timetable-unit-height) + 3px)`,
                                        height: `calc(${course.endUnit - course.startUnit + 1} * var(--timetable-unit-height) - 6px)`,
                                        left: `calc(${lane / lanes * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)`}}
                                    aria-label={`${course.name}，${day}第 ${course.startUnit} 至 ${course.endUnit} 节，${course.room || '未安排教室'}，${course.teachers.join('、')}`}>
                                <strong>{course.name}</strong>{course.room && <span>{course.room}</span>}
                                {course.endUnit > course.startUnit && course.teachers.length > 0 && <small>{course.teachers.join('、')}</small>}
                            </button>)}
                    </div>)}
                </div>
            </div>
        </div>
        <div className="timetable-agenda" aria-label="课程列表">
            {days.map((day, index) => {
                const dayCourses = courses.filter(course => course.weekday === index + 1).sort((a, b) => a.startUnit - b.startUnit)
                if (!dayCourses.length) return null
                return <div className="timetable-agenda-day" key={day}>
                    <div className="timetable-agenda-date">{day}{weekStart && <span>{dateAfter(weekStart, index).slice(5).replace('-', '/')}</span>}</div>
                    {dayCourses.map(course => <button key={course.id} className="timetable-agenda-course"
                                                     style={{backgroundColor: courseColor(course)}} onClick={() => setSelected(course)}>
                        <span className="timetable-agenda-time">{courseStartTimes[course.startUnit - 1]}<small>{course.startUnit}–{course.endUnit} 节</small></span>
                        <span><strong>{course.name}</strong>{course.room && <span>{course.room}</span>}{course.teachers.length > 0 && <small>{course.teachers.join('、')}</small>}</span>
                        <Icon name="chevron"/>
                    </button>)}
                </div>
            })}
        </div>
        <dialog ref={dialog} className="timetable-dialog" aria-label="课程详情" onClose={() => setSelected(null)}
                onClick={event => { if (event.target === dialog.current) dialog.current.close() }}>
            {selected && <div>
                <div className="timetable-dialog-header"><strong>{selected.name}</strong>
                    <button className="icon-button" aria-label="关闭课程详情" onClick={() => dialog.current?.close()}><Icon name="close"/></button></div>
                <dl>
                    <dt>时间</dt><dd>{days[selected.weekday - 1]} · 第 {selected.startUnit}–{selected.endUnit} 节</dd>
                    <dt>教室</dt><dd>{selected.room || '未安排'}</dd>
                    <dt>教师</dt><dd>{selected.teachers.join('、') || '未提供'}</dd>
                    <dt>周次</dt><dd>{selected.weeks.filter(value => value > 0).join('、')} 周</dd>
                </dl>
            </div>}
        </dialog>
    </section>
}

import {createHash} from 'node:crypto'
import {load} from 'cheerio'
import type {CalendarEvent} from '../shared/calendar.ts'
import {validDate} from '../shared/timetable.ts'

export interface ParsedExam {
    course: string
    date: string
    startTime: string
    endTime: string
    location: string
    seat: string
}

const datePattern = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/

function parseDate(text: string): string | null {
    const match = datePattern.exec(text)
    if (!match) return null
    const value = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    return validDate(value) ? value : null
}

function parseTimes(text: string): [string, string] | null {
    const matches = [...text.matchAll(/(\d{1,2}):(\d{2})/g)]
    if (matches.length < 2) return null
    const normalize = (hour: string, minute: string) => {
        const value = Number(hour)
        return value >= 0 && value <= 23 && Number(minute) <= 59
            ? `${String(value).padStart(2, '0')}:${minute}`
            : null
    }
    const start = normalize(matches[0][1], matches[0][2])
    const end = normalize(matches[1][1], matches[1][2])
    if (!start || !end || end <= start) return null
    return [start, end]
}

export function parseExamPage(html: string): ParsedExam[] {
    const $ = load(html)
    const exams = new Map<string, ParsedExam>()
    $('tr').each((_index, row) => {
        if ($(row).find('th').length) return
        const cells = $(row).find('td').toArray()
            .map(cell => $(cell).text().replace(/\s+/g, ' ').trim())
            .filter(Boolean)
        if (cells.length < 2) return
        const text = cells.join(' ')
        const date = parseDate(text)
        const times = parseTimes(text)
        if (!date || !times) return
        const descriptive = cells.filter(cell => !/^\d+$/.test(cell) && !datePattern.test(cell) && !/\d{1,2}:\d{2}/.test(cell) &&
            !/(考场|地点|教室|座位|考试形式|考试方式|校区|楼|室)/.test(cell))
        const course = descriptive[0] ?? cells[0] ?? '考试'
        const location = cells.find(cell => /(考场|地点|教室|校区|楼|室)/.test(cell) && !datePattern.test(cell)) ?? ''
        const seat = cells.find(cell => /座位/.test(cell)) ?? ''
        const exam: ParsedExam = {
            course,
            date,
            startTime: times[0],
            endTime: times[1],
            location,
            seat
        }
        exams.set(`${course}\n${date}\n${times[0]}`, exam)
    })
    return [...exams.values()]
}

function examId(exam: ParsedExam): string {
    const hex = createHash('sha1').update(`${exam.course}\n${exam.date}\n${exam.startTime}`).digest('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function examEvent(exam: ParsedExam): CalendarEvent {
    return {
        id: examId(exam),
        title: `${exam.course}考试`,
        startDate: exam.date,
        endDate: exam.date,
        startTime: exam.startTime,
        endTime: exam.endTime,
        allDay: false,
        reminderMinutes: 30,
        location: exam.location,
        notes: [exam.seat, '考试日程自动导入'].filter(Boolean).join('\n')
    }
}

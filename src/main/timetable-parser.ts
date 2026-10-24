import {load} from 'cheerio'
import {AuthError} from './fudan-auth.ts'
import {dateAfter, validDate, type Semester, type TimetableCourse} from '../shared/timetable.ts'

const invalid = () => new AuthError('无法解析学校课表数据，学校页面可能已更新。')

export function parseSemesters(html: string): {semesters: Semester[]; defaultId: string} {
    const $ = load(html)
    const expression = html.match(/\b(?:var|let|const)\s+semesters\s*=\s*JSON\.parse\(\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))\s*\)/)?.[1]
    if (!expression) throw invalid()
    let rows: unknown
    try {
        // Decode the JS string literal without executing school-provided JavaScript.
        const text = expression[0] === '"' ? JSON.parse(expression)
            : expression.slice(1, -1).replace(/\\([\\'"/])/g, '$1').replace(/\\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
        rows = JSON.parse(text)
    } catch { throw invalid() }
    if (!Array.isArray(rows) || !rows.length) throw invalid()
    const semesters: Semester[] = rows.map(row => {
        if (!row || !/^\d+$/.test(String(row.id)) || typeof row.name !== 'string') throw invalid()
        const date = typeof row.startDate === 'string' ? row.startDate.slice(0, 10) : ''
        // JWGL uses Sunday as the start of a teaching week; the UI starts on Monday.
        const startDate = validDate(date) ? dateAfter(date, new Date(`${date}T00:00:00Z`).getUTCDay() === 0 ? 1 : 0) : null
        return {id: String(row.id), name: row.name, startDate}
    }).reverse()
    const defaultId = $('#allSemesters option[selected]').first().attr('value') ?? $('#allSemesters option').first().attr('value')
    if (!defaultId || !semesters.some(semester => semester.id === defaultId)) throw invalid()
    return {semesters, defaultId}
}

function json(text: string): any {
    try { return JSON.parse(text) } catch { throw invalid() }
}

function integer(value: unknown, min: number, max: number): number {
    const number = Number(value)
    if (!Number.isInteger(number) || number < min || number > max) throw invalid()
    return number
}

function text(value: unknown, optional = false): string {
    if (optional && value == null) return ''
    if (typeof value !== 'string') throw invalid()
    return value.trim()
}

export function parseUndergraduateCourses(body: string): TimetableCourse[] {
    const response = json(body)
    if (!Array.isArray(response?.studentTableVms) || !response.studentTableVms.length) throw invalid()
    const activities = response.studentTableVms[0]?.activities
    if (!Array.isArray(activities)) throw invalid()
    return activities.map((activity, index) => {
        if (!activity || !Array.isArray(activity.weekIndexes) || !Array.isArray(activity.teachers)) throw invalid()
        const weekday = integer(activity.weekday, 1, 7)
        const startUnit = integer(activity.startUnit, 1, 15)
        const endUnit = integer(activity.endUnit, startUnit, 15)
        return {
            id: `${activity.lessonId ?? ''}-${activity.lessonCode ?? ''}-${index}`,
            name: text(activity.courseName), teachers: activity.teachers.map((value: unknown) => text(value)),
            room: text(activity.room, true), weekday, startUnit, endUnit,
            weeks: [...new Set<number>(activity.weekIndexes.map((week: unknown) => integer(week, 1, 60) - (weekday === 7 ? 1 : 0)))].sort((a, b) => a - b),
        }
    })
}

export function parsePostgraduateCourses(body: string): TimetableCourse[] {
    const response = json(body)
    if (!Array.isArray(response?.results)) throw invalid()
    const courses: TimetableCourse[] = response.results.map((row: any, index: number) => {
        if (!row || typeof row.ZCBH !== 'string' || !/^[01]{1,60}$/.test(row.ZCBH)) throw invalid()
        const startUnit = integer(row.KSJCDM, 1, 15)
        return {
            id: `pg-${index}`, name: text(row.KCMC), room: text(row.JASMC, true),
            teachers: row.JSXM ? [text(row.JSXM)] : [], weekday: integer(row.XQ, 1, 7),
            startUnit, endUnit: row.JSJCDM == null ? startUnit : integer(row.JSJCDM, startUnit, 15),
            weeks: [...row.ZCBH].flatMap((bit, week) => bit === '1' ? [week + 1] : []),
        }
    })
    // Some responses represent each teaching unit as its own row.
    const merged: TimetableCourse[] = []
    for (const course of courses.sort((a, b) => a.weekday - b.weekday || a.startUnit - b.startUnit)) {
        const previous = merged.find(item => item.name === course.name && item.room === course.room && item.weekday === course.weekday &&
            item.endUnit + 1 === course.startUnit && JSON.stringify(item.weeks) === JSON.stringify(course.weeks) &&
            JSON.stringify(item.teachers) === JSON.stringify(course.teachers))
        if (previous) previous.endUnit = course.endUnit
        else merged.push(course)
    }
    return merged
}

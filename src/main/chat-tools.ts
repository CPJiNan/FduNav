import {defaultToolDescriptions, type ChatToolName} from '../shared/llm-prompts'
import {calendarDate, calendarOccurrences, timeLabel, validateCalendarEvent, type CalendarEvent} from '../shared/calendar'
import {validateTodo} from '../shared/todos'
import type {ChatAction, ChatCard} from '../shared/chat'
import type {Notice} from '../shared/notices'
import type {AppDatabase} from './database'
import type {registerNoticeHandlers} from './notices'
import type {ChatTool} from './llm-connection'

type Fields = Record<string, unknown>
const str = (description: string) => ({type: 'string', description})
const ref = {sourceId: str('通知来源 ID，来自检索结果'), url: str('通知 URL，来自检索结果')}
const eventFields = {
    title: str('日程名称'), startDate: str('开始日期 YYYY-MM-DD'), endDate: str('结束日期 YYYY-MM-DD'),
    startTime: str('开始时间 HH:mm'), endTime: str('结束时间 HH:mm'), allDay: {type: 'boolean'},
    location: str('地点'), notes: str('备注'),
    reminderMinutes: {type: 'integer', enum: [-1, 0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080], description: '提前提醒分钟数，-1 不提醒；省略使用用户默认值'},
}
const pagination = {offset: {type: 'integer', minimum: 0}, limit: {type: 'integer', minimum: 1, maximum: 10}}
function tool(name: ChatToolName, properties: Fields, required: string[] = []): ChatTool {
    return {type: 'function', function: {name, description: defaultToolDescriptions[name], parameters: {type: 'object', properties, required, additionalProperties: false}}}
}
export const chatTools: ChatTool[] = [
    tool('search_notices', {
        query: str('标题或来源关键词，空字符串查询最新通知'), sourceId: str('可选来源 ID'),
        from: str('最早发布日期 YYYY-MM-DD'), to: str('最晚发布日期 YYYY-MM-DD'),
        relevance: {type: 'string', enum: ['related', 'maybe', 'none']}, ...pagination,
    }),
    tool('get_notice', ref, ['sourceId', 'url']),
    tool('generate_notice_summary', ref, ['sourceId', 'url']),
    tool('list_events', {
        from: str('开始日期 YYYY-MM-DD'), to: str('结束日期 YYYY-MM-DD'), query: str('名称、地点、备注或授课教师关键词'), ...pagination,
    }),
    tool('get_event', {id: str('个人日程 ID')}, ['id']),
    tool('create_event', eventFields,
        ['title', 'startDate', 'endDate', 'allDay']),
    tool('list_todos', {
        query: str('标题或备注关键词'), completed: {type: 'boolean', description: '可选，是否已完成'}, ...pagination,
    }),
    tool('create_todo', {
        title: str('待办名称'), notes: str('备注'), dueDate: str('截止日期 YYYY-MM-DD，未指定可省略'),
        dueTime: str('截止时间 HH:mm，有截止日期时必填'), reminderMinutes: eventFields.reminderMinutes,
    }, ['title']),
]

export function configuredChatTools(descriptions: Record<ChatToolName, string>): ChatTool[] {
    return chatTools.map(item => ({...item, function: {...item.function,
        description: descriptions[item.function.name as ChatToolName],
    }}))
}

export const chatToolLabels: Record<string, string> = {
    search_notices: '正在检索通知', get_notice: '正在读取通知',
    generate_notice_summary: '正在申请通知摘要',
    list_events: '正在获取日程', get_event: '正在读取日程', create_event: '正在申请新增日程',
    list_todos: '正在查询待办', create_todo: '正在申请新增待办',
}

function textArg(args: Fields, key: string, required = false, max = 500): string {
    const value = args[key]
    if (value === undefined && !required) return ''
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${key} 参数无效。`)
    return value.trim()
}
function range(args: Fields) {
    const from = textArg(args, 'from'), to = textArg(args, 'to')
    if ((from && !calendarDate(from)) || (to && !calendarDate(to)) || (from && to && from > to)) throw new Error('日期范围无效。')
    return {from, to}
}
function page<T>(items: T[], args: Fields) {
    const offset = args.offset ?? 0, limit = args.limit ?? 5
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 ||
        typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('分页参数无效。')
    return {total: items.length, items: items.slice(offset, offset + limit), hasMore: offset + limit < items.length}
}

export function createChatToolRunner(db: AppDatabase, username: string,
    notices: ReturnType<typeof registerNoticeHandlers>,
    addCard: (card: ChatCard) => void, assertCurrent: () => void,
    requestSummary: (notice: Notice) => unknown, requestAction: (action: ChatAction) => unknown) {
    const seenNotices = new Set<string>()
    const noticeKey = (item: {sourceId: string; url: string}) => JSON.stringify([item.sourceId, item.url])
    function noticeCard(notice: Notice) {
        seenNotices.add(noticeKey(notice)); addCard({kind: 'notice', notice})
    }
    function eventCard(event: CalendarEvent, deleted = false) {
        addCard({kind: 'event', event, deleted})
    }
    function knownNotice(args: Fields) {
        const sourceId = textArg(args, 'sourceId', true), url = textArg(args, 'url', true, 2048)
        const notice = notices.list().items.find(item => item.sourceId === sourceId && item.url === url)
        if (!notice || !seenNotices.has(noticeKey(notice))) throw new Error('请先检索这条通知，再进行读取或摘要。')
        return notice
    }
    function getEvent(args: Fields) {
        const id = textArg(args, 'id', true)
        if (id.startsWith('course:')) throw new Error('课表课程只读，请使用日程查询获取课程安排，不能修改或删除。')
        const event = db.getCalendarEvents(username).find(item => item.id === id)
        if (!event) {
            if (db.getTodo(username, id)) throw new Error('该 ID 属于待办，不能使用日程工具操作。请使用待办查询工具。')
            throw new Error('日程不存在或已被删除。')
        }
        return event
    }
    return async (name: string, raw: string): Promise<unknown> => {
        assertCurrent()
        const schema = chatTools.find(item => item.function.name === name)?.function.parameters
        if (!schema) throw new Error('不支持的工具。')
        const args: unknown = JSON.parse(raw)
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象。')
        const input = args as Fields
        const properties = schema.properties as Fields
        if (Object.keys(input).some(key => !Object.hasOwn(properties, key)) || (schema.required as string[]).some(key => !Object.hasOwn(input, key))) throw new Error('工具参数缺失或包含未知字段。')
        if (name === 'search_notices') {
            const words = textArg(input, 'query').toLocaleLowerCase().split(/\s+/).filter(Boolean)
            const sourceId = textArg(input, 'sourceId'), {from, to} = range(input)
            if (input.relevance !== undefined && !['related', 'maybe', 'none'].includes(String(input.relevance))) throw new Error('相关性参数无效。')
            const items = notices.list().items.filter(item => (!sourceId || item.sourceId === sourceId) &&
                (!from || item.published >= from) && (!to || item.published <= to) &&
                (input.relevance === undefined || (item.relevance || 'none') === input.relevance) &&
                words.every(word => `${item.title} ${item.sourceName}`.toLocaleLowerCase().includes(word)))
                .sort((a, b) => b.published.localeCompare(a.published))
            const result = page(items, input)
            result.items.forEach(noticeCard)
            return result
        }
        if (name === 'get_notice') {
            const notice = knownNotice(input)
            const detail = await notices.detail(notice)
            assertCurrent()
            if (detail.requiresLogin) throw new Error('通知需要登录，请在通知详情中登录后再试。')
            noticeCard(notice)
            return {notice, content: detail.content.slice(0, 12000), truncated: detail.content.length > 12000}
        }
        if (name === 'generate_notice_summary') {
            const notice = knownNotice(input)
            assertCurrent()
            return requestSummary(notice)
        }
        if (name === 'list_events') {
            const {from, to} = range(input), query = textArg(input, 'query').toLocaleLowerCase()
            const preferences = db.getMessagePreferences()
            const supported = preferences.identity === 'student' && ['undergraduate', 'master', 'doctoral'].includes(preferences.educationLevel)
            const timetable = supported ? db.getTimetable(username, preferences.educationLevel === 'undergraduate' ? 'undergraduate' : 'postgraduate') : null
            const timetableWarning = preferences.identity !== 'student' ? '当前身份不支持课表查询。'
                : !supported ? '请先设置学历阶段，才能查询课表。'
                : !timetable ? '尚未获取课表，当前仅返回个人日程，请刷新课表后重试。'
                : !timetable.startDate ? '课表缺少开学日期，请在日历设置第一周起始日期后查询具体上课日期。' : ''
            const events = db.getCalendarEvents(username).filter(item => (!from || item.endDate >= from) && (!to || item.startDate <= to) &&
                `${item.title} ${item.location} ${item.notes}`.toLocaleLowerCase().includes(query))
                .map(event => ({...event, kind: 'event' as const, readOnly: false, event}))
            const courses = calendarOccurrences(timetable, [], from || '1900-01-01', to || '2100-12-31')
                .filter(item => `${item.title} ${item.location} ${item.course!.teachers.join(' ')}`.toLocaleLowerCase().includes(query))
                .map(occurrence => ({kind: 'course' as const, readOnly: true, id: occurrence.key, title: occurrence.title,
                    startDate: occurrence.date, endDate: occurrence.date, startTime: timeLabel(occurrence.startMinute),
                    endTime: timeLabel(occurrence.endMinute), allDay: false, location: occurrence.location,
                    teachers: occurrence.course!.teachers, startUnit: occurrence.course!.startUnit,
                    endUnit: occurrence.course!.endUnit, occurrence}))
            const items = [...events, ...courses]
                .sort((a, b) => a.startDate.localeCompare(b.startDate) || Number(b.allDay) - Number(a.allDay) ||
                    a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id))
            const result = page(items, input)
            result.items.forEach(item => {
                if (item.kind === 'course') addCard({kind: 'course', occurrence: item.occurrence})
                else eventCard(item.event)
            })
            return {...result, items: result.items.map(item => {
                if (item.kind === 'course') { const {occurrence: _occurrence, ...fields} = item; return fields }
                const {event: _event, ...fields} = item; return fields
            }), timetableUpdatedAt: timetable?.updatedAt ?? null, timetableWarning}
        }
        if (name === 'get_event') {
            const event = getEvent(input); eventCard(event); return event
        }
        if (name === 'create_event') {
            if (input.allDay === false && (input.startTime === undefined || input.endTime === undefined)) {
                throw new Error('请先明确日程的起止时间。')
            }
            const checked = validateCalendarEvent({
                startTime: '00:00', endTime: '00:00', location: '', notes: '',
                reminderMinutes: db.getCalendarDefaultReminder(), ...input,
            })
            if (!checked.ok) throw new Error(checked.error)
            return requestAction({kind: 'create_event', after: checked.data})
        }
        if (name === 'list_todos') {
            const query = textArg(input, 'query').toLocaleLowerCase()
            if (input.completed !== undefined && typeof input.completed !== 'boolean') throw new Error('待办状态无效。')
            const result = page(db.getTodos(username).filter(todo =>
                (input.completed === undefined || todo.completed === input.completed) &&
                `${todo.title} ${todo.notes}`.toLocaleLowerCase().includes(query)), input)
            return {...result, items: result.items.map(todo => ({...todo, kind: 'todo'}))}
        }
        if (name === 'create_todo') {
            if (input.dueDate && input.dueTime === undefined) throw new Error('请先明确待办截止时间（时、分）。')
            if (!input.dueDate && input.dueTime) throw new Error('请先明确待办截止日期。')
            const checked = validateTodo({notes: '', dueDate: '', dueTime: '00:00',
                reminderMinutes: db.getTodoDefaultReminder(), ...input, completed: false})
            if (!checked.ok) throw new Error(checked.error)
            return requestAction({kind: 'create_todo', todo: checked.data})
        }
        throw new Error('不支持的工具。')
    }
}

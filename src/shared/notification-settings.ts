import type {Result} from './accounts'
import type {NoticeRelevance} from './notices'
import type {CalendarReminderMinutes} from './calendar-reminders'

export const noticeReminderOptions = [
    {value: 'related', label: '与我有关提醒'},
    {value: 'maybe', label: '可能有关提醒'},
    {value: 'all', label: '全部通知提醒'},
    {value: 'off', label: '关闭提醒'},
] as const

export type NoticeReminderMode = typeof noticeReminderOptions[number]['value']

export function isNoticeReminderMode(value: unknown): value is NoticeReminderMode {
    return noticeReminderOptions.some(option => option.value === value)
}

export function shouldRemindNotice(mode: NoticeReminderMode, relevance: NoticeRelevance | null): boolean {
    return mode === 'all' || (mode === 'related' && relevance === 'related') ||
        (mode === 'maybe' && (relevance === 'related' || relevance === 'maybe'))
}

export const noticeRefreshOptions = [
    {value: 0, label: '从不'},
    {value: 15, label: '每 15 分钟'},
    {value: 30, label: '每 30 分钟'},
    {value: 60, label: '每 1 小时'},
] as const

export type NoticeRefreshInterval = typeof noticeRefreshOptions[number]['value']

export function isNoticeRefreshInterval(value: unknown): value is NoticeRefreshInterval {
    return noticeRefreshOptions.some(option => option.value === value)
}

export interface NotificationSettings {
    calendarDefaultReminder: CalendarReminderMinutes
    todoDefaultReminder: CalendarReminderMinutes
    reminderMode: NoticeReminderMode
    refreshInterval: NoticeRefreshInterval
    autoSummary: boolean
}

export interface NotificationSettingsAPI {
    get(): Promise<Result<NotificationSettings>>
    setReminderMode(mode: NoticeReminderMode): Promise<Result<NotificationSettings>>
    setRefreshInterval(interval: NoticeRefreshInterval): Promise<Result<NotificationSettings>>
    setAutoSummary(enabled: boolean): Promise<Result<NotificationSettings>>
    setCalendarDefaultReminder(minutes: CalendarReminderMinutes): Promise<Result<NotificationSettings>>
    setTodoDefaultReminder(minutes: CalendarReminderMinutes): Promise<Result<NotificationSettings>>
}

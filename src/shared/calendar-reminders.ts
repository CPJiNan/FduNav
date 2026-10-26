export const calendarReminderOptions = [
    {value: -1, label: '无'},
    {value: 0, label: '准时'},
    {value: 5, label: '5 分钟前'},
    {value: 10, label: '10 分钟前'},
    {value: 15, label: '15 分钟前'},
    {value: 30, label: '30 分钟前'},
    {value: 60, label: '1 小时前'},
    {value: 120, label: '2 小时前'},
    {value: 1440, label: '1 天前'},
    {value: 2880, label: '2 天前'},
    {value: 10080, label: '1 周前'},
] as const

export type CalendarReminderMinutes = typeof calendarReminderOptions[number]['value']

export function isCalendarReminderMinutes(value: unknown): value is CalendarReminderMinutes {
    return calendarReminderOptions.some(option => option.value === value)
}

export function calendarReminderSchedule(event: {
    startDate: string; startTime: string; allDay: boolean; reminderMinutes: CalendarReminderMinutes
}): {startAt: number; remindAt: number} | null {
    if (!isCalendarReminderMinutes(event.reminderMinutes) || event.reminderMinutes === -1) return null
    const startAt = new Date(`${event.startDate}T${event.allDay ? '00:00' : event.startTime}:00`).getTime()
    return Number.isFinite(startAt) ? {startAt, remindAt: startAt - event.reminderMinutes * 60_000} : null
}

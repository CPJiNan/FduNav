import {app, Notification, powerMonitor} from 'electron'
import type {AppDatabase} from './database'
import type {CalendarEvent} from '../shared/calendar'
import {calendarReminderSchedule} from '../shared/calendar-reminders'

export class CalendarReminderService {
    private timer: ReturnType<typeof setTimeout> | undefined
    private stopped = false
    private active = new Map<Notification, { username: string; id: string }>()

    constructor(private db: AppDatabase, private onClick: () => void) {
        powerMonitor.on('resume', this.check)
        app.once('before-quit', () => {
            this.stopped = true
            clearTimeout(this.timer)
            powerMonitor.removeListener('resume', this.check)
            for (const notification of this.active.keys()) notification.close()
            this.active.clear()
        })
        this.check()
    }

    changed(username: string, id: string) {
        for (const [notification, owner] of this.active) {
            if (owner.username === username && owner.id === id) {
                notification.close()
                this.active.delete(notification)
            }
        }
        this.check()
    }

    private check = () => {
        if (this.stopped) return
        clearTimeout(this.timer)
        let delay = 30_000
        try {
            const username = this.db.getAccount()?.username
            if (username && Notification.isSupported()) {
                const now = Date.now()
                for (const event of this.db.getCalendarEvents(username)) {
                    const schedule = calendarReminderSchedule(event)
                    if (!schedule || schedule.startAt + 60_000 < now ||
                        this.db.calendarReminderDelivered(username, event.id, schedule.remindAt)) continue
                    if (schedule.remindAt > now) delay = Math.min(delay, schedule.remindAt - now)
                    else this.show(username, event, schedule.remindAt)
                }
            }
        } catch (error) {
            console.warn('无法检查日历提醒。', error)
        } finally {
            if (!this.stopped) {
                this.timer = setTimeout(this.check, Math.max(1, delay))
                this.timer.unref()
            }
        }
    }

    private show(username: string, event: CalendarEvent, remindAt: number) {
        const notification = new Notification({
            title: `FduNav · ${event.title}`,
            body: `${event.startDate} ${event.allDay ? '全天' : event.startTime}${event.location ? ` · ${event.location}` : ''}`,
        })
        this.db.markCalendarReminderDelivered(username, event.id, remindAt)
        this.active.set(notification, {username, id: event.id})
        notification.once('click', () => {
            this.active.delete(notification)
            if (!this.stopped && this.db.getAccount()?.username === username && this.db.hasCalendarEvent(username, event.id)) this.onClick()
        })
        notification.once('close', () => this.active.delete(notification))
        notification.once('failed', (_event, error) => {
            this.active.delete(notification)
            if (!this.stopped) this.db.clearCalendarReminderDelivery(username, event.id, remindAt)
            console.warn('日历提醒未能显示。', error)
        })
        try {
            notification.show()
        } catch (error) {
            this.active.delete(notification)
            this.db.clearCalendarReminderDelivery(username, event.id, remindAt)
            throw error
        }
    }
}

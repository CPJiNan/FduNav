import {app, Notification, powerMonitor} from 'electron'
import type {AppDatabase} from './database'
import type {Todo} from '../shared/todos'
import {todoReminderSchedule} from '../shared/todos'

export class TodoReminderService {
    private timer: ReturnType<typeof setTimeout> | undefined
    private stopped = false
    private active = new Map<Notification, {username: string; id: string}>()

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
                for (const todo of this.db.getTodos(username)) {
                    const schedule = todoReminderSchedule(todo)
                    if (!schedule || schedule.startAt + 60_000 < now ||
                        this.db.todoReminderDelivered(username, todo.id, schedule.remindAt)) continue
                    if (schedule.remindAt > now) delay = Math.min(delay, schedule.remindAt - now)
                    else this.show(username, todo, schedule.remindAt)
                }
            }
        } catch (error) {
            console.warn('无法检查待办提醒。', error)
        } finally {
            if (!this.stopped) {
                this.timer = setTimeout(this.check, Math.max(1, delay))
                this.timer.unref()
            }
        }
    }

    private show(username: string, todo: Todo, remindAt: number) {
        const notification = new Notification({
            title: `FduNav 待办 · ${todo.title}`,
            body: `截止时间：${todo.dueDate} ${todo.dueTime}`,
        })
        this.db.markTodoReminderDelivered(username, todo.id, remindAt)
        this.active.set(notification, {username, id: todo.id})
        notification.once('click', () => {
            this.active.delete(notification)
            if (this.stopped || this.db.getAccount()?.username !== username) return
            const current = this.db.getTodo(username, todo.id)
            if (current && !current.completed) this.onClick()
        })
        notification.once('close', () => this.active.delete(notification))
        notification.once('failed', (_event, error) => {
            this.active.delete(notification)
            if (!this.stopped) this.db.clearTodoReminderDelivery(username, todo.id, remindAt)
            console.warn('待办提醒未能显示。', error)
        })
        try {
            notification.show()
        } catch (error) {
            this.active.delete(notification)
            this.db.clearTodoReminderDelivery(username, todo.id, remindAt)
            throw error
        }
    }
}

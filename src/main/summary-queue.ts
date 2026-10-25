import {randomUUID} from 'node:crypto'
import {type Notice, type NoticeSummary, type SummaryTask, summaryTaskFinished} from '../shared/notices.ts'

type Work = (signal: AbortSignal, stage: (status: 'reading' | 'generating' | 'saving') => void) => Promise<NoticeSummary>

interface Entry {
    task: SummaryTask
    owner: string
    controller: AbortController
    work: Work
    resolve: (result: NoticeSummary) => void
    reject: (error: Error) => void
}

export class SummaryQueue {
    private entries: Entry[] = []
    private running = false
    private listeners = new Set<() => void>()

    get activeCount(): number {
        return this.entries.filter(entry => !summaryTaskFinished(entry.task)).length
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    snapshot(owner: string): SummaryTask[] {
        return this.entries.filter(entry => entry.owner === owner).map(entry => ({...entry.task}))
    }

    enqueue(notice: Notice, owner: string, work: Work): Promise<NoticeSummary> {
        if (this.activeCount >= 200) {
            return Promise.reject(new Error('摘要队列已满，请等待部分任务完成。'))
        }
        // Keep recent results available without retaining an unbounded task history.
        if (this.entries.length >= 400) this.entries = this.entries.filter(entry => !summaryTaskFinished(entry.task))
        const promise = new Promise<NoticeSummary>((resolve, reject) => {
            this.entries.push({
                task: {
                    id: randomUUID(),
                    sourceId: notice.sourceId,
                    url: notice.url,
                    title: notice.title,
                    status: 'queued'
                },
                owner, controller: new AbortController(), work, resolve, reject
            })
        })
        this.changed()
        queueMicrotask(() => {
            void this.drain()
        })
        return promise
    }

    cancel(ids: string[], owner: string) {
        const selected = new Set(ids)
        for (const entry of this.entries) {
            if (entry.owner !== owner || !selected.has(entry.task.id) || summaryTaskFinished(entry.task)) continue
            entry.task.status = 'cancelled'
            const error = new Error('已取消通知摘要。')
            entry.controller.abort(error)
            entry.reject(error)
        }
        this.changed()
    }

    clearFinished(owner: string) {
        this.entries = this.entries.filter(entry => entry.owner !== owner || !summaryTaskFinished(entry.task))
        this.changed()
    }

    remove(ids: string[], owner: string) {
        this.cancel(ids, owner)
        const selected = new Set(ids)
        this.entries = this.entries.filter(entry => entry.owner !== owner || !selected.has(entry.task.id))
        this.changed()
    }

    clear(owner: string) {
        this.entries = this.entries.filter(entry => entry.owner !== owner || entry.task.status !== 'completed')
        this.changed()
    }

    private changed() {
        for (const listener of this.listeners) listener()
    }

    private async drain() {
        if (this.running) return
        this.running = true
        try {
            for (; ;) {
                const entry = this.entries.find(entry => entry.task.status === 'queued')
                if (!entry) break
                const signal = entry.controller.signal
                const stage = (status: 'reading' | 'generating' | 'saving') => {
                    if (signal.aborted) return
                    entry.task.status = status
                    this.changed()
                }
                stage('reading')
                let abort: () => void = () => {
                }
                try {
                    const cancelled = new Promise<never>((_resolve, reject) => {
                        abort = () => reject(signal.reason)
                        signal.addEventListener('abort', abort, {once: true})
                    })
                    const result = await Promise.race([entry.work(signal, stage), cancelled])
                    signal.throwIfAborted()
                    entry.task.status = 'completed'
                    entry.resolve(result)
                } catch (error) {
                    if (!signal.aborted) {
                        entry.task.status = 'failed'
                        entry.task.error = error instanceof Error ? error.message : '摘要生成失败。'
                    }
                    entry.reject(error instanceof Error ? error : new Error('摘要生成失败。'))
                } finally {
                    signal.removeEventListener('abort', abort)
                    this.changed()
                }
            }
        } finally {
            this.running = false
        }
    }
}

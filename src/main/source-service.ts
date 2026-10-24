import type {AppDatabase} from './database'
import type {MessageSource} from '../shared/sources'
import {discoverNoticeLists, parseNotices} from './notice-parser.ts'
import {requestSourcePage, type SourcePage} from './source-fetch.ts'

type RequestPage = (url: string) => Promise<SourcePage>

export async function collectSource(source: MessageSource, requestPage: RequestPage = requestSourcePage) {
    const page = await requestPage(source.url)
    let error = ''
    // A homepage can contain news as well as announcements; prefer its notice column.
    const candidates = discoverNoticeLists(page.text, page.url)
    for (const candidate of candidates) {
        try {
            const list = await requestPage(candidate)
            const items = parseNotices(list.text, list.url, source.preset)
            if (items.length) return {items, listUrl: list.url}
        } catch (cause) { error = cause instanceof Error ? cause.message : '来源加载失败。' }
    }
    const items = parseNotices(page.text, page.url, source.preset)
    if (items.length && !candidates.length) return {items, listUrl: page.url}
    throw new Error(error || '未解析到通知，请检查来源网址或改用通知列表页。')
}

export class SourceRefreshService {
    private refreshing: Promise<ReturnType<AppDatabase['getNotices']>> | null = null
    private db: AppDatabase
    private requestPage: RequestPage

    constructor(db: AppDatabase, requestPage: RequestPage = requestSourcePage) {
        this.db = db
        this.requestPage = requestPage
    }

    refresh() {
        if (!this.refreshing) this.refreshing = this.run().finally(() => { this.refreshing = null })
        return this.refreshing
    }

    private async run() {
        const pending = this.db.getSources().filter(source => source.enabled)
        await Promise.all(Array.from({length: Math.min(3, pending.length)}, async () => {
            while (pending.length) {
                const source = pending.shift()!
                try {
                    const result = await collectSource(source, this.requestPage)
                    this.db.saveNotices(result.items, source.id, source.revision, result.listUrl)
                } catch (error) {
                    this.db.setSourceError(source.id, source.revision, error instanceof Error ? error.message : '来源加载失败。')
                }
            }
        }))
        return this.db.getNotices()
    }
}

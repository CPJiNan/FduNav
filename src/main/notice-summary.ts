import {createHash} from 'node:crypto'
import {type ChatMessage, completeLlm} from './llm-connection.ts'
import {SummaryQueue} from './summary-queue.ts'
import type {AppDatabase} from './database'
import type {LlmSettingsService} from './llm-settings'
import type {Notice, NoticeDetail, NoticeRef, NoticeRelevance, NoticeSummary} from '../shared/notices'
import type {LlmSettings} from '../shared/llm'
import {
    educationLevelOptions,
    genderOptions,
    identityOptions,
    type MessagePreferences,
    validateRequiredMessagePreferences,
} from '../shared/message-preferences.ts'

function normalizeRelevance(value: unknown): NoticeRelevance | null {
    if (value === 'related') return 'related'
    if (value === 'maybe') return 'maybe'
    return null
}

export function parseSummaryOutput(text: string): { content: string; relevance: NoticeRelevance | null } {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const object = cleaned.match(/\{[\s\S]*\}/)?.[0]
    const candidates = object && object !== cleaned ? [cleaned, object] : [cleaned]
    for (const candidate of candidates) {
        try {
            const value = JSON.parse(candidate) as Record<string, unknown> | null
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue
            if (typeof value.summary !== 'string' || !value.summary.trim()) continue
            return {content: value.summary.trim(), relevance: normalizeRelevance(value.relevance)}
        } catch {
        }
    }
    throw new Error('模型未返回有效的结构化摘要。')
}

export function summaryMessages(notice: Notice, content: string, preferences: MessagePreferences,
                                prompt: string): ChatMessage[] {
    return [
        {role: 'system', content: prompt},
        {
            role: 'user',
            content: JSON.stringify({
                messagePreferences: {
                    身份: identityOptions.find(option => option.value === preferences.identity)?.label ?? '未填写',
                    性别: genderOptions.find(option => option.value === preferences.gender)?.label ?? '未填写',
                    院系: preferences.department || '未填写',
                    学历阶段: educationLevelOptions.find(option => option.value === preferences.educationLevel)?.label ?? '未填写',
                    年级: preferences.grade === null ? '未填写' : `${preferences.grade}级`,
                    专业: preferences.major || '未填写',
                    校区: preferences.campus || '未填写',
                },
                notice: {
                    title: notice.title,
                    source: notice.sourceName,
                    published: notice.published,
                    content: content.slice(0, 24_000)
                }
            })
        }
    ]
}

export function summaryCacheKey(notice: Notice, preferences: MessagePreferences,
                                settings: LlmSettings, username: string): string {
    return createHash('sha256').update(JSON.stringify({
        version: 4, username, sourceId: notice.sourceId, url: notice.url,
        messages: summaryMessages(notice, '', preferences, settings.summaryPrompt),
        baseUrl: settings.baseUrl, model: settings.model
    })).digest('hex')
}

export class NoticeSummaryService {
    readonly queue = new SummaryQueue()
    private pending = new Map<string, Promise<NoticeSummary>>()
    private db: AppDatabase
    private llm: LlmSettingsService
    private readDetail: (notice: NoticeRef) => Promise<NoticeDetail>
    private complete: typeof completeLlm

    constructor(db: AppDatabase, llm: LlmSettingsService,
                readDetail: (notice: NoticeRef) => Promise<NoticeDetail>, complete = completeLlm) {
        this.db = db
        this.llm = llm
        this.readDetail = readDetail
        this.complete = complete
    }

    relevanceFor(notice: Notice): NoticeRelevance | null {
        try {
            const context = this.contextFor(notice)
            return this.effectiveRelevance(notice, context.username,
                normalizeRelevance(this.db.getNoticeSummary(notice.sourceId, notice.url, context.key)?.relevance))
        } catch {
            return null
        }
    }

    needsSummary(ref: NoticeRef): boolean {
        const context = this.context(ref)
        return !this.pending.has(context.key) &&
            !this.db.getNoticeSummary(ref.sourceId, ref.url, context.key)?.summary.trim()
    }

    async summarize(ref: NoticeRef, force = false): Promise<NoticeSummary> {
        const context = this.context(ref)
        const running = this.pending.get(context.key)
        if (running) return running
        if (!force) {
            const cached = this.db.getNoticeSummary(ref.sourceId, ref.url, context.key)
            if (cached?.summary.trim()) {
                return {
                    content: cached.summary,
                    relevance: this.effectiveRelevance(ref, context.username, normalizeRelevance(cached.relevance)),
                    model: cached.model,
                    cached: true
                }
            }
        }
        if (!context.settings.enabled) throw new Error('请先在设置中启用 LLM。')
        if (!context.settings.model) throw new Error('请先配置 LLM 模型。')
        const request = this.queue.enqueue(context.notice, context.username,
            (signal, stage) => this.generate(ref, context, signal, stage))
        this.pending.set(context.key, request)
        try {
            return await request
        } finally {
            this.pending.delete(context.key)
        }
    }

    private effectiveRelevance(notice: NoticeRef, username: string, predicted: NoticeRelevance | null): NoticeRelevance | null {
        const choice = this.db.getNoticeRelevanceChoice(username, notice.sourceId, notice.url)
        return choice === null ? predicted : choice === 'none' ? null : choice
    }

    private contextFor(notice: Notice) {
        const account = this.db.getAccount()
        if (!account) throw new Error('请先登录。')
        const checked = validateRequiredMessagePreferences(this.db.getMessagePreferences())
        if (!checked.ok) throw new Error('请先完善消息偏好。')
        const preferences = checked.data
        const settings = this.llm.get()
        return {
            notice, preferences, settings, username: account.username,
            key: summaryCacheKey(notice, preferences, settings, account.username)
        }
    }

    private context(ref: NoticeRef) {
        const notice = this.db.getNotice(ref.sourceId, ref.url)
        if (!notice) throw new Error('未找到这条通知，请刷新列表。')
        return this.contextFor(notice)
    }

    private async generate(ref: NoticeRef, context: ReturnType<NoticeSummaryService['context']>, cancelled: AbortSignal,
                           stage: (status: 'reading' | 'generating' | 'saving') => void): Promise<NoticeSummary> {
        const signal = AbortSignal.any([this.llm.getRequestSignal(), cancelled])
        const assertCurrent = () => {
            cancelled.throwIfAborted()
            if (signal.aborted) throw new Error('LLM 已停用，请重新发起请求。')
            if (this.context(ref).key !== context.key) throw new Error('账号、消息偏好或 LLM 设置已变化，请重新生成摘要。')
        }
        assertCurrent()
        const connection = await this.llm.getConnection()
        try {
            assertCurrent()
            if (connection.baseUrl !== context.settings.baseUrl || connection.model !== context.settings.model) {
                throw new Error('LLM 设置已变化，请重新生成摘要。')
            }
            const detail = await this.readDetail(ref)
            assertCurrent()
            if (detail.requiresLogin) throw new Error('需要登录后才能生成摘要。')
            const content = detail.content.trim()
            if (!content) throw new Error('这条通知没有可摘要的正文，请查看学校原文。')
            const messages = summaryMessages(context.notice, content, context.preferences,
                context.settings.summaryPrompt)
            stage('generating')
            const result = (await this.complete(connection, messages, signal)).trim()
            assertCurrent()
            if (!result) throw new Error('模型没有返回摘要内容。')
            const output = parseSummaryOutput(result)
            if (!output.content) throw new Error('模型没有返回摘要内容。')
            const summary = output.content.slice(0, 4000)
            stage('saving')
            this.db.saveNoticeSummary(ref.sourceId, ref.url, context.key, connection.model, summary,
                output.relevance ?? '')
            return {
                content: summary,
                relevance: this.effectiveRelevance(ref, context.username, output.relevance),
                model: connection.model,
                cached: false
            }
        } finally {
            connection.apiKey = ''
        }
    }
}

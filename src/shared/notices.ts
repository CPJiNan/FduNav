import type {Result} from './accounts'
import type {MessageSource} from './sources'

export interface ParsedNotice {
    url: string;
    title: string;
    published: string
}

export interface NoticeRef {
    sourceId: string;
    url: string
}

export interface Notice extends ParsedNotice, NoticeRef {
    sourceName: string
    read: boolean
    relevance?: NoticeRelevance | null
}

export interface NoticeList {
    items: Notice[];
    updatedAt: string | null
    sources: MessageSource[]
}

export type NoticeBodyTag = 'p' | 'div' | 'span' | 'br' | 'hr' | 'strong' | 'b' | 'em' | 'i' | 'u' | 's' |
    'sub' | 'sup' | 'ul' | 'ol' | 'li' | 'table' | 'thead' | 'tbody' | 'tfoot' | 'tr' | 'td' | 'th' |
    'blockquote' | 'h2' | 'h3' | 'h4' | 'figure' | 'figcaption' | 'pre'

export type NoticeBodyNode = { type: 'text'; text: string } |
    { type: 'image'; url: string; alt: string; width?: number; height?: number } |
    {
        type: 'element'; tag: NoticeBodyTag; children: NoticeBodyNode[];
        align?: 'left' | 'center' | 'right' | 'justify'; colSpan?: number; rowSpan?: number
    }

export interface NoticeDetail {
    content: string;
    body: NoticeBodyNode[]
    imageCount: number;
    requiresLogin: boolean
    attachments: { name: string; url: string }[]
    attachmentError?: string
}

export type NoticeRelevance = 'related' | 'maybe'
export type NoticeRelevanceChoice = NoticeRelevance | 'none'

export interface NoticeSummary {
    content: string;
    model: string;
    cached: boolean
    relevance: NoticeRelevance | null
}

export interface NoticesAPI {
    unreadState(): Promise<Result<{ username: string | null; unread: boolean }>>

    onUnreadChanged(callback: (state: { username: string | null; unread: boolean }) => void): () => void

    summaryQueue(): Promise<Result<SummaryTask[]>>

    enqueueSummaries(notices: NoticeRef[]): Promise<Result<void>>

    cancelSummaries(ids: string[]): Promise<Result<void>>

    clearSummaryQueue(): Promise<Result<void>>

    removeSummaries(ids: string[]): Promise<Result<void>>

    getNotice(notice: NoticeRef): Promise<Result<Notice>>

    markRead(notice: NoticeRef): Promise<Result<void>>

    markManyRead(notices: NoticeRef[]): Promise<Result<void>>

    setRelevance(notice: NoticeRef, relevance: NoticeRelevanceChoice): Promise<Result<NoticeRelevance | null>>

    onSummaryQueueChanged(callback: (tasks: SummaryTask[]) => void): () => void

    onChanged(callback: () => void): () => void

    list(refresh?: boolean): Promise<Result<NoticeList>>

    detail(notice: NoticeRef): Promise<Result<NoticeDetail>>

    summarize(notice: NoticeRef, force?: boolean): Promise<Result<NoticeSummary>>

    image(notice: NoticeRef & { imageUrl: string }): Promise<Result<string>>

    openSource(notice: NoticeRef): Promise<Result<void>>

    openAttachment(notice: NoticeRef & { urlToOpen: string }): Promise<Result<void>>
}

export interface SummaryTask extends NoticeRef {
    id: string
    title: string
    status: 'queued' | 'reading' | 'generating' | 'saving' | 'completed' | 'failed' | 'cancelled'
    error?: string
}

export function summaryTaskFinished(task: SummaryTask): boolean {
    return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
}

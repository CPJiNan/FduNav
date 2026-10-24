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
}

export interface NoticeList {
    items: Notice[];
    updatedAt: string | null
    sources: MessageSource[]
}

export type NoticeBodyTag = 'p' | 'div' | 'span' | 'br' | 'hr' | 'strong' | 'b' | 'em' | 'i' | 'u' | 's' |
    'sub' | 'sup' | 'ul' | 'ol' | 'li' | 'table' | 'thead' | 'tbody' | 'tfoot' | 'tr' | 'td' | 'th' |
    'blockquote' | 'h2' | 'h3' | 'h4' | 'figure' | 'figcaption' | 'pre'

export type NoticeBodyNode = {type: 'text'; text: string} |
    {type: 'image'; url: string; alt: string; width?: number; height?: number} |
    {type: 'element'; tag: NoticeBodyTag; children: NoticeBodyNode[];
        align?: 'left' | 'center' | 'right' | 'justify'; colSpan?: number; rowSpan?: number}

export interface NoticeDetail {
    content: string;
    body?: NoticeBodyNode[]
    imageCount: number;
    requiresLogin: boolean
    attachments: { name: string; url: string }[]
    attachmentError?: string
}

export interface NoticesAPI {
    list(refresh?: boolean): Promise<Result<NoticeList>>

    detail(notice: NoticeRef): Promise<Result<NoticeDetail>>

    image(notice: NoticeRef & {imageUrl: string}): Promise<Result<string>>

    openSource(notice: NoticeRef): Promise<Result<void>>

    openAttachment(notice: NoticeRef & { urlToOpen: string }): Promise<Result<void>>
}

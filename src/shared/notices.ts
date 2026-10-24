import type {Result} from './accounts'
import type {MessageSource} from './sources'

export interface ParsedNotice {
    url: string;
    title: string;
    published: string
}

export interface NoticeRef {sourceId: string; url: string}

export interface Notice extends ParsedNotice, NoticeRef {sourceName: string}

export interface NoticeList {
    items: Notice[];
    updatedAt: string | null
    sources: MessageSource[]
}

export interface NoticeDetail {
    content: string;
    imageCount: number;
    requiresLogin: boolean
    attachments: {name: string; url: string}[]
    attachmentError?: string
}

export interface NoticesAPI {
    list(refresh?: boolean): Promise<Result<NoticeList>>

    detail(notice: NoticeRef): Promise<Result<NoticeDetail>>

    openSource(notice: NoticeRef): Promise<Result<void>>

    openAttachment(notice: NoticeRef & {urlToOpen: string}): Promise<Result<void>>
}

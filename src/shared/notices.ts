import type {Result} from './accounts'

export interface Notice {
    url: string;
    title: string;
    published: string
}

export interface NoticeList {
    items: Notice[];
    updatedAt: string | null
}

export interface NoticeDetail {
    content: string;
    imageCount: number;
    requiresLogin: boolean
}

export interface NoticesAPI {
    list(refresh?: boolean): Promise<Result<NoticeList>>

    detail(url: string): Promise<Result<NoticeDetail>>

    openSource(url: string): Promise<Result<void>>
}

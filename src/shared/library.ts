import type {Result} from './accounts'

export interface LibraryCrowding {
    items: { id: string; name: string; count: number | null }[]
    updatedAt: string
}

export interface LibraryAPI {
    crowding(refresh?: boolean): Promise<Result<LibraryCrowding>>
}

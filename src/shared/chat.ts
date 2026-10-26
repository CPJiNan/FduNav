import type {Result} from './accounts'
import type {Notice} from './notices'
import type {CalendarEvent} from './calendar'

export type ChatCard = {kind: 'notice'; notice: Notice} |
    {kind: 'event'; event: CalendarEvent; deleted?: boolean}

export interface ChatTurn {
    id: string
    user: string
    reply: string
    cards: ChatCard[]
    error?: string
}

export interface ChatState {
    username: string
    turns: ChatTurn[]
    busy: boolean
    status: string
}

export interface ChatAPI {
    get(): Promise<Result<ChatState>>
    send(text: string): Promise<Result<ChatState>>
    cancel(): Promise<Result<null>>
    clear(): Promise<Result<ChatState>>
    onChanged(callback: (state: ChatState) => void): () => void
}

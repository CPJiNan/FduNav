import type {Result} from './accounts'
import type {Notice, NoticeSummary} from './notices'
import type {CalendarEvent, CalendarEventInput, CalendarOccurrence} from './calendar'
import type {Todo, TodoInput} from './todos'

export type ChatCard = { kind: 'notice'; notice: Notice } |
    { kind: 'event'; event: CalendarEvent; deleted?: boolean } |
    { kind: 'course'; occurrence: CalendarOccurrence }

export interface ChatSummaryRequest {
    id: string
    notice: Notice
    status: 'pending' | 'generating' | 'completed' | 'rejected' | 'failed'
    summary?: NoticeSummary
    error?: string
}

export type ChatAction = { kind: 'create_event'; after: CalendarEventInput } |
    { kind: 'create_todo'; todo: TodoInput }

export interface ChatActionRequest {
    id: string
    action: ChatAction
    status: 'pending' | 'executing' | 'completed' | 'rejected' | 'failed'
    result?: CalendarEvent | Todo
    error?: string
}

export interface ChatTurn {
    id: string
    user: string
    reply: string
    cards: ChatCard[]
    summaryRequests?: ChatSummaryRequest[]
    actionRequests?: ChatActionRequest[]
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

    decideSummary(turnId: string, requestId: string, allow: boolean): Promise<Result<ChatState>>

    decideAction(turnId: string, requestId: string, allow: boolean): Promise<Result<ChatState>>

    onChanged(callback: (state: ChatState) => void): () => void
}

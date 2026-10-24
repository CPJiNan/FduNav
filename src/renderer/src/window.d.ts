import type {AccountAPI} from '../../shared/accounts'
import type {NoticesAPI} from '../../shared/notices'
import type {MessagePreferencesAPI} from '../../shared/message-preferences'
import type {SourcesAPI} from '../../shared/sources'
import type {LlmAPI} from '../../shared/llm'
import type {TimetableAPI} from '../../shared/timetable'

declare global {
    interface Window {
        accounts?: AccountAPI
        notices?: NoticesAPI
        messagePreferences?: MessagePreferencesAPI
        sources?: SourcesAPI
        llm?: LlmAPI
        timetable?: TimetableAPI
        windowControls?: {
            minimize(): void
            toggleMaximize(): void
            close(): void
            isMaximized(): Promise<boolean>
            onMaximizedChanged(callback: (maximized: boolean) => void): () => void
        }
    }
}

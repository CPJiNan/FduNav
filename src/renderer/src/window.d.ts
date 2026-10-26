import type {AccountAPI} from '../../shared/accounts'
import type {NoticesAPI} from '../../shared/notices'
import type {MessagePreferencesAPI} from '../../shared/message-preferences'
import type {SourcesAPI} from '../../shared/sources'
import type {LlmAPI} from '../../shared/llm'
import type {TimetableAPI} from '../../shared/timetable'
import type {CalendarAPI} from '../../shared/calendar'
import type {TodosAPI} from '../../shared/todos'
import type {GeneralSettingsAPI} from '../../shared/general-settings'
import type {NotificationSettingsAPI} from '../../shared/notification-settings'
import type {AppInfoAPI} from '../../shared/app-info'
import type {ChatAPI} from '../../shared/chat'

declare global {
    interface Window {
        chat?: ChatAPI
        appInfo?: AppInfoAPI
        generalSettings?: GeneralSettingsAPI
        notificationSettings?: NotificationSettingsAPI
        accounts?: AccountAPI
        notices?: NoticesAPI
        messagePreferences?: MessagePreferencesAPI
        sources?: SourcesAPI
        llm?: LlmAPI
        timetable?: TimetableAPI
        calendar?: CalendarAPI
        todos?: TodosAPI
        windowControls?: {
            minimize(): void
            toggleMaximize(): void
            close(): void
            isMaximized(): Promise<boolean>
            onMaximizedChanged(callback: (maximized: boolean) => void): () => void
        }
    }
}

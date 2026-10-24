import type {AccountAPI} from '../../shared/accounts'
import type {NoticesAPI} from '../../shared/notices'
import type {MessagePreferencesAPI} from '../../shared/message-preferences'
import type {SourcesAPI} from '../../shared/sources'
import type {LlmAPI} from '../../shared/llm'

declare global {
    interface Window {
        accounts?: AccountAPI
        notices?: NoticesAPI
        messagePreferences?: MessagePreferencesAPI
        sources?: SourcesAPI
        llm?: LlmAPI
        windowControls?: {
            minimize(): void
            toggleFullscreen(): void
            close(): void
            isFullscreen(): Promise<boolean>
            onFullscreenChanged(callback: (fullscreen: boolean) => void): () => void
        }
    }
}

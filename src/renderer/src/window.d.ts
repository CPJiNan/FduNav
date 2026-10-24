import type {AccountAPI} from '../../shared/accounts'
import type {NoticesAPI} from '../../shared/notices'
import type {MessagePreferencesAPI} from '../../shared/message-preferences'

declare global {
    interface Window {
        accounts?: AccountAPI
        notices?: NoticesAPI
        messagePreferences?: MessagePreferencesAPI
        windowControls?: {
            minimize(): void
            toggleFullscreen(): void
            close(): void
            isFullscreen(): Promise<boolean>
            onFullscreenChanged(callback: (fullscreen: boolean) => void): () => void
        }
    }
}

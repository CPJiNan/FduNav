import type {AccountAPI} from '../../shared/accounts'
import type {NoticesAPI} from '../../shared/notices'

declare global {
    interface Window {
        accounts?: AccountAPI
        notices?: NoticesAPI
        windowControls?: {
            minimize(): void
            toggleFullscreen(): void
            close(): void
            isFullscreen(): Promise<boolean>
            onFullscreenChanged(callback: (fullscreen: boolean) => void): () => void
        }
    }
}

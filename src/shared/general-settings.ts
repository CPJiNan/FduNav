import type {Result} from './accounts'

export type CloseAction = 'tray' | 'quit'

export function isCloseAction(value: unknown): value is CloseAction {
    return value === 'tray' || value === 'quit'
}

export interface GeneralSettings {
    launchAtLogin: boolean
    launchAtLoginAvailable: boolean
    closeAction: CloseAction
}

export interface GeneralSettingsAPI {
    get(): Promise<Result<GeneralSettings>>
    setLaunchAtLogin(enabled: boolean): Promise<Result<GeneralSettings>>
    setCloseAction(action: CloseAction): Promise<Result<GeneralSettings>>
}

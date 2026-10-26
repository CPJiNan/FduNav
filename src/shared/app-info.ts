import type {Result} from './accounts'

export interface AppInfo {
    version: string
    repository: string
}

export interface AppInfoAPI {
    get(): Promise<Result<AppInfo>>

    openRepository(): Promise<Result<void>>
}

import type {Result} from './accounts'

export interface CampusCardBalance {
    balance: string
    updatedAt: string
}

export interface CampusCardAPI {
    balance(refresh?: boolean): Promise<Result<CampusCardBalance>>

    openRecords(): Promise<Result<void>>
}

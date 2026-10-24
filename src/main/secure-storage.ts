import {safeStorage} from 'electron'
import type {SecretStorage} from './llm-settings'

export const secureStorage: SecretStorage = {
    available: async () => await safeStorage.isAsyncEncryptionAvailable() &&
        !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
    encrypt: value => safeStorage.encryptStringAsync(value),
    decrypt: async value => (await safeStorage.decryptStringAsync(Buffer.from(value))).result,
}

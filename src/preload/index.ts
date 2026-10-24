import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron'
import type {AccountAPI} from '../shared/accounts'
import type {NoticesAPI} from '../shared/notices'
import type {MessagePreferencesAPI} from '../shared/message-preferences'

const messagePreferences: MessagePreferencesAPI = {
    get: () => ipcRenderer.invoke('preferences:get-messages'),
    save: input => ipcRenderer.invoke('preferences:set-messages', input),
}
contextBridge.exposeInMainWorld('messagePreferences', messagePreferences)

const notices: NoticesAPI = {
    list: refresh => ipcRenderer.invoke('notices:list', refresh),
    detail: url => ipcRenderer.invoke('notices:detail', url),
    openSource: url => ipcRenderer.invoke('notices:open-source', url),
}
contextBridge.exposeInMainWorld('notices', notices)

const accounts: AccountAPI = {
    getState: () => ipcRenderer.invoke('account:state'),
    login: input => ipcRenderer.invoke('account:login', input),
    verify: () => ipcRenderer.invoke('account:verify'),
    logout: () => ipcRenderer.invoke('account:logout'),
    getTheme: () => ipcRenderer.invoke('preferences:get-theme'),
    setTheme: theme => ipcRenderer.invoke('preferences:set-theme', theme),
}
contextBridge.exposeInMainWorld('accounts', accounts)

contextBridge.exposeInMainWorld('windowControls', {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
    close: () => ipcRenderer.send('window:close'),
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:is-fullscreen'),
    onFullscreenChanged: (callback: (fullscreen: boolean) => void) => {
        const listener = (_event: IpcRendererEvent, fullscreen: boolean) => callback(fullscreen)
        ipcRenderer.on('window:fullscreen-changed', listener)
        return () => ipcRenderer.removeListener('window:fullscreen-changed', listener)
    },
})

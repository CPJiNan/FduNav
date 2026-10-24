import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron'
import type {AccountAPI} from '../shared/accounts'
import type {NoticesAPI} from '../shared/notices'
import type {MessagePreferencesAPI} from '../shared/message-preferences'
import type {SourcesAPI} from '../shared/sources'
import type {LlmAPI} from '../shared/llm'
import type {TimetableAPI} from '../shared/timetable'
import type {CalendarAPI} from '../shared/calendar'

const calendar: CalendarAPI = {
    list: () => ipcRenderer.invoke('calendar:list'),
    save: input => ipcRenderer.invoke('calendar:save', input),
    remove: id => ipcRenderer.invoke('calendar:remove', id),
}
contextBridge.exposeInMainWorld('calendar', calendar)

const timetable: TimetableAPI = {
    get: options => ipcRenderer.invoke('timetable:get', options),
    setStartDate: date => ipcRenderer.invoke('timetable:set-start-date', date),
}
contextBridge.exposeInMainWorld('timetable', timetable)

const llm: LlmAPI = {
    get: () => ipcRenderer.invoke('llm:get'),
    setEnabled: enabled => ipcRenderer.invoke('llm:set-enabled', enabled),
    save: input => ipcRenderer.invoke('llm:save', input),
    test: input => ipcRenderer.invoke('llm:test', input),
    models: input => ipcRenderer.invoke('llm:models', input),
}
contextBridge.exposeInMainWorld('llm', llm)

const sources: SourcesAPI = {
    list: () => ipcRenderer.invoke('sources:list'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('sources:set-enabled', {id, enabled}),
}
contextBridge.exposeInMainWorld('sources', sources)

const messagePreferences: MessagePreferencesAPI = {
    get: () => ipcRenderer.invoke('preferences:get-messages'),
    save: input => ipcRenderer.invoke('preferences:set-messages', input),
}
contextBridge.exposeInMainWorld('messagePreferences', messagePreferences)

const notices: NoticesAPI = {
    list: refresh => ipcRenderer.invoke('notices:list', refresh),
    detail: notice => ipcRenderer.invoke('notices:detail', notice),
    image: notice => ipcRenderer.invoke('notices:image', notice),
    openSource: notice => ipcRenderer.invoke('notices:open-source', notice),
    openAttachment: notice => ipcRenderer.invoke('notices:open-attachment', notice),
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
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (callback: (maximized: boolean) => void) => {
        const listener = (_event: IpcRendererEvent, maximized: boolean) => callback(maximized)
        ipcRenderer.on('window:maximized-changed', listener)
        return () => ipcRenderer.removeListener('window:maximized-changed', listener)
    },
})

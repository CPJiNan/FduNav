import {app, BrowserWindow, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent} from 'electron'
import {join} from 'node:path'
import {existsSync, mkdirSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {AppDatabase} from './database'
import {registerAccountHandlers} from './accounts'
import {registerNoticeHandlers} from './notices'
import {registerMessagePreferenceHandlers} from './message-preferences'
import {registerLlmHandlers} from './llm'
import {registerTimetableHandlers} from './timetable'
import {registerCalendarHandlers} from './calendar'
import {registerTodoHandlers} from './todos'

let database: AppDatabase | undefined

function isAppUrl(value: string) {
    try {
        const url = new URL(value)
        return !app.isPackaged && process.env.ELECTRON_RENDERER_URL
            ? url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
            : url.href.split('#')[0] === pathToFileURL(join(__dirname, '../renderer/index.html')).href
    } catch {
        return false
    }
}

function senderWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
    if (event.senderFrame !== event.sender.mainFrame) return null
    return BrowserWindow.fromWebContents(event.sender)
}

ipcMain.on('window:minimize', event => senderWindow(event)?.minimize())
ipcMain.on('window:toggle-maximize', event => {
    const window = senderWindow(event)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
})
ipcMain.on('window:close', event => senderWindow(event)?.close())
ipcMain.handle('window:is-maximized', event => senderWindow(event)?.isMaximized() ?? false)

function createWindow(): void {
    const icon = [
        join(app.getAppPath(), 'resources/icon.png'),
        join(__dirname, '../../resources/icon.png')
    ].find(existsSync)
    const window = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 360,
        minHeight: 420,
        frame: false,
        title: 'FduNav',
        icon,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    })

    window.setMenu(null)
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
    window.webContents.on('will-navigate', (event, url) => {
        if (!isAppUrl(url)) event.preventDefault()
    })
    const publishMaximized = () => {
        window.webContents.send('window:maximized-changed', window.isMaximized())
    }
    window.on('maximize', publishMaximized)
    window.on('unmaximize', publishMaximized)

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
        void window.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
        void window.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

app.whenReady().then(async () => {
    try {
        mkdirSync(app.getPath('userData'), {recursive: true})
        database = new AppDatabase(join(app.getPath('userData'), 'fdunav.sqlite'))
        const trusted = (event: IpcMainInvokeEvent) => !!senderWindow(event) && isAppUrl(event.senderFrame?.url ?? '')
        const accounts = await registerAccountHandlers(database, trusted)
        registerTimetableHandlers(database, accounts, trusted)
        registerCalendarHandlers(database, accounts, trusted)
        registerTodoHandlers(database, accounts, trusted)
        const llm = registerLlmHandlers(database, trusted)
        registerNoticeHandlers(database, accounts, llm, trusted)
        registerMessagePreferenceHandlers(database, trusted)
    } catch {
        dialog.showErrorBox('无法打开应用数据', 'SQLite 数据库初始化失败，请检查应用数据目录的访问权限。')
        app.quit()
        return
    }
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('will-quit', () => database?.close())

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

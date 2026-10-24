import {app, BrowserWindow, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent} from 'electron'
import {join} from 'node:path'
import {mkdirSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {AppDatabase} from './database'
import {registerAccountHandlers} from './accounts'
import {registerNoticeHandlers} from './notices'
import {registerMessagePreferenceHandlers} from './message-preferences'
import {registerLlmHandlers} from './llm'

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
ipcMain.on('window:toggle-fullscreen', event => {
    const window = senderWindow(event)
    if (window) window.setFullScreen(!window.isFullScreen())
})
ipcMain.on('window:close', event => senderWindow(event)?.close())
ipcMain.handle('window:is-fullscreen', event => senderWindow(event)?.isFullScreen() ?? false)

function createWindow(): void {
    const window = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 360,
        minHeight: 420,
        frame: false,
        title: 'FduNav',
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
    const publishFullscreen = () => {
        window.webContents.send('window:fullscreen-changed', window.isFullScreen())
    }
    window.on('enter-full-screen', publishFullscreen)
    window.on('leave-full-screen', publishFullscreen)
    window.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.isAutoRepeat) return
        if (input.key === 'F11') {
            event.preventDefault()
            window.setFullScreen(!window.isFullScreen())
        } else if (input.key === 'Escape' && window.isFullScreen()) {
            event.preventDefault()
            window.setFullScreen(false)
        }
    })

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
        void window.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
        void window.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

app.whenReady().then(() => {
    try {
        mkdirSync(app.getPath('userData'), {recursive: true})
        database = new AppDatabase(join(app.getPath('userData'), 'fdunav.sqlite'))
        const trusted = (event: IpcMainInvokeEvent) => !!senderWindow(event) && isAppUrl(event.senderFrame?.url ?? '')
        const accounts = registerAccountHandlers(database, trusted)
        registerNoticeHandlers(database, accounts, trusted)
        registerMessagePreferenceHandlers(database, trusted)
        registerLlmHandlers(database, trusted)
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

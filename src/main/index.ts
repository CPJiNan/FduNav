import {app, BrowserWindow} from 'electron'
import {join} from 'node:path'

function createWindow(): void {
    const window = new BrowserWindow({
        width: 1000,
        height: 700,
        title: 'FduNav',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    })

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
        void window.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
        void window.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

app.whenReady().then(() => {
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

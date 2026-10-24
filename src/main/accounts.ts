import {ipcMain, type IpcMainInvokeEvent} from 'electron'
import {CookieJar} from 'tough-cookie'
import {AppDatabase} from './database'
import {authenticate, AuthError, FudanTransport, isAuthUrl, verifySession} from './fudan-auth'
import type {AccountState, LoginInput, Result, Theme} from '../shared/accounts'
import {secureStorage} from './secure-storage'

const signedOut = (): AccountState => ({username: null, status: 'signed-out', lastLogin: null, message: ''})

export class AccountService {
    private state = signedOut()
    private jar: CookieJar | null = null
    private target = ''
    private busy = false

    constructor(private db: AppDatabase) {}

    async initialize() {
        const saved = this.db.getAccount()
        if (saved) {
            this.state = {
                username: saved.username,
                lastLogin: saved.last_login,
                status: 'unverified',
                message: '已恢复本地账号，请验证会话或重新登录。'
            }
            try {
                if (!await secureStorage.available()) throw new Error()
                this.jar = CookieJar.deserializeSync(JSON.parse(await secureStorage.decrypt(saved.cookies)))
                this.target = saved.target
            } catch {
                this.state.status = 'expired'
                this.state.message = '本地会话无法解密，请重新登录。'
            }
        }
    }

    getState() {
        return {...this.state}
    }

    async login(input: LoginInput) {
        return this.exclusive(async () => {
            if (!input || typeof input.username !== 'string' || typeof input.password !== 'string' ||
                !input.username.trim() || input.username.length > 128 || !input.password || input.password.length > 1024) {
                throw new AuthError('请输入有效的学号和密码。')
            }
            if (!await secureStorage.available()) {
                throw new AuthError('系统安全存储不可用，暂时无法安全保存登录会话。')
            }
            const transport = new FudanTransport()
            const username = input.username.trim()
            let target: string
            try {
                target = await authenticate(transport, username, input.password)
            } finally {
                input.password = ''
            }
            const lastLogin = new Date().toISOString()
            this.db.saveAccount({
                username,
                target,
                last_login: lastLogin,
                cookies: await secureStorage.encrypt(JSON.stringify(transport.jar.serializeSync()))
            })
            this.jar = transport.jar
            this.target = target
            this.state = {username, lastLogin, status: 'signed-in', message: '已登录复旦统一身份认证。'}
            return this.getState()
        })
    }

    async verify() {
        return this.exclusive(async () => {
            if (!this.jar || !this.state.username) throw new AuthError('请先登录账号。')
            try {
                const valid = await verifySession(new FudanTransport(this.jar), this.target)
                this.state = {
                    ...this.state,
                    status: valid ? 'signed-in' : 'expired',
                    message: valid ? '会话有效。' : '登录已过期，请重新登录。'
                }
                if (valid) this.db.saveAccount({
                    username: this.state.username!,
                    target: this.target,
                    last_login: this.state.lastLogin!,
                    cookies: await secureStorage.encrypt(JSON.stringify(this.jar.serializeSync()))
                })
                else {
                    this.jar = null;
                    this.db.clearAccount()
                }
            } catch (error) {
                this.state = {...this.state, status: 'unverified', message: '暂时无法验证会话，请检查网络后重试。'}
                throw error
            }
            return this.getState()
        })
    }

    async logout() {
        return this.exclusive(async () => {
            this.db.clearAccount()
            this.jar = null
            this.target = ''
            this.state = signedOut()
            return this.getState()
        })
    }

    async readNotice(url: string): Promise<string | null> {
        return this.exclusive(async () => {
            const page = await new FudanTransport(this.jar ?? undefined).request(url)
            if (isAuthUrl(page.url)) {
                if (this.state.username) {
                    this.state = {...this.state, status: 'expired', message: '登录已过期，请重新登录。'}
                    this.jar = null
                    this.db.clearAccount()
                }
                return null
            }
            return page.text
        })
    }

    private async exclusive<T>(work: () => Promise<T>): Promise<T> {
        if (this.busy) throw new AuthError('账号操作正在进行，请等待完成。')
        this.busy = true
        try {
            return await work()
        } finally {
            this.busy = false
        }
    }
}

export async function registerAccountHandlers(db: AppDatabase, trusted: (event: IpcMainInvokeEvent) => boolean) {
    const service = new AccountService(db)
    await service.initialize()

    function handle<T>(channel: string, action: (input: any) => T | Promise<T>) {
        ipcMain.handle(channel, async (event, input): Promise<Result<T>> => {
            if (!trusted(event)) return {ok: false, error: '请求来源无效。'}
            try {
                return {ok: true, data: await action(input)}
            } catch (error) {
                return {ok: false, error: error instanceof AuthError ? error.message : '操作未完成，请重试。'}
            }
        })
    }

    handle('account:state', () => service.getState())
    handle('account:login', (input: LoginInput) => service.login(input))
    handle('account:verify', () => service.verify())
    handle('account:logout', () => service.logout())
    handle('preferences:get-theme', () => db.getTheme())
    handle('preferences:set-theme', (theme: Theme) => {
        if (!['light', 'dark', 'auto'].includes(theme)) throw new AuthError('主题选项无效。')
        db.setTheme(theme)
        return theme
    })
    return service
}

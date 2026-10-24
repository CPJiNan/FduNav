import {type FormEvent, useEffect, useState} from 'react'
import type {AccountState, Result} from '../../shared/accounts'
import {Icon} from './Icon'

const statusLabels = {'signed-out': '未登录', 'signed-in': '已登录', unverified: '待验证会话', expired: '登录已过期'}

export function AccountPanel({account, onChange}: {
    account: AccountState | null;
    onChange: (account: AccountState) => void
}) {
    const [username, setUsername] = useState(account?.username ?? '')
    const [password, setPassword] = useState('')
    const [busy, setBusy] = useState('')
    const [error, setError] = useState('')
    const api = window.accounts
    useEffect(() => {
        if (account?.username) setUsername(value => value || account.username!)
    }, [account?.username])

    async function perform(label: string, action: () => Promise<Result<AccountState>>) {
        if (busy) return
        setBusy(label);
        setError('')
        try {
            const result = await action()
            if (result.ok) onChange(result.data)
            else {
                setError(result.error)
                const state = await api?.getState()
                if (state?.ok) onChange(state.data)
            }
        } catch {
            setError('无法连接账号服务，请重启应用后重试。')
        } finally {
            setBusy('')
        }
    }

    function login(event: FormEvent) {
        event.preventDefault()
        if (!api || busy) return
        const input = {username: username.trim(), password}
        setPassword('')
        void perform('正在登录，请稍候…', () => api.login(input).finally(() => {
            input.password = ''
        }))
    }

    const signedIn = account?.status === 'signed-in'
    const unverified = account?.status === 'unverified'
    return <div className="account-panel">
        {account?.username && <div className="account-summary">
            <div className="account-symbol"><Icon name="user"/></div>
            <div><strong>{account.username}</strong><p className="account-status">{statusLabels[account.status]}</p>
            </div>
        </div>}
        {!api && <p className="account-notice">请在桌面应用中登录。</p>}
        {(account?.status === 'expired' || unverified) && account.message &&
            <p className="account-error" role="alert">{account.message}</p>}
        {!signedIn && !unverified && <form className="account-form" onSubmit={login} aria-busy={!!busy}>
            <label htmlFor="account-username">学号 / 工号</label>
            <input id="account-username" name="username" autoComplete="username" value={username}
                   onChange={event => setUsername(event.target.value)} placeholder="请输入学号或工号" required
                   maxLength={128} disabled={!!busy || !api}/>
            <label htmlFor="account-password">统一身份认证密码</label>
            <input id="account-password" name="password" type="password" autoComplete="current-password"
                   value={password} onChange={event => setPassword(event.target.value)} placeholder="请输入密码"
                   required maxLength={1024} disabled={!!busy || !api}/>
            <button type="submit" className="primary-button"
                    disabled={!!busy || !api || !username.trim() || !password}>登录
            </button>
        </form>}
        {account?.username && <>
            {!unverified && account.lastLogin &&
                <p className="account-time">上次登录：{new Date(account.lastLogin).toLocaleString('zh-CN')}</p>}
            <div className="account-actions">
                {account.status === 'unverified' && <button className="secondary-button" disabled={!!busy || !api}
                                                            onClick={() => api && void perform('正在验证会话…', () => api.verify())}>验证会话</button>}
                <button className="secondary-button" disabled={!!busy || !api}
                        onClick={() => api && void perform('正在退出…', () => api.logout())}>退出登录
                </button>
            </div>
        </>}
        {busy && <p className="account-feedback" role="status">{busy}</p>}
        {error && <p className="account-error" role="alert">{error}</p>}
    </div>
}

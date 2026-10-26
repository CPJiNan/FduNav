import {useEffect, useState} from 'react'
import type {CloseAction, GeneralSettings} from '../../shared/general-settings'
import type {Result} from '../../shared/accounts'
import './styles/general.css'
import './styles/llm.css'

export function GeneralPanel() {
    const [settings, setSettings] = useState<GeneralSettings | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [status, setStatus] = useState('')
    const [retry, setRetry] = useState(0)
    const api = window.generalSettings

    useEffect(() => {
        if (!api) return
        let active = true
        setBusy(true)
        setError('')
        void api.get().then(result => {
            if (!active) return
            if (result.ok) setSettings(result.data)
            else setError(result.error)
        }).catch(() => {
            if (active) setError('无法读取通用设置，请重试。')
        }).finally(() => {
            if (active) setBusy(false)
        })
        return () => { active = false }
    }, [api, retry])

    async function save(action: () => Promise<Result<GeneralSettings>>) {
        if (busy) return
        setBusy(true)
        setError('')
        setStatus('')
        try {
            const result = await action()
            if (result.ok) {
                setSettings(result.data)
                setStatus('已保存')
            } else setError(result.error)
        } catch {
            setError('无法保存通用设置，请重试。')
        } finally {
            setBusy(false)
        }
    }

    return <div className="general-panel" aria-busy={busy}>
        <div className="general-setting-row">
            <label id="launch-at-login-label" htmlFor="launch-at-login">开机后自动启动 FduNav</label>
            <button id="launch-at-login" type="button" className="llm-switch" role="switch"
                    aria-labelledby="launch-at-login-label" aria-checked={settings?.launchAtLogin ?? false}
                    disabled={!api || !settings?.launchAtLoginAvailable || busy}
                    onClick={() => void save(() => api!.setLaunchAtLogin(!settings!.launchAtLogin))}>
                <span className="llm-switch-track" aria-hidden="true"><span/></span>
            </button>
        </div>
        <div className="general-setting-row">
            <label htmlFor="close-action">关闭 FduNav 时</label>
            <select id="close-action" value={settings?.closeAction ?? 'tray'} disabled={!api || !settings || busy}
                    onChange={event => void save(() => api!.setCloseAction(event.target.value as CloseAction))}>
                <option value="tray">最小化至托盘</option>
                <option value="quit">退出 FduNav</option>
            </select>
        </div>
        {!api && <p className="account-notice">请在桌面应用中设置。</p>}
        {busy && <p className="save-status" role="status">{settings ? '正在保存…' : '正在读取设置…'}</p>}
        {error && <p className="account-error" role="alert">{error}{!settings &&
            <button type="button" className="text-button" disabled={busy} onClick={() => setRetry(value => value + 1)}>重试</button>}</p>}
        {status && <p className="save-status" role="status">{status}</p>}
    </div>
}

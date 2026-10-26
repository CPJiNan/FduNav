import {useEffect, useState} from 'react'
import type {CloseAction, GeneralSettings} from '../../shared/general-settings'
import type {Result} from '../../shared/accounts'
import {Icon} from './Icon'
import {readTheme, saveTheme, type Theme} from './theme'
import './styles/general.css'
import './styles/llm.css'

const themes = [
    {value: 'light', label: '浅色主题', icon: 'sun'},
    {value: 'dark', label: '深色主题', icon: 'moon'},
    {value: 'auto', label: '跟随系统', icon: 'monitor'},
] as const

export function GeneralPanel() {
    const [theme, setTheme] = useState<Theme>(readTheme)
    const [storageError, setStorageError] = useState(false)
    const [settings, setSettings] = useState<GeneralSettings | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
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
        try {
            const result = await action()
            if (result.ok) {
                setSettings(result.data)
            } else setError(result.error)
        } catch {
            setError('无法保存通用设置，请重试。')
        } finally {
            setBusy(false)
        }
    }

    async function selectTheme(next: Theme) {
        setTheme(next)
        setStorageError(!await saveTheme(next))
    }

    return <div className="general-panel">
        <fieldset className="general-setting-group" aria-busy={busy}>
            <legend>应用</legend>
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
            </fieldset>
        <fieldset className="general-setting-group theme-options">
            <legend>主题</legend>
            <div className="theme-grid">{themes.map(item => <label
                className={`theme-option ${theme === item.value ? 'is-selected' : ''}`} key={item.value}>
                <input type="radio" name="theme" value={item.value} checked={theme === item.value}
                       onChange={() => void selectTheme(item.value)}/>
                <div className={`theme-preview preview-${item.value}`} aria-hidden="true">
                    {(item.value === 'auto' ? ['light', 'dark'] : [item.value]).map(mode =>
                        <div key={mode} data-theme={mode} className="mini-app">
                            <div className="mini-rail"/>
                            <div className="mini-content">
                                <div className="mini-toolbar"/>
                                <div className="mini-bubble"/>
                                <div className="mini-input"/>
                            </div>
                        </div>)}
                </div>
                <div className="theme-option-title"><Icon name={item.icon}/><span>{item.label}</span>
                    <span className="radio-indicator">{theme === item.value && <Icon name="check"/>}</span>
                </div>
            </label>)}</div>
            {storageError && <p className="save-status has-error" role="alert">主题已生效，但无法保存偏好。</p>}
        </fieldset>
    </div>
}

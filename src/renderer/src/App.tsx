import {type KeyboardEvent, useEffect, useRef, useState} from 'react'
import {Icon} from './Icon'
import {WindowTitlebar} from './WindowTitlebar'
import {AccountPanel} from './AccountPanel'
import {NoticesPage} from './NoticesPage'
import {MessagePreferencesPanel} from './MessagePreferencesPanel'
import {SourcesPanel} from './SourcesPanel'
import type {AccountState} from '../../shared/accounts'
import {readTheme, saveTheme, type Theme} from './theme'
import './styles/app.css'

const themes = [
    {value: 'light', label: '浅色主题', icon: 'sun'},
    {value: 'dark', label: '深色主题', icon: 'moon'},
    {value: 'auto', label: '跟随系统', icon: 'monitor'},
] as const
const tabs = [
    {id: 'account', label: '账号', icon: 'user'},
    {id: 'theme', label: '主题', icon: 'sun'},
    {id: 'messages', label: '消息偏好', icon: 'tag'},
    {id: 'sources', label: '消息来源', icon: 'folder'},
] as const
type Tab = typeof tabs[number]['id']

export default function App() {
    const [theme, setTheme] = useState<Theme>(readTheme)
    const [settings, setSettings] = useState(false)
    const [tab, setTab] = useState<Tab>('theme')
    const [storageError, setStorageError] = useState(false)
    const [account, setAccount] = useState<AccountState | null>(null)
    const settingsButton = useRef<HTMLButtonElement>(null)
    const settingsWasOpen = useRef(false)

    useEffect(() => {
        let active = true
        void window.accounts?.getState().then(result => {
            if (active && result.ok) setAccount(result.data)
        }).catch(() => { /* Account panel provides retryable actions. */
        })
        return () => {
            active = false
        }
    }, [])

    useEffect(() => {
        if (settings) document.getElementById(`settings-tab-${tab}`)?.focus()
        else if (settingsWasOpen.current) settingsButton.current?.focus()
        settingsWasOpen.current = settings
    }, [settings])

    useEffect(() => {
        function onKey(event: globalThis.KeyboardEvent) {
            if (event.key === 'Escape') setSettings(false)
        }

        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    async function selectTheme(next: Theme) {
        setTheme(next)
        setStorageError(!await saveTheme(next))
    }

    function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        const offsets: Record<string, number> = {ArrowDown: 1, ArrowUp: -1, Home: -index, End: tabs.length - 1 - index}
        if (!(event.key in offsets)) return
        event.preventDefault()
        const next = tabs[(index + offsets[event.key] + tabs.length) % tabs.length].id
        setTab(next);
        document.getElementById(`settings-tab-${next}`)?.focus()
    }

    return <><WindowTitlebar/>
        <div className="app-shell">
            <nav className="app-rail" aria-label="应用导航">
                <button className={`icon-button rail-button ${!settings ? 'is-active' : ''}`} aria-label="通知"
                        title="通知" aria-current={!settings ? 'page' : undefined}
                        onClick={() => setSettings(false)}><Icon name="home"/></button>
                <div className="rail-bottom">
                    <button ref={settingsButton} className={`icon-button rail-button ${settings ? 'is-active' : ''}`}
                            aria-label="设置" title="设置" aria-current={settings ? 'page' : undefined}
                            onClick={() => setSettings(true)}><Icon name="settings"/></button>
                </div>
            </nav>

            <div className="workspace-shell">
                <div className="main-shell">
                    <main className="main-content">
                        <div className="settings-page" hidden={!settings}>
                            <div className="settings-layout">
                                <div className="settings-tabs" role="tablist" aria-label="设置分类"
                                     aria-orientation="vertical">
                                    {tabs.map((item, index) => <button key={item.id} id={`settings-tab-${item.id}`}
                                                                       role="tab" aria-selected={tab === item.id}
                                                                       aria-controls={`settings-panel-${item.id}`}
                                                                       tabIndex={tab === item.id ? 0 : -1}
                                                                       onKeyDown={event => tabKey(event, index)}
                                                                       onClick={() => setTab(item.id)}
                                                                       className={`settings-tab ${tab === item.id ? 'is-active' : ''}`}>
                                        <Icon name={item.icon}/><span>{item.label}</span></button>)}
                                </div>
                                <section className="settings-panel" role="tabpanel" id={`settings-panel-${tab}`}
                                         aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>
                                    {tab === 'account' && <AccountPanel account={account} onChange={setAccount}/>}
                                    {tab === 'theme' && <>
                                        <fieldset className="theme-options" aria-label="外观模式">
                                            <div className="theme-grid">{themes.map(item => <label
                                                className={`theme-option ${theme === item.value ? 'is-selected' : ''}`}
                                                key={item.value}>
                                                <input type="radio" name="theme" value={item.value}
                                                       checked={theme === item.value}
                                                       onChange={() => selectTheme(item.value)}/>
                                                <div className={`theme-preview preview-${item.value}`}
                                                     aria-hidden="true">
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
                                                <div className="theme-option-title"><Icon
                                                    name={item.icon}/><span>{item.label}</span><span
                                                    className="radio-indicator">{theme === item.value &&
                                                    <Icon name="check"/>}</span></div>
                                            </label>)}</div>
                                        </fieldset>
                                        {storageError && <p className="save-status has-error"
                                                            role="alert">主题已生效，但无法保存偏好。</p>}
                                    </>}
                                    <div hidden={tab !== 'messages'}><MessagePreferencesPanel/></div>
                                    <div hidden={tab !== 'sources'}><SourcesPanel active={settings && tab === 'sources'}/></div>
                                </section>
                            </div>
                        </div>
                        {!settings && <NoticesPage onLogin={() => {
                            setTab('account');
                            setSettings(true)
                        }}/>}
                    </main>
                </div>
            </div>
        </div>
    </>
}

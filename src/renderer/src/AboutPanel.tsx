import {useEffect, useState} from 'react'
import type {AppInfo} from '../../shared/app-info'
import {Icon} from './Icon'
import './styles/about.css'

export function AboutPanel() {
    const [info, setInfo] = useState<AppInfo | null>(null)
    const [error, setError] = useState('')
    const [opening, setOpening] = useState(false)

    useEffect(() => {
        let active = true
        void window.appInfo?.get().then(result => {
            if (!active) return
            if (result.ok) setInfo(result.data)
            else setError(result.error)
        }).catch(() => {
            if (active) setError('无法读取应用信息。')
        })
        return () => {
            active = false
        }
    }, [])

    async function openRepository() {
        if (!window.appInfo || opening) return
        setOpening(true)
        setError('')
        try {
            const result = await window.appInfo.openRepository()
            if (!result.ok) setError(result.error)
        } catch {
            setError('无法打开 GitHub 仓库。')
        } finally {
            setOpening(false)
        }
    }

    return <div className="about-panel">
        <dl className="about-meta">
            <dt>版本</dt>
            <dd>{info?.version ?? '读取中…'}</dd>
            <dt>GitHub</dt>
            <dd>
                <button type="button" className="text-button about-link" disabled={opening}
                        onClick={() => void openRepository()}>
                    {info?.repository ?? 'https://github.com/CPJiNan/FduNav'}<Icon name="external"/>
                </button>
            </dd>
        </dl>
        {error && <p className="account-error" role="alert">{error}</p>}
    </div>
}

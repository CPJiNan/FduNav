import {useEffect, useState} from 'react'
import {Icon} from './Icon'

export function WindowTitlebar() {
    const controls = window.windowControls
    const [fullscreen, setFullscreen] = useState(false)

    useEffect(() => {
        if (!controls) return
        let active = true
        let receivedUpdate = false
        const unsubscribe = controls.onFullscreenChanged(value => {
            receivedUpdate = true
            if (active) setFullscreen(value)
        })
        void controls.isFullscreen().then(value => {
            if (active && !receivedUpdate) setFullscreen(value)
        }).catch(() => {
        })
        return () => {
            active = false;
            unsubscribe()
        }
    }, [controls])

    const fullscreenLabel = fullscreen ? '退出全屏' : '全屏'
    const hint = (label: string) => controls ? label : `${label}（桌面应用中可用）`
    return <header className="window-titlebar">
        <div className="window-controls" role="group" aria-label="窗口控制">
            <button className="window-button" aria-label="最小化窗口" title={hint('最小化窗口')} disabled={!controls}
                    onClick={() => controls?.minimize()}><Icon name="minimize"/></button>
            <button className="window-button" aria-label={fullscreenLabel} title={hint(`${fullscreenLabel} (F11)`)}
                    disabled={!controls} onClick={() => controls?.toggleFullscreen()}><Icon
                name={fullscreen ? 'exitFullscreen' : 'fullscreen'}/></button>
            <button className="window-button window-close" aria-label="关闭窗口" title={hint('关闭窗口')}
                    disabled={!controls} onClick={() => controls?.close()}><Icon name="close"/></button>
        </div>
    </header>
}

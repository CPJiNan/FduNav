import {useEffect, useState} from 'react'
import {Icon} from './Icon'

export function WindowTitlebar() {
    const controls = window.windowControls
    const [maximized, setMaximized] = useState(false)

    useEffect(() => {
        if (!controls) return
        let active = true
        let receivedUpdate = false
        const unsubscribe = controls.onMaximizedChanged(value => {
            receivedUpdate = true
            if (active) setMaximized(value)
        })
        void controls.isMaximized().then(value => {
            if (active && !receivedUpdate) setMaximized(value)
        }).catch(() => {
        })
        return () => {
            active = false;
            unsubscribe()
        }
    }, [controls])

    const label = maximized ? '还原窗口' : '最大化窗口'
    const hint = (value: string) => controls ? value : `${value}（桌面应用中可用）`
    return <header className="window-titlebar">
        <div className="window-controls" role="group" aria-label="窗口控制">
            <button type="button" className="window-button" aria-label="最小化窗口" title={hint('最小化窗口')} disabled={!controls}
                    onClick={() => controls?.minimize()}><Icon name="minimize"/></button>
            <button type="button" className="window-button" aria-label={label} title={hint(label)}
                    disabled={!controls} onClick={() => controls?.toggleMaximize()}><Icon
                name={maximized ? 'restore' : 'maximize'}/></button>
            <button type="button" className="window-button window-close" aria-label="关闭窗口" title={hint('关闭窗口')}
                    disabled={!controls} onClick={() => controls?.close()}><Icon name="close"/></button>
        </div>
    </header>
}

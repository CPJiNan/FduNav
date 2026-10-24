import {createElement, useEffect, useRef, useState, type ReactNode} from 'react'
import type {NoticeBodyNode, NoticeDetail, NoticeRef} from '../../shared/notices'

function NoticeImage({node, notice}: {node: Extract<NoticeBodyNode, {type: 'image'}>; notice: NoticeRef}) {
    const element = useRef<HTMLSpanElement>(null)
    const [visible, setVisible] = useState(false)
    const [dataUrl, setDataUrl] = useState('')
    const [failed, setFailed] = useState(false)
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
        }, {rootMargin: '400px'})
        if (element.current) observer.observe(element.current)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        if (!visible) return
        let cancelled = false
        setDataUrl('')
        setFailed(false)
        const api = window.notices
        if (!api) { setFailed(true); return }
        void api.image({...notice, imageUrl: node.url}).then(result => {
            if (cancelled) return
            if (result.ok) setDataUrl(result.data)
            else setFailed(true)
        }).catch(() => { if (!cancelled) setFailed(true) })
        return () => { cancelled = true }
    }, [visible, notice.sourceId, notice.url, node.url, attempt])

    return <span ref={element} className="notice-inline-image" style={{width: node.width}}>
        {failed ? <span className="notice-image-error" role="status">图片加载失败
            <button type="button" className="text-button" onClick={() => setAttempt(value => value + 1)}>重试</button>
        </span> : dataUrl ? <img src={dataUrl} alt={node.alt || '通知图片'} width={node.width} height={node.height}
                               decoding="async" onError={() => setFailed(true)}/>
            : <span className="notice-image-placeholder" role="status" aria-label="正在加载图片"
                    style={node.width && node.height ? {aspectRatio: `${node.width} / ${node.height}`} : undefined}/>}
    </span>
}

export function NoticeBody({detail, notice}: {detail: NoticeDetail; notice: NoticeRef}) {
    if (!detail.body?.length) return <div className="notice-body">{detail.content}</div>
    function renderNode(node: NoticeBodyNode, key: string): ReactNode {
        if (node.type === 'text') return node.text
        if (node.type === 'image') return <NoticeImage key={key} node={node} notice={notice}/>
        const element = createElement(node.tag, {key, style: node.align ? {textAlign: node.align} : undefined,
            colSpan: node.colSpan, rowSpan: node.rowSpan},
            node.tag === 'br' || node.tag === 'hr' ? undefined : node.children.map((child, index) => renderNode(child, `${key}.${index}`)))
        return node.tag === 'table' ? <div key={key} className="notice-table-scroll">{element}</div> : element
    }
    return <div className="notice-body notice-body--rich">{detail.body.map((node, index) => renderNode(node, String(index)))}</div>
}

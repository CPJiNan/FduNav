import {useEffect, useRef, useState} from 'react'
import type {Notice, NoticeDetail, NoticeList} from '../../shared/notices'
import {Icon} from './Icon'
import './styles/notices.css'

export function NoticesPage({onLogin}: { onLogin: () => void }) {
    const [list, setList] = useState<NoticeList>({items: [], updatedAt: null, sources: []})
    const [loading, setLoading] = useState(!!window.notices)
    const [error, setError] = useState('')
    const [selected, setSelected] = useState<Notice | null>(null)
    const [detail, setDetail] = useState<NoticeDetail | null>(null)
    const [detailError, setDetailError] = useState('')
    const [detailLoading, setDetailLoading] = useState(false)
    const [query, setQuery] = useState('')
    const [sourceId, setSourceId] = useState('')
    const listVersion = useRef(0)
    const api = window.notices

    useEffect(() => {
        if (sourceId && !list.sources.some(source => source.id === sourceId && source.enabled)) setSourceId('')
    }, [list.sources, sourceId])

    useEffect(() => {
        if (!api) return
        let cancelled = false

        async function load() {
            try {
                const version = listVersion.current
                const cached = await api!.list()
                if (!cancelled && version === listVersion.current && cached.ok) setList(cached.data)
                if (cancelled || version !== listVersion.current) return
                const fresh = await api!.list(true)
                if (!cancelled && version === listVersion.current) {
                    if (fresh.ok) setList(fresh.data)
                    else setError(fresh.error)
                }
            } catch {
                if (!cancelled) setError('无法连接通知服务，请重试。')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [api])

    useEffect(() => {
        if (!selected || !api) return
        let cancelled = false
        setDetail(null);
        setDetailError('');
        setDetailLoading(true)
        void api.detail({url: selected.url, sourceId: selected.sourceId}).then(result => {
            if (cancelled) return
            if (result.ok) setDetail(result.data)
            else setDetailError(result.error)
        }).catch(() => {
            if (!cancelled) setDetailError('正文加载失败，请稍后重试。')
        })
            .finally(() => {
                if (!cancelled) setDetailLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [selected, api])

    async function refresh() {
        if (!api || loading) return
        const version = ++listVersion.current
        setLoading(true);
        setError('')
        try {
            const result = await api.list(true)
            if (version !== listVersion.current) return
            if (result.ok) setList(result.data)
            else setError(result.error)
        } catch {
            setError('无法连接通知服务，请重试。')
        } finally {
            setLoading(false)
        }
    }

    async function openSource() {
        if (!api || !selected) return
        try {
            const result = await api.openSource({url: selected.url, sourceId: selected.sourceId})
            if (!result.ok) setDetailError(result.error)
        } catch {
            setDetailError('无法打开浏览器，请稍后重试。')
        }
    }

    async function openAttachment(urlToOpen: string) {
        if (!api || !selected) return
        try {
            const result = await api.openAttachment({url: selected.url, sourceId: selected.sourceId, urlToOpen})
            if (!result.ok) setDetailError(result.error)
        } catch {
            setDetailError('无法打开附件，请稍后重试。')
        }
    }

    if (selected) return <article className="notices-page notice-detail">
        <button className="text-button" onClick={() => setSelected(null)}><Icon name="arrow"/>返回通知列表</button>
        <h1>{selected.title}</h1>
        <div className="notice-meta">
            <time dateTime={selected.published}>{selected.published}</time>
            <span>{selected.sourceName}</span>
            <button className="text-button" onClick={() => void openSource()}>查看学校原文<Icon name="external"/>
            </button>
        </div>
        {error && <p className="account-error" role="alert">{error}</p>}
        {detailLoading && <p className="notice-empty" role="status">正在读取通知正文…</p>}
        {detailError && <div className="account-error" role="alert">{detailError}
            <button className="text-button" onClick={() => setSelected({...selected})}>重试</button>
        </div>}
        {detail?.requiresLogin && <div className="notice-empty"><h2>登录后查看完整通知</h2>
            <button className="primary-button" onClick={onLogin}>登录账号</button>
        </div>}
        {detail && !detail.requiresLogin && <>
            <div className="notice-body">{detail.content}</div>
            {detail.attachmentError && <p className="account-error" role="alert">{detail.attachmentError}</p>}
            {!!detail.attachments.length && <ul className="notice-attachments" aria-label="通知附件">
                {detail.attachments.map(attachment => <li key={attachment.url}>
                    <button className="text-button" onClick={() => void openAttachment(attachment.url)}>
                        {attachment.name}<Icon name="external"/>
                    </button>
                </li>)}
            </ul>}
            {detail.imageCount > 0 && <p className="notice-updated">原文含图片，可通过“查看学校原文”查看。</p>}
        </>}
    </article>

    const items = list.items.filter(item => (!sourceId || item.sourceId === sourceId) &&
        item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())).slice(0, 200)
    const updatedAt = sourceId ? list.sources.find(source => source.id === sourceId)?.updatedAt : list.updatedAt
    return <section className="notices-page" aria-label="通知">
        <div className="notices-filter"><label htmlFor="notice-search" className="notice-search"><Icon
            name="search"/><input id="notice-search" type="search" placeholder="搜索通知标题" aria-label="搜索通知标题"
                                  value={query} onChange={event => setQuery(event.target.value)}/></label>
            <div className="notice-actions"><select className="notice-source-select" aria-label="消息来源"
                                                    value={sourceId}
                                                    onChange={event => setSourceId(event.target.value)}>
                <option value="">全部来源</option>
                {list.sources.filter(source => source.enabled).map(source => <option key={source.id}
                                                                                     value={source.id}>{source.name}</option>)}
            </select>
                <button className="secondary-button" disabled={loading || !api} onClick={() => void refresh()}><Icon
                    name="refresh"/>{loading ? '刷新中…' : '刷新通知'}</button>
            </div>
        </div>
        {!api && <p className="account-notice">请在桌面应用中查看通知。</p>}
        {error &&
            <p className="account-error" role="alert">{error}{list.items.length > 0 && ' 当前展示上次缓存的通知。'}</p>}
        {list.sources.filter(source => source.enabled && source.lastError && (!sourceId || source.id === sourceId))
            .map(source => <p className="account-error" role="alert"
                              key={source.id}>{source.name}：{source.lastError}</p>)}
        <div className="notice-list" aria-busy={loading}>
            {items.map(item => <div className="notice-row" key={`${item.sourceId}:${item.url}`}>
                <button className="notice-open" onClick={() => setSelected(item)}>
                    <time dateTime={item.published}>
                        <strong>{item.published.slice(5)}</strong><span>{item.published.slice(0, 4)}</span></time>
                    <div><h2><span className="notice-source-badge">{item.sourceName}</span>{item.title}</h2></div>
                    <Icon name="chevron"/></button>
            </div>)}
            {!items.length && <div className="notice-empty" role="status">
                <h2>{loading ? '正在获取最新通知…' : query ? '没有匹配的通知' : '暂无通知'}</h2></div>}
        </div>
        {updatedAt &&
            <p className="notice-updated">上次更新：{new Date(updatedAt).toLocaleString('zh-CN')}</p>}
    </section>
}

import {useEffect, useRef, useState} from 'react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import type {Notice, NoticeDetail, NoticeList, NoticeRelevance, NoticeSummary} from '../../shared/notices'
import {Icon} from './Icon'
import {NoticeBody} from './NoticeBody'
import {NoticeRelevanceMenu} from './NoticeRelevanceMenu'
import './styles/notices.css'

function relevanceText(relevance: NoticeRelevance | null | undefined) {
    return relevance === 'related' ? '[@与我有关]' : relevance === 'maybe' ? '[@可能有关]' : ''
}

export function NoticesPage({onLogin, noticeToOpen, onNoticeOpened}: {
    onLogin: () => void; noticeToOpen?: Notice | null; onNoticeOpened?: () => void
}) {
    const [list, setList] = useState<NoticeList>({items: [], updatedAt: null, sources: []})
    const [loading, setLoading] = useState(!!window.notices)
    const [error, setError] = useState('')
    const [selected, setSelected] = useState<Notice | null>(null)
    const [detail, setDetail] = useState<NoticeDetail | null>(null)
    const [detailError, setDetailError] = useState('')
    const [detailLoading, setDetailLoading] = useState(false)
    const [summary, setSummary] = useState<NoticeSummary | null>(null)
    const [summaryLoading, setSummaryLoading] = useState(false)
    const [summaryError, setSummaryError] = useState('')
    const [summaryOpen, setSummaryOpen] = useState(false)
    const relevanceChoices = useRef(new Map<string, NoticeRelevance | null>())
    const [query, setQuery] = useState('')
    const [sourceId, setSourceId] = useState('')
    const [fromDate, setFromDate] = useState('')
    const [toDate, setToDate] = useState('')
    const [filterOpen, setFilterOpen] = useState(false)
    const [multiSelect, setMultiSelect] = useState(false)
    const [checked, setChecked] = useState<string[]>([])
    const [enqueueing, setEnqueueing] = useState(false)
    const noticeKey = (notice: Notice) => JSON.stringify([notice.sourceId, notice.url])
    const effectiveRelevance = (notice: Notice, predicted: NoticeRelevance | null | undefined) =>
        relevanceChoices.current.has(noticeKey(notice)) ? relevanceChoices.current.get(noticeKey(notice)) : predicted
    const listVersion = useRef(0)
    const summaryRequest = useRef(0)
    const api = window.notices

    useEffect(() => {
        if (!noticeToOpen) return
        setSelected(noticeToOpen)
        onNoticeOpened?.()
    }, [noticeToOpen, onNoticeOpened])

    useEffect(() => {
        if (!api) return
        let active = true
        let version = 0
        let completed = ''
        const unsubscribe = api.onSummaryQueueChanged(tasks => {
            const next = tasks.filter(task => task.status === 'completed').map(task => task.id).join(',')
            if (next === completed) return
            completed = next
            const request = ++version
            void api.list().then(result => {
                if (active && request === version && result.ok) setList(result.data)
            }).catch(() => {
            })
        })
        return () => {
            active = false;
            unsubscribe()
        }
    }, [api])

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
        summaryRequest.current++
        setDetail(null);
        setDetailError('');
        setDetailLoading(true)
        setSummary(null);
        setSummaryError('');
        setSummaryLoading(false);
        setSummaryOpen(false)
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
            summaryRequest.current++
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

    async function summarize(force = false) {
        if (!api || !selected) return
        if (!force && summaryOpen) {
            setSummaryOpen(false)
            return
        }
        setSummaryOpen(true)
        if (summaryLoading) return
        if (!force && summary) {
            setSummaryOpen(true)
            return
        }
        setSummaryOpen(true)
        const request = ++summaryRequest.current
        setSummaryLoading(true)
        setSummaryError('')
        try {
            const result = await api.summarize({url: selected.url, sourceId: selected.sourceId}, force)
            if (request !== summaryRequest.current) return
            if (result.ok) {
                setSummary(result.data)
                setList(current => ({
                    ...current,
                    items: current.items.map(item => item.sourceId === selected.sourceId && item.url === selected.url
                        ? {...item, relevance: result.data.relevance} : item)
                }))
            } else setSummaryError(result.error)
        } catch {
            if (request === summaryRequest.current) setSummaryError('无法生成摘要，请稍后重试。')
        } finally {
            if (request === summaryRequest.current) setSummaryLoading(false)
        }
    }

    async function enqueueSelected() {
        if (!api || enqueueing) return
        const notices = list.items.filter(item => checked.includes(noticeKey(item)))
        if (!notices.length) return
        setEnqueueing(true)
        setError('')
        try {
            const result = await api.enqueueSummaries(notices.map(({sourceId, url}) => ({sourceId, url})))
            if (result.ok) {
                setChecked([])
            } else setError(result.error)
        } catch {
            setError('无法加入摘要队列，请重试。')
        } finally {
            setEnqueueing(false)
        }
    }

    function updateRelevance(value: NoticeRelevance | null) {
        if (!selected) return
        relevanceChoices.current.set(noticeKey(selected), value)
        setList(current => ({
            ...current, items: current.items.map(item => noticeKey(item) === noticeKey(selected)
                ? {...item, relevance: value} : item)
        }))
        setSummary(current => current ? {...current, relevance: value} : current)
    }

    const listedNotice = selected && list.items.find(item => item.sourceId === selected.sourceId && item.url === selected.url)
    const selectedRelevance = listedNotice ? listedNotice.relevance : selected?.relevance
    const relevance = selected ? effectiveRelevance(selected, summary ? summary.relevance : selectedRelevance) : null
    if (selected) return <article className="notices-page notice-detail">
        <button type="button" className="text-button" onClick={() => setSelected(null)}><Icon name="arrow"/>返回通知列表
        </button>
        <h1>{relevance && <span
            className={`notice-relevance notice-relevance--${relevance}`}>{relevanceText(relevance)}</span>}{selected.title}</h1>
        <div className="notice-meta">
            <time dateTime={selected.published}>{selected.published}</time>
            <span>{selected.sourceName}</span>
            <NoticeRelevanceMenu key={noticeKey(selected)} notice={selected} relevance={relevance}
                                 onChanged={updateRelevance}/>
            <button type="button" className="text-button" onClick={() => void openSource()}>查看原文<Icon
                name="external"/>
            </button>
            <button type="button" className="icon-button notice-summary-button" aria-label="AI 摘要" title="AI 摘要"
                    aria-expanded={summaryOpen} aria-controls="notice-summary"
                    disabled={!api}
                    onClick={() => void summarize()}><Icon name="sparkles"/></button>
        </div>
        {summaryOpen && <section id="notice-summary" className="notice-summary" aria-label="AI 摘要">
            <div className="notice-summary-head"><Icon name="sparkles"/><strong>AI 摘要</strong>
                <div className="notice-summary-actions">
                    <button type="button" className="text-button" disabled={summaryLoading}
                            onClick={() => void summarize(true)}>重新摘要
                    </button>
                    <button type="button" className="text-button" onClick={() => setSummaryOpen(false)}>收起</button>
                </div>
            </div>
            {summaryLoading && <p className="notice-summary-status" role="status">正在生成摘要…</p>}
            {summaryError && <p className="account-error" role="alert">{summaryError}</p>}
            {summary && <div className="notice-summary-text">
                <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}
                          components={{a: ({children}) => <span>{children}</span>}}>{summary.content}</Markdown>
            </div>}
        </section>}
        {error && <p className="account-error" role="alert">{error}</p>}
        {detailLoading && <p className="notice-empty" role="status">正在读取通知正文…</p>}
        {detailError && <div className="account-error" role="alert">{detailError}
            <button type="button" className="text-button" onClick={() => setSelected({...selected})}>重试</button>
        </div>}
        {detail?.requiresLogin && <div className="notice-empty"><h2>登录后查看完整通知</h2>
            <button type="button" className="primary-button" onClick={onLogin}>登录账号</button>
        </div>}
        {detail && !detail.requiresLogin && <>
            <NoticeBody key={`${selected.sourceId}:${selected.url}`} detail={detail} notice={selected}/>
            {detail.attachmentError && <p className="account-error" role="alert">{detail.attachmentError}</p>}
            {!!detail.attachments.length && <ul className="notice-attachments" aria-label="通知附件">
                {detail.attachments.map(attachment => <li key={attachment.url}>
                    <button type="button" className="text-button" onClick={() => void openAttachment(attachment.url)}>
                        {attachment.name}<Icon name="external"/>
                    </button>
                </li>)}
            </ul>}
        </>}
    </article>

    function resetFilters() {
        setSourceId('')
        setFromDate('')
        setToDate('')
    }

    const filtersActive = !!sourceId || !!fromDate || !!toDate
    const items = list.items.filter(item => (!sourceId || item.sourceId === sourceId) &&
        (!fromDate || item.published >= fromDate) && (!toDate || item.published <= toDate) &&
        item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())).slice(0, 200)
    const updatedAt = sourceId ? list.sources.find(source => source.id === sourceId)?.updatedAt : list.updatedAt
    return <section className="notices-page" aria-label="通知">
        <div className="notices-filter"><label htmlFor="notice-search" className="notice-search"><Icon
            name="search"/><input id="notice-search" type="search" placeholder="搜索通知标题" aria-label="搜索通知标题"
                                  value={query} onChange={event => setQuery(event.target.value)}/></label>
            <div className="notice-actions">
                <button type="button" className={`icon-button ${filtersActive ? 'is-active' : ''}`}
                        aria-label="筛选通知"
                        title="筛选通知" aria-expanded={filterOpen} aria-controls="notice-filter-settings"
                        onClick={() => setFilterOpen(value => !value)}><Icon name="filter"/></button>
                <button type="button" className={`icon-button ${multiSelect ? 'is-active' : ''}`}
                        aria-label="AI 摘要" title="AI 摘要" aria-pressed={multiSelect}
                        onClick={() => {
                            setMultiSelect(value => !value);
                            setChecked([])
                        }}><Icon name="sparkles"/></button>
                <button type="button" className="icon-button" aria-label={loading ? '正在刷新通知' : '刷新通知'}
                        title={loading ? '正在刷新通知' : '刷新通知'} disabled={loading || !api}
                        onClick={() => void refresh()}><Icon name="refresh"/></button>
            </div>
        </div>
        {filterOpen && <div id="notice-filter-settings" className="notice-settings">
            <div className="notice-filter-field">
                <label htmlFor="notice-source-filter">来源</label>
                <select id="notice-source-filter" aria-label="消息来源" value={sourceId}
                        onChange={event => setSourceId(event.target.value)}>
                    <option value="">全部来源</option>
                    {list.sources.filter(source => source.enabled).map(source => <option key={source.id}
                                                                                         value={source.id}>{source.name}</option>)}
                </select>
            </div>
            <div className="notice-filter-field">
                <span className="notice-filter-label">发布时间</span>
                <div className="notice-date-range">
                    <input type="date" aria-label="开始日期" value={fromDate} max={toDate || undefined}
                           onChange={event => setFromDate(event.target.value)}/>
                    <span>至</span>
                    <input type="date" aria-label="结束日期" value={toDate} min={fromDate || undefined}
                           onChange={event => setToDate(event.target.value)}/>
                </div>
            </div>
            <button type="button" className="text-button" disabled={!filtersActive}
                    onClick={resetFilters}>重置筛选
            </button>
        </div>}
        {multiSelect && <div className="notice-batch-actions">
            <label><input type="checkbox" disabled={!items.length}
                          checked={items.length > 0 && items.every(item => checked.includes(noticeKey(item)))}
                          onChange={event => setChecked(event.target.checked ? items.map(noticeKey) : [])}/>全选</label>
            <span>已选 {list.items.filter(item => checked.includes(noticeKey(item))).length} 条</span>
            <button type="button" className="text-button" disabled={!api || !checked.length || enqueueing}
                    onClick={() => void enqueueSelected()}>{enqueueing ? '加入中…' : '加入摘要队列'}</button>
        </div>}
        {!api && <p className="account-notice">请在桌面应用中查看通知。</p>}
        {error &&
            <p className="account-error" role="alert">{error}{list.items.length > 0 && ' 当前展示上次缓存的通知。'}</p>}
        {list.sources.filter(source => source.enabled && source.lastError && (!sourceId || source.id === sourceId))
            .map(source => <p className="account-error" role="alert"
                              key={source.id}>{source.name}：{source.lastError}</p>)}
        <div className="notice-list" aria-busy={loading}>
            {items.map(item => <div className={`notice-row ${multiSelect ? 'notice-row--selectable' : ''}`}
                                    key={`${item.sourceId}:${item.url}`}>
                {multiSelect && <input type="checkbox" aria-label={`选择通知：${item.title}`}
                                       checked={checked.includes(noticeKey(item))}
                                       onChange={event => setChecked(value =>
                                           event.target.checked ? [...value, noticeKey(item)] : value.filter(key => key !== noticeKey(item)))}/>}
                <button type="button" className="notice-open" onClick={() => setSelected(item)}>
                    <time dateTime={item.published}>
                        <strong>{item.published.slice(5)}</strong><span>{item.published.slice(0, 4)}</span></time>
                    <div><h2><span
                        className="notice-source-badge">{item.sourceName}</span>{effectiveRelevance(item, item.relevance) &&
                        <span
                            className={`notice-relevance notice-relevance--${effectiveRelevance(item, item.relevance)}`}>{relevanceText(effectiveRelevance(item, item.relevance))}</span>}{item.title}
                    </h2>
                    </div>
                    <Icon name="chevron"/></button>
            </div>)}
            {!items.length && <div className="notice-empty" role="status">
                <h2>{loading ? '正在获取最新通知…' : query || filtersActive ? '没有匹配的通知' : '暂无通知'}</h2></div>}
        </div>
        {updatedAt &&
            <p className="notice-updated">上次更新：{new Date(updatedAt).toLocaleString('zh-CN')}</p>}
    </section>
}

import {useCallback, useEffect, useRef, useState} from 'react'
import type {CampusCardBalance} from '../../shared/campus-card'
import {Icon} from './Icon'

export function CampusCardWidget({refreshVersion}: {refreshVersion: number}) {
    const [data, setData] = useState<CampusCardBalance | null>(null)
    const [busy, setBusy] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState('')
    const [openingRecords, setOpeningRecords] = useState(false)
    const [recordsError, setRecordsError] = useState('')
    const opening = useRef(false)
    const mounted = useRef(false)
    const pending = useRef(false)
    const queuedRefresh = useRef(false)
    const previousVersion = useRef(refreshVersion)
    const api = window.campusCard

    async function openRecords() {
        if (!api || opening.current) return
        opening.current = true
        setOpeningRecords(true)
        setRecordsError('')
        try {
            const result = await api.openRecords()
            if (mounted.current && !result.ok) setRecordsError(result.error)
        } catch {
            if (mounted.current) setRecordsError('无法打开消费记录，请重试。')
        } finally {
            opening.current = false
            if (mounted.current) setOpeningRecords(false)
        }
    }

    const load = useCallback(async function load(force = false) {
        if (pending.current) {
            if (force) { queuedRefresh.current = true; setRefreshing(true) }
            return
        }
        if (!api) {
            setBusy(false)
            setError('请在桌面应用中查询校园卡余额。')
            return
        }
        pending.current = true
        setBusy(true)
        setRefreshing(force)
        setError('')
        try {
            const result = await api.balance(force)
            if (!mounted.current) return
            if (result.ok) setData(result.data)
            else setError(result.error)
        } catch {
            if (mounted.current) setError('无法连接校园卡服务，请刷新重试。')
        } finally {
            pending.current = false
            if (mounted.current) {
                setBusy(false)
                if (queuedRefresh.current) {
                    queuedRefresh.current = false
                    void load(true)
                } else setRefreshing(false)
            }
        }
    }, [api])

    useEffect(() => {
        mounted.current = true
        void load()
        return () => {
            mounted.current = false
        }
    }, [load])

    useEffect(() => {
        if (previousVersion.current === refreshVersion) return
        previousVersion.current = refreshVersion
        void load(true)
    }, [refreshVersion, load])

    return <div aria-busy={busy}>
        <div className="dashboard-widget-heading">
            <h2><Icon name="card"/>校园卡余额</h2>
            <button type="button" className="dashboard-card-refresh" disabled={refreshing || !api} onClick={() => void load(true)} aria-label="刷新校园卡余额">
                <Icon name="refresh"/>{refreshing ? '查询中…' : '刷新'}
            </button>
        </div>
        <div className="dashboard-card-balance" aria-label={data ? `校园卡余额 ${data.balance} 元` : '校园卡余额暂不可用'}>
            {data && <span aria-hidden="true">¥</span>}<strong aria-hidden="true">{data?.balance ?? '—'}</strong>
        </div>
        {busy && <p className="dashboard-widget-caption" role="status">正在查询校园卡余额…</p>}
        {data && <p className="dashboard-widget-caption">上次查询：<time dateTime={data.updatedAt}>
            {new Date(data.updatedAt).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
        </time></p>}
        {error && <p className="dashboard-error" role="alert">{error}</p>}
        {recordsError && <p className="dashboard-error" role="alert">{recordsError}</p>}
        <button type="button" className="dashboard-card-records" disabled={openingRecords || !api}
                aria-label="查看校园卡消费记录" aria-busy={openingRecords} onClick={() => void openRecords()}>
            {openingRecords ? '正在打开消费记录…' : '查看消费记录'}<Icon name="chevron"/>
        </button>
    </div>
}

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type {ChatSummaryRequest} from '../../shared/chat'
import {Icon} from './Icon'

const labels = {pending: '等待允许', generating: '正在生成', completed: '已完成', rejected: '已拒绝', failed: '生成失败'}

export function ChatSummaryRequestCard({request, disabled, onDecide, onOpen}: {
    request: ChatSummaryRequest; disabled: boolean; onDecide: (allow: boolean) => void; onOpen: () => void
}) {
    const actionable = request.status === 'pending' || request.status === 'failed'
    return <section className="chat-summary-request" aria-label={`AI 摘要请求：${request.notice.title}`}>
        <header><strong><Icon name="sparkles"/>AI 通知摘要</strong>
            <span role="status">{labels[request.status]}</span></header>
        <button type="button" className="chat-summary-notice" onClick={onOpen}>
            <strong>{request.notice.title}</strong>
            <small>{request.notice.sourceName} · {request.notice.published}</small>
        </button>
        {actionable &&
            <div className="chat-summary-actions">
                <button type="button" className="primary-button" disabled={disabled} onClick={() => onDecide(true)}>
                    {request.status === 'failed' ? '允许重试' : '允许'}
                </button>
                <button type="button" className="secondary-button" disabled={disabled} onClick={() => onDecide(false)}>拒绝</button>
            </div>
        }
        {request.status === 'rejected' && <p>未生成摘要。</p>}
        {request.error && <p className="chat-error" role="alert">{request.error}</p>}
        {request.status === 'completed' && request.summary && <>
            {request.summary.cached && <p>已读取已有摘要。</p>}
            <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{a: ({children}) => <span>{children}</span>, img: ({alt}) => <span>{alt}</span>}}>
                {request.summary.content}
            </Markdown></div>
        </>}
    </section>
}

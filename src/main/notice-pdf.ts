import type {NoticeDetail} from '../shared/notices'
import {requestSourcePdf} from './source-fetch.ts'

export async function extractPdfText(data: Uint8Array): Promise<string> {
    const {getDocument, VerbosityLevel} = await import('pdfjs-dist/legacy/build/pdf.mjs')

    const task = getDocument({data, useSystemFonts: true, verbosity: VerbosityLevel.ERRORS})
    try {
        const document = await task.promise
        if (document.numPages > 100) throw new Error('PDF 页数过多。')
        const pages: string[] = []
        let length = 0
        for (let number = 1; number <= document.numPages; number++) {
            const page = await document.getPage(number)
            const content = await page.getTextContent()
            const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '').join('').trim()
            length += text.length
            if (length > 300_000) throw new Error('PDF 正文过长。')
            pages.push(text)
            page.cleanup()
        }
        return pages.join('\n\n').trim()
    } finally {
        await task.destroy()
    }
}

export async function readNoticePdfs(detail: NoticeDetail): Promise<NoticeDetail> {
    const contents = [detail.content]
    let failed = detail.attachments.length > 3
    for (const attachment of detail.attachments.slice(0, 3)) {
        try {
            const text = await extractPdfText(await requestSourcePdf(attachment.url))
            if (text) contents.push(detail.attachments.length > 1 ? `${attachment.name}\n${text}` : text)
            else failed = true
        } catch {
            failed = true
        }
    }
    return {
        ...detail, content: contents.filter(Boolean).join('\n\n'),
        ...(detail.body ? {body: [...detail.body, ...contents.slice(1).map(text => ({
            type: 'element' as const, tag: 'pre' as const, children: [{type: 'text' as const, text}],
        }))]} : {}),
        ...(failed ? {attachmentError: '部分 PDF 正文未能提取，请打开附件查看。'} : {})
    }
}

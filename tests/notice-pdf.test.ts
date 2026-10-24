import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extractPdfText} from '../src/main/notice-pdf.ts'

test('PDF extraction keeps adjacent text fragments together and preserves line breaks', async () => {
    const stream = 'BT /F1 12 Tf 20 150 Td (20) Tj (26) Tj 0 -20 Td (Placement exam) Tj ET'
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ]
    let pdf = '%PDF-1.4\n'
    const offsets = [0]
    objects.forEach((object, index) => {
        offsets.push(pdf.length)
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    })
    const start = pdf.length
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
    pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
    const text = await extractPdfText(new Uint8Array(Buffer.from(pdf)))
    assert.match(text, /2026\nPlacement exam/)
    await assert.rejects(extractPdfText(new Uint8Array(Buffer.from('invalid PDF'))))
})

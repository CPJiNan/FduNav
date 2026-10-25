import {createHash} from 'node:crypto'
import type {ChatMessage} from './llm-connection'
import type {Notice} from '../shared/notices'
import {
    educationLevelOptions,
    genderOptions,
    identityOptions,
    type MessagePreferences
} from '../shared/message-preferences.ts'

export function summaryMessages(notice: Notice, content: string, preferences: MessagePreferences,
                                prompt: string): ChatMessage[] {
    return [
        {role: 'system', content: prompt},
        {
            role: 'user',
            content: JSON.stringify({
                messagePreferences: {
                    身份: identityOptions.find(option => option.value === preferences.identity)?.label ?? '未填写',
                    性别: genderOptions.find(option => option.value === preferences.gender)?.label ?? '未填写',
                    院系: preferences.department || '未填写',
                    学历阶段: educationLevelOptions.find(option => option.value === preferences.educationLevel)?.label ?? '未填写',
                    年级: preferences.grade === null ? '未填写' : `${preferences.grade}级`,
                    专业: preferences.major || '未填写',
                    校区: preferences.campus || '未填写',
                },
                notice: {
                    title: notice.title,
                    source: notice.sourceName,
                    published: notice.published,
                    content: content.slice(0, 24_000)
                }
            })
        }
    ]
}

export function summaryContentHash(messages: ChatMessage[], baseUrl: string): string {
    return createHash('sha256').update(JSON.stringify({messages, baseUrl})).digest('hex')
}

export function summaryCacheKey(notice: Notice, preferences: MessagePreferences,
                                prompt: string, baseUrl: string): string {
    return createHash('sha256').update(JSON.stringify({
        notice: {
            sourceId: notice.sourceId,
            url: notice.url,
            title: notice.title,
            published: notice.published
        },
        messagePreferences: preferences,
        prompt,
        baseUrl
    })).digest('hex')
}

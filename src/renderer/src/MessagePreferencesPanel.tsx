import {type FormEvent, useEffect, useRef, useState} from 'react'
import {
    campusOptions, departments, educationLevelOptions, emptyMessagePreferences, genderOptions, identityOptions,
    normalizeTags, preferenceLimits, splitTagInput,
    validateMessagePreferences, validateRequiredMessagePreferences, type MessagePreferences,
} from '../../shared/message-preferences'
import {Icon} from './Icon'
import './styles/message-preferences.css'

type Draft = MessagePreferences
type FieldError = {field: keyof MessagePreferences; error: string}
const profileSelects = [
    {field: 'identity', label: '身份', options: identityOptions},
    {field: 'gender', label: '性别', options: genderOptions},
    {field: 'department', label: '院系', options: departments.map(value => ({value, label: value}))},
    {field: 'educationLevel', label: '学历阶段', options: educationLevelOptions},
] as const

export function MessagePreferencesPanel({requiredProfile = false, onChange, onSaved}: {
    requiredProfile?: boolean
    onChange?: (value: MessagePreferences) => void
    onSaved?: (value: MessagePreferences) => void
}) {
    const [draft, setDraft] = useState(emptyMessagePreferences)
    const [saved, setSaved] = useState<Draft | null>(null)
    const [pendingTags, setPendingTags] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [loadError, setLoadError] = useState('')
    const [saveError, setSaveError] = useState('')
    const [fieldError, setFieldError] = useState<FieldError | null>(null)
    const [savedMessage, setSavedMessage] = useState('')
    const [retry, setRetry] = useState(0)
    const [tagToDelete, setTagToDelete] = useState<string | null>(null)
    const tagInput = useRef<HTMLInputElement>(null)
    const deleteDialog = useRef<HTMLDialogElement>(null)
    const cancelDelete = useRef<HTMLButtonElement>(null)
    const form = useRef<HTMLFormElement>(null)
    const api = window.messagePreferences
    const dirty = saved !== null && (JSON.stringify(draft) !== JSON.stringify(saved) || !!pendingTags.trim())
    const currentYear = new Date().getFullYear()
    const grades = [...new Set([
        ...Array.from({length: 21}, (_, index) => currentYear + 1 - index),
        ...(draft.grade === null ? [] : [draft.grade]),
    ])].sort((a, b) => b - a)

    useEffect(() => {
        let active = true
        setLoading(true)
        setLoadError('')
        if (!api) {
            setLoading(false)
            return
        }
        void api.get().then(result => {
            if (!active) return
            if (result.ok) {
                const value = result.data
                setDraft(value)
                setSaved(value)
                onChange?.(value)
            } else setLoadError(result.error)
        }).catch(() => {
            if (active) setLoadError('无法连接消息偏好服务，请重试或重启应用。')
        }).finally(() => {
            if (active) setLoading(false)
        })
        return () => { active = false }
    }, [api, retry, onChange])

    useEffect(() => {
        const dialog = deleteDialog.current
        if (tagToDelete === null || !dialog) return
        dialog.showModal()
        cancelDelete.current?.focus()
        return () => { if (dialog.open) dialog.close() }
    }, [tagToDelete])

    function closeDeleteDialog() {
        deleteDialog.current?.close()
        setTagToDelete(null)
    }

    function confirmDelete() {
        if (tagToDelete === null) return
        change('tags', draft.tags.filter(tag => tag !== tagToDelete))
        closeDeleteDialog()
        tagInput.current?.focus()
    }

    function change<K extends keyof Draft>(field: K, value: Draft[K]) {
        setDraft(current => ({...current, [field]: value}))
        setFieldError(current => current?.field === field ? null : current)
        setSaveError('')
        setSavedMessage('')
    }

    function addTags() {
        if (!pendingTags.trim()) return
        const result = normalizeTags([...draft.tags, ...splitTagInput(pendingTags)])
        if (!result.ok) {
            setFieldError({field: 'tags', error: result.error})
        } else {
            change('tags', result.data)
            setPendingTags('')
        }
        tagInput.current?.focus()
    }

    async function save(event: FormEvent) {
        event.preventDefault()
        if (!api || loading || saving || !saved) return
        const result = (requiredProfile ? validateRequiredMessagePreferences : validateMessagePreferences)({
            ...draft,
            tags: [...draft.tags, ...splitTagInput(pendingTags)],
        })
        setSaveError('')
        setSavedMessage('')
        if (!result.ok) {
            setFieldError(result)
            form.current?.querySelector<HTMLElement>(`#preference-${result.field}`)?.focus()
            return
        }
        setFieldError(null)
        setSaving(true)
        try {
            const response = await api.save(result.data)
            if (response.ok) {
                const value = response.data
                setDraft(value)
                setSaved(value)
                setPendingTags('')
                setSavedMessage('已保存')
                onChange?.(value)
                onSaved?.(value)
            } else setSaveError(response.error)
        } catch {
            setSaveError('保存失败，输入内容已保留，请重试。')
        } finally {
            setSaving(false)
        }
    }

    const errorFor = (field: keyof MessagePreferences) => fieldError?.field === field
        ? <p className="preference-error" id={`preference-${field}-error`} role="alert">{fieldError.error}</p> : null

    return <div className="message-preferences">
        {!api && <p className="account-error" role="alert">消息偏好服务不可用。</p>}
        {loading && <p className="preference-feedback" role="status">正在读取消息偏好…</p>}
        {loadError && <div className="preference-load-error">
            <p className="account-error" role="alert">{loadError}</p>
            <button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>重新读取</button>
        </div>}
        <form ref={form} onSubmit={save} noValidate aria-busy={loading || saving}>
            <fieldset className="preference-fields preference-profile" aria-label="个人资料" disabled={!api || loading || saving || !saved}>
                <div className="preference-grid">
                    {profileSelects.map(({field, label, options}) => <div className="preference-field" key={field}>
                        <label htmlFor={`preference-${field}`}>{label}</label>
                        <select id={`preference-${field}`} value={draft[field]} required={requiredProfile}
                                aria-invalid={fieldError?.field === field}
                                aria-describedby={fieldError?.field === field ? `preference-${field}-error` : undefined}
                                onChange={event => change(field, event.target.value as Draft[typeof field])}>
                            <option value="" aria-label="未选择"/>
                            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        {errorFor(field)}
                    </div>)}
                    <div className="preference-field">
                        <label htmlFor="preference-grade">年级</label>
                        <select id="preference-grade" value={draft.grade ?? ''} required={requiredProfile}
                                aria-invalid={fieldError?.field === 'grade'}
                                aria-describedby={fieldError?.field === 'grade' ? 'preference-grade-error' : undefined}
                                onChange={event => change('grade', event.target.value === '' ? null : Number(event.target.value))}>
                            <option value="" aria-label="未选择"/>
                            {grades.map(year => <option key={year} value={year}>{year}级</option>)}
                        </select>
                        {errorFor('grade')}
                    </div>
                    <div className="preference-field">
                        <label htmlFor="preference-major">专业</label>
                        <input id="preference-major" value={draft.major} required={requiredProfile}
                               maxLength={preferenceLimits.majorLength}
                               aria-invalid={fieldError?.field === 'major'}
                               aria-describedby={fieldError?.field === 'major' ? 'preference-major-error' : undefined}
                               onChange={event => change('major', event.target.value)}/>
                        {errorFor('major')}
                    </div>
                    <div className="preference-field">
                        <label htmlFor="preference-campus">校区</label>
                        <select id="preference-campus" value={draft.campus} required={requiredProfile}
                                aria-invalid={fieldError?.field === 'campus'}
                                aria-describedby={fieldError?.field === 'campus' ? 'preference-campus-error' : undefined}
                                onChange={event => change('campus', event.target.value as Draft['campus'])}>
                            <option value="" aria-label="未选择"/>
                            {campusOptions.map(campus => <option key={campus} value={campus}>{campus}</option>)}
                        </select>
                        {errorFor('campus')}
                    </div>
                </div>
            </fieldset>

            <fieldset className="preference-fields preference-tags" aria-label="标签云" disabled={!api || loading || saving || !saved}>
                <label className="preference-tags-label" htmlFor="preference-tags">标签云</label>
                <div className="preference-tag-editor" data-invalid={fieldError?.field === 'tags' || undefined}>
                    {draft.tags.length > 0 &&
                    <ul aria-label="已添加的标签">
                        {draft.tags.map(tag => <li key={tag}>
                            <span>{tag}</span>
                            <button type="button" aria-label={`删除标签 ${tag}`} title={`删除标签 ${tag}`}
                                    onClick={() => setTagToDelete(tag)}><Icon name="close"/></button>
                        </li>)}
                    </ul>}
                        <input ref={tagInput} id="preference-tags" value={pendingTags} maxLength={4096} autoComplete="off"
                                  aria-invalid={fieldError?.field === 'tags'}
                                  aria-describedby={fieldError?.field === 'tags' ? 'preference-tags-error' : undefined}
                                  onChange={event => {
                                      setPendingTags(event.target.value)
                                      setFieldError(current => current?.field === 'tags' ? null : current)
                                      setSavedMessage('')
                                      setSaveError('')
                                  }}
                                  onKeyDown={event => {
                                      if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                                          event.preventDefault()
                                          addTags()
                                      }
                                  }}/>
                </div>
                {errorFor('tags')}
            </fieldset>
            <div className="preference-save-row">
                <button type="submit" className="primary-button" disabled={!api || loading || saving || (!dirty && !(requiredProfile && !validateRequiredMessagePreferences(saved).ok))}>
                    {saving ? '正在保存…' : '保存偏好'}
                </button>
                <p className="preference-feedback" role="status">{saving || dirty ? '' : savedMessage}</p>
            </div>
            {saveError && <p className="account-error" role="alert">{saveError}</p>}
        </form>
        <dialog ref={deleteDialog} className="tag-delete-dialog" aria-labelledby="tag-delete-question"
                onCancel={event => { event.preventDefault(); closeDeleteDialog() }}
                onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}>
            <p id="tag-delete-question">删除标签“{tagToDelete}”？</p>
            <div className="tag-delete-actions">
                <button ref={cancelDelete} type="button" className="secondary-button" onClick={closeDeleteDialog}>取消</button>
                <button type="button" className="primary-button tag-delete-confirm" onClick={confirmDelete}>删除</button>
            </div>
        </dialog>
    </div>
}

import {type FormEvent, useEffect, useRef, useState} from 'react'
import {
    campusOptions,
    departments,
    educationLevelOptions,
    emptyMessagePreferences,
    genderOptions,
    identityOptions,
    type MessagePreferences,
    preferenceLimits,
    validateMessagePreferences,
    validateRequiredMessagePreferences,
} from '../../shared/message-preferences'
import './styles/message-preferences.css'

type Draft = MessagePreferences
type FieldError = { field: keyof MessagePreferences; error: string }
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
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [loadError, setLoadError] = useState('')
    const [saveError, setSaveError] = useState('')
    const [fieldError, setFieldError] = useState<FieldError | null>(null)
    const [retry, setRetry] = useState(0)
    const inFlight = useRef(false)
    const form = useRef<HTMLFormElement>(null)
    const api = window.messagePreferences
    const validated = validateMessagePreferences(draft)
    const dirty = saved !== null && (!validated.ok || JSON.stringify(validated.data) !== JSON.stringify(saved))
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
        return () => {
            active = false
        }
    }, [api, retry, onChange])

    function change<K extends keyof Draft>(field: K, value: Draft[K]) {
        setDraft(current => ({...current, [field]: value}))
        setFieldError(current => current?.field === field ? null : current)
        setSaveError('')
    }

    async function save(event: FormEvent) {
        event.preventDefault()
        if (!api || loading || !saved || inFlight.current) return
        const result = (requiredProfile ? validateRequiredMessagePreferences : validateMessagePreferences)(draft)
        setSaveError('')
        if (!result.ok) {
            setFieldError(result)
            form.current?.querySelector<HTMLElement>(`#preference-${result.field}`)?.focus()
            return
        }
        setFieldError(null)
        inFlight.current = true
        setSaving(true)
        try {
            const response = await api.save(result.data)
            if (response.ok) {
                const value = response.data
                setDraft(value)
                setSaved(value)
                onChange?.(value)
                onSaved?.(value)
            } else setSaveError(response.error)
        } catch {
            setSaveError('保存失败，输入内容已保留，请重试。')
        } finally {
            inFlight.current = false
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
            <button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>重新读取
            </button>
        </div>}
        <form ref={form} onSubmit={save} noValidate aria-busy={loading || saving}>
            <fieldset className="preference-fields preference-profile" aria-label="消息偏好"
                      disabled={!api || loading || saving || !saved}>
                <div className="preference-grid">
                    {profileSelects.map(({field, label, options}) => <div className="preference-field" key={field}>
                        <label htmlFor={`preference-${field}`}>{label}<span className="preference-required" aria-hidden="true">*</span></label>
                        <select id={`preference-${field}`} value={draft[field]} required={requiredProfile}
                                aria-invalid={fieldError?.field === field}
                                aria-describedby={fieldError?.field === field ? `preference-${field}-error` : undefined}
                                onChange={event => change(field, event.target.value as Draft[typeof field])}>
                            <option value="" aria-label="未选择"/>
                            {options.map(option => <option key={option.value}
                                                           value={option.value}>{option.label}</option>)}
                        </select>
                        {errorFor(field)}
                    </div>)}
                    <div className="preference-field">
                        <label htmlFor="preference-grade">年级<span className="preference-required" aria-hidden="true">*</span></label>
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
                        <label htmlFor="preference-major">专业<span className="preference-required" aria-hidden="true">*</span></label>
                        <input id="preference-major" value={draft.major} required={requiredProfile}
                               maxLength={preferenceLimits.majorLength}
                               aria-invalid={fieldError?.field === 'major'}
                               aria-describedby={fieldError?.field === 'major' ? 'preference-major-error' : undefined}
                               onChange={event => change('major', event.target.value)}/>
                        {errorFor('major')}
                    </div>
                    <div className="preference-field">
                        <label htmlFor="preference-campus">校区<span className="preference-required" aria-hidden="true">*</span></label>
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
            <div className="preference-save-row">
                <button type="submit" className="primary-button"
                        disabled={!api || loading || saving || !saved || (!dirty && !(requiredProfile && !validateRequiredMessagePreferences(saved).ok))}>
                    {saving ? '正在保存…' : '保存偏好'}
                </button>
            </div>
            {saveError && <p className="account-error" role="alert">{saveError}</p>}
        </form>
    </div>
}

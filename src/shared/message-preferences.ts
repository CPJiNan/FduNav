import type {Result} from './accounts'

export const genderOptions = [
    {value: 'male', label: '男'},
    {value: 'female', label: '女'},
    {value: 'other', label: '其他'},
] as const

export const identityOptions = [
    {value: 'student', label: '学生'},
    {value: 'staff', label: '教职员工'},
] as const

export const educationLevelOptions = [
    {value: 'undergraduate', label: '本科生'},
    {value: 'master', label: '硕士研究生'},
    {value: 'doctoral', label: '博士研究生'},
] as const

export const campusOptions = ['邯郸校区', '江湾校区', '枫林校区', '张江校区'] as const

export const departments = [
    '马克思主义学院',
    '中国语言文学系',
    '外国语言文学学院',
    '新闻学院',
    '历史学系',
    '哲学学院',
    '国际关系与公共事务学院',
    '数学科学学院',
    '物理学系',
    '化学系',
    '法学院',
    '核科学与技术系',
    '高分子科学系',
    '旅游学系',
    '文物与博物馆学系',
    '国际金融学院',
    '经济学院',
    '管理学院',
    '生命科学学院',
    '社会发展与公共政策学院',
    '环境科学与工程系',
    '体育教学部',
    '国际文化交流学院',
    '大数据学院',
    '相辉学堂',
    '基础医学院',
    '公共卫生学院',
    '药学院',
    '护理学院',
    '口腔医学院',
    '法医学与法庭科学学院',
    '临床医学院',
    '生物技术学院',
    '大气与海洋科学系',
    '集成电路与微纳电子创新学院',
    '计算与智能创新学院',
    '生物医学工程与技术创新学院',
    '智能机器人与先进制造创新学院',
    '智能材料与未来能源创新学院',
    '未来信息创新学院',
] as const

export const preferenceLimits = {minYear: 1900, maxYear: 2100, majorLength: 100, tagLength: 32, tagCount: 50}

export interface MessagePreferences {
    identity: typeof identityOptions[number]['value'] | ''
    gender: typeof genderOptions[number]['value'] | ''
    department: typeof departments[number] | ''
    educationLevel: typeof educationLevelOptions[number]['value'] | ''
    grade: number | null
    major: string
    campus: typeof campusOptions[number] | ''
    /** Vocabulary available to future notification tagging. */
    tags: string[]
}

export interface MessagePreferencesAPI {
    get(): Promise<Result<MessagePreferences>>
    save(preferences: MessagePreferences): Promise<Result<MessagePreferences>>
}

export const emptyMessagePreferences = (): MessagePreferences => ({
    identity: '', gender: '', department: '', educationLevel: '', grade: null, major: '', campus: '', tags: [],
})

type ValidationResult = {ok: true; data: MessagePreferences} |
    {ok: false; error: string; field: keyof MessagePreferences}

export function validateMessagePreferences(input: unknown): ValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return {ok: false, error: '消息偏好格式无效。', field: 'gender'}
    }
    const value = input as Record<string, unknown>
    if (value.identity !== '' && !identityOptions.some(option => option.value === value.identity)) {
        return {ok: false, error: '请选择有效的身份选项。', field: 'identity'}
    }
    if (value.gender !== '' && !genderOptions.some(option => option.value === value.gender)) {
        return {ok: false, error: '请选择有效的性别选项。', field: 'gender'}
    }
    if (value.department !== '' && !departments.some(department => department === value.department)) {
        return {ok: false, error: '请选择有效的院系。', field: 'department'}
    }
    if (value.educationLevel !== '' && !educationLevelOptions.some(option => option.value === value.educationLevel)) {
        return {ok: false, error: '请选择有效的学历阶段。', field: 'educationLevel'}
    }
    if (value.grade !== null && (typeof value.grade !== 'number' || !Number.isInteger(value.grade) ||
        value.grade < preferenceLimits.minYear || value.grade > preferenceLimits.maxYear)) {
        return {ok: false, error: '请选择有效的年级。', field: 'grade'}
    }
    if (typeof value.major !== 'string' || value.major.trim().length > preferenceLimits.majorLength) {
        return {ok: false, error: `专业名称不能超过 ${preferenceLimits.majorLength} 个字符。`, field: 'major'}
    }
    if (value.campus !== '' && !campusOptions.some(campus => campus === value.campus)) {
        return {ok: false, error: '请选择有效的校区。', field: 'campus'}
    }
    const tagResult = normalizeTags(value.tags)
    if (!tagResult.ok) return {...tagResult, field: 'tags'}
    return {ok: true, data: {
        identity: value.identity as MessagePreferences['identity'],
        gender: value.gender as MessagePreferences['gender'],
        department: value.department as MessagePreferences['department'],
        educationLevel: value.educationLevel as MessagePreferences['educationLevel'],
        grade: value.grade as number | null,
        major: value.major.trim(),
        campus: value.campus as MessagePreferences['campus'],
        tags: tagResult.data,
    }}
}

export function readSavedMessagePreferences(input: unknown): ValidationResult {
    if (input && typeof input === 'object' && !Array.isArray(input) &&
        !('identity' in input) && 'enrollmentYear' in input) {
        const legacy = input as Record<string, unknown>
        return validateMessagePreferences({
            ...emptyMessagePreferences(),
            gender: legacy.gender === 'unspecified' ? '' : legacy.gender,
            grade: legacy.enrollmentYear,
            major: legacy.major,
            tags: legacy.tags,
        })
    }
    if (input && typeof input === 'object' && !Array.isArray(input) && !('campus' in input)) {
        return validateMessagePreferences({...input, campus: ''})
    }
    return validateMessagePreferences(input)
}

export function validateRequiredMessagePreferences(input: unknown): ValidationResult {
    const result = validateMessagePreferences(input)
    if (!result.ok) return result
    const fields = [
        ['identity', '身份'], ['gender', '性别'], ['department', '院系'], ['educationLevel', '学历阶段'],
        ['grade', '年级'], ['major', '专业'], ['campus', '校区'],
    ] as const
    for (const [field, label] of fields) {
        if (result.data[field] === '' || result.data[field] === null) {
            return {ok: false, field, error: `请填写${label}。`}
        }
    }
    return result
}

export function normalizeTags(input: unknown): Result<string[]> {
    if (!Array.isArray(input) || input.some(tag => typeof tag !== 'string')) {
        return {ok: false, error: '标签必须是文本列表。'}
    }
    const tags: string[] = []
    const seen = new Set<string>()
    for (const raw of input as string[]) {
        const tag = raw.trim().replace(/\s+/g, ' ')
        if (!tag) continue
        if (tag.length > preferenceLimits.tagLength) {
            return {ok: false, error: `每个标签不能超过 ${preferenceLimits.tagLength} 个字符。`}
        }
        const key = tag.toLowerCase()
        if (!seen.has(key)) {
            tags.push(tag)
            seen.add(key)
        }
    }
    return tags.length > preferenceLimits.tagCount
        ? {ok: false, error: `最多添加 ${preferenceLimits.tagCount} 个标签。`}
        : {ok: true, data: tags}
}

export function splitTagInput(value: string): string[] {
    return value.split(/[,，;；\r\n]+/)
}

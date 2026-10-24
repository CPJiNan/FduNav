import type {Theme} from '../../shared/accounts'

export type {Theme} from '../../shared/accounts'
const themeKey = 'fdunav.theme'
let currentTheme: Theme = 'auto'

function legacyTheme(): Theme {
    try {
        const saved = localStorage.getItem(themeKey)
        if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved
    } catch {
    }
    return 'auto'
}

export function readTheme(): Theme {
    return currentTheme
}

export async function initializeTheme() {
    currentTheme = legacyTheme()
    if (window.accounts) {
        try {
            const stored = await window.accounts.getTheme()
            if (stored.ok) {
                if (stored.data) currentTheme = stored.data
                const persisted = stored.data !== null || await saveTheme(currentTheme)
                if (persisted) {
                    try {
                        localStorage.removeItem(themeKey)
                    } catch {
                    }
                }
            }
        } catch {
        }
    }
    applyTheme(currentTheme)
}

export function applyTheme(theme: Theme) {
    document.documentElement.dataset.theme = theme
}

export async function saveTheme(theme: Theme): Promise<boolean> {
    currentTheme = theme
    applyTheme(theme)
    try {
        if (window.accounts) return (await window.accounts.setTheme(theme)).ok
        localStorage.setItem(themeKey, theme)
        return true
    } catch {
        return false
    }
}


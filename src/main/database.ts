import {DatabaseSync} from 'node:sqlite'
import type {Theme} from '../shared/accounts'
import type {Notice, NoticeList} from '../shared/notices'
import {emptyMessagePreferences, readSavedMessagePreferences, validateMessagePreferences, type MessagePreferences} from '../shared/message-preferences.ts'

export interface SavedAccount {
    username: string
    cookies: Uint8Array
    target: string
    last_login: string
}

export class AppDatabase {
    private db: DatabaseSync

    constructor(path: string) {
        this.db = new DatabaseSync(path)
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA secure_delete = ON;
            CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS account (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                username TEXT NOT NULL, cookies BLOB NOT NULL,
                target TEXT NOT NULL, last_login TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notices (url TEXT PRIMARY KEY, title TEXT NOT NULL, published TEXT NOT NULL);
            PRAGMA user_version = 2;
        `)
    }

    getAccount(): SavedAccount | null {
        return (this.db.prepare('SELECT username, cookies, target, last_login FROM account WHERE id = 1').get() as unknown as SavedAccount) ?? null
    }

    saveAccount(account: SavedAccount) {
        this.db.prepare(`INSERT INTO account (id, username, cookies, target, last_login)
                         VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO
        UPDATE SET username = excluded.username, cookies = excluded.cookies,
            target = excluded.target, last_login = excluded.last_login`).run(account.username, account.cookies, account.target, account.last_login)
    }

    clearAccount() {
        this.db.exec('DELETE FROM account; PRAGMA wal_checkpoint(TRUNCATE);')
    }

    getTheme(): Theme | null {
        const value = this.db.prepare("SELECT value FROM preferences WHERE key = 'theme'").get()?.value
        return value === 'light' || value === 'dark' || value === 'auto' ? value : null
    }

    setTheme(theme: Theme) {
        this.db.prepare("INSERT INTO preferences (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(theme)
    }

    getMessagePreferences(): MessagePreferences {
        const row = this.db.prepare("SELECT value FROM preferences WHERE key = 'message_preferences'").get()
        if (!row) return emptyMessagePreferences()
        const result = readSavedMessagePreferences(JSON.parse(String(row.value)))
        if (!result.ok) throw new Error('Invalid saved message preferences')
        if (JSON.stringify(result.data) !== row.value) this.setMessagePreferences(result.data)
        return result.data
    }

    setMessagePreferences(input: MessagePreferences): MessagePreferences {
        const result = validateMessagePreferences(input)
        if (!result.ok) throw new Error(result.error)
        this.db.prepare("INSERT INTO preferences (key, value) VALUES ('message_preferences', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(JSON.stringify(result.data))
        return result.data
    }

    getNotices(): NoticeList {
        const items = this.db.prepare('SELECT url, title, published FROM notices ORDER BY published DESC, title LIMIT 100').all() as unknown as Notice[]
        const updatedAt = this.db.prepare("SELECT value FROM preferences WHERE key = 'notices_updated_at'").get()?.value
        return {items, updatedAt: typeof updatedAt === 'string' ? updatedAt : null}
    }

    hasNotice(url: string) {
        return !!this.db.prepare('SELECT 1 FROM notices WHERE url = ?').get(url)
    }

    saveNotices(items: Notice[]) {
        this.db.exec('BEGIN IMMEDIATE')
        try {
            const insert = this.db.prepare('INSERT INTO notices (url, title, published) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET title = excluded.title, published = excluded.published')
            for (const item of items) insert.run(item.url, item.title, item.published)
            this.db.prepare("INSERT INTO preferences (key, value) VALUES ('notices_updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString())
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error
        }
    }

    close() {
        this.db.close()
    }
}

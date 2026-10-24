import {DatabaseSync} from 'node:sqlite'
import type {Theme} from '../shared/accounts'
import type {Notice, NoticeList, ParsedNotice} from '../shared/notices'
import {randomUUID} from 'node:crypto'
import {defaultSources, validateSource, type MessageSource, type SourceInput} from '../shared/sources.ts'
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
        `)
        this.db.exec('PRAGMA foreign_keys = ON;')
        if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 3) this.migrateSources()
        if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 4) {
            this.db.exec('BEGIN IMMEDIATE')
            try { this.db.exec(`
                ALTER TABLE message_sources ADD COLUMN preset TEXT NOT NULL DEFAULT 'generic';
                UPDATE message_sources SET preset = 'jwc' WHERE url LIKE 'https://jwc.fudan.edu.cn/%';
                UPDATE message_sources SET preset = 'cec' WHERE url LIKE 'https://cec.fudan.edu.cn/%';
                DELETE FROM notices WHERE source_id IN
                    (SELECT id FROM message_sources WHERE url = 'https://cec.fudan.edu.cn/')
                    AND NOT EXISTS (SELECT 1 FROM message_sources WHERE url = 'https://cec.fudan.edu.cn/23080/list.htm');
                UPDATE message_sources SET url = 'https://cec.fudan.edu.cn/23080/list.htm', revision = revision + 1,
                    list_url = NULL, updated_at = NULL, last_error = NULL
                    WHERE url = 'https://cec.fudan.edu.cn/' AND NOT EXISTS
                    (SELECT 1 FROM message_sources WHERE url = 'https://cec.fudan.edu.cn/23080/list.htm');
                PRAGMA user_version = 4;
                COMMIT;
            `) } catch (error) {
                this.db.exec('ROLLBACK')
                throw error
            }
        }
    }

    private migrateSources() {
        this.db.exec('BEGIN IMMEDIATE')
        try {
            this.db.exec(`
                CREATE TABLE message_sources (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
                    enabled INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1,
                    list_url TEXT, updated_at TEXT, last_error TEXT
                );
                CREATE TABLE notices_v3 (
                    source_id TEXT NOT NULL REFERENCES message_sources(id) ON DELETE CASCADE,
                    url TEXT NOT NULL, title TEXT NOT NULL, published TEXT NOT NULL,
                    PRIMARY KEY (source_id, url)
                );
            `)
            const insert = this.db.prepare('INSERT INTO message_sources (id, name, url, enabled) VALUES (?, ?, ?, ?)')
            for (const source of defaultSources) insert.run(source.id, source.name, source.url, Number(source.enabled))
            this.db.exec(`
                INSERT INTO notices_v3 SELECT 'jwc', url, title, published FROM notices;
                DROP TABLE notices;
                ALTER TABLE notices_v3 RENAME TO notices;
                CREATE INDEX notices_published ON notices(published DESC);
                UPDATE message_sources SET updated_at = (SELECT value FROM preferences WHERE key = 'notices_updated_at') WHERE id = 'jwc';
                DELETE FROM preferences WHERE key = 'notices_updated_at';
                PRAGMA user_version = 3;
                COMMIT;
            `)
        } catch (error) {
            this.db.exec('ROLLBACK')
            throw error
        }
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
        const items = this.db.prepare(`SELECT n.url, n.title, n.published, n.source_id AS sourceId, s.name AS sourceName
            FROM notices n JOIN message_sources s ON s.id = n.source_id WHERE s.enabled = 1
            ORDER BY n.published DESC, n.title, n.source_id`).all() as unknown as Notice[]
        const sources = this.getSources()
        const updatedAt = sources.filter(source => source.enabled && source.updatedAt).map(source => source.updatedAt!).sort().at(-1) ?? null
        return {items, updatedAt, sources}
    }

    hasNotice(url: string, sourceId = 'jwc') {
        return !!this.db.prepare('SELECT 1 FROM notices WHERE url = ? AND source_id = ?').get(url, sourceId)
    }

    saveNotices(items: ParsedNotice[], sourceId = 'jwc', expectedRevision?: number, listUrl?: string) {
        this.db.exec('BEGIN IMMEDIATE')
        try {
            const source = this.getSource(sourceId)
            if (!source || !source.enabled || (expectedRevision !== undefined && source.revision !== expectedRevision)) {
                this.db.exec('ROLLBACK')
                return false
            }
            const insert = this.db.prepare(`INSERT INTO notices (source_id, url, title, published) VALUES (?, ?, ?, ?)
                ON CONFLICT(source_id, url) DO UPDATE SET title = excluded.title, published = excluded.published`)
            for (const item of items) insert.run(sourceId, item.url, item.title, item.published)
            this.db.prepare('UPDATE message_sources SET updated_at = ?, last_error = NULL, list_url = COALESCE(?, list_url) WHERE id = ?')
                .run(new Date().toISOString(), listUrl ?? null, sourceId)
            this.db.prepare(`DELETE FROM notices WHERE source_id = ? AND url NOT IN
                (SELECT url FROM notices WHERE source_id = ? ORDER BY published DESC, title LIMIT 200)`).run(sourceId, sourceId)
            this.db.exec('COMMIT')
            return true
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error
        }
    }

    getSources(): MessageSource[] {
        return this.db.prepare(`SELECT id, name, url, enabled, preset, revision, list_url AS listUrl,
            updated_at AS updatedAt, last_error AS lastError FROM message_sources ORDER BY rowid`).all()
            .map(row => ({...row, enabled: row.enabled === 1})) as unknown as MessageSource[]
    }

    getSource(id: string): MessageSource | undefined {
        return this.getSources().find(source => source.id === id)
    }

    saveSource(input: SourceInput): MessageSource[] {
        const validated = validateSource(input)
        if (!validated.ok) throw new Error(validated.error)
        const value = validated.data
        const existing = value.id ? this.getSource(value.id) : undefined
        if (value.id && !existing) throw new Error('来源已被删除，请重新读取。')
        if (this.getSources().some(source => source.id !== value.id && source.url === value.url)) throw new Error('该网址已添加。')
        if (!existing && this.getSources().length >= 30) throw new Error('最多添加 30 个消息来源。')
        this.db.exec('BEGIN IMMEDIATE')
        try {
            if (existing) {
                const changed = existing.url !== value.url || existing.preset !== value.preset
                if (changed) this.db.prepare('DELETE FROM notices WHERE source_id = ?').run(existing.id)
                this.db.prepare(`UPDATE message_sources SET name = ?, url = ?, enabled = ?, preset = ?, revision = revision + 1,
                    list_url = ?, updated_at = ?, last_error = NULL WHERE id = ?`)
                    .run(value.name, value.url, Number(value.enabled), value.preset, changed ? null : existing.listUrl,
                        changed ? null : existing.updatedAt, existing.id)
            } else {
                this.db.prepare('INSERT INTO message_sources (id, name, url, enabled, preset) VALUES (?, ?, ?, ?, ?)')
                    .run(randomUUID(), value.name, value.url, Number(value.enabled), value.preset)
            }
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            throw error
        }
        return this.getSources()
    }

    removeSource(id: string): MessageSource[] {
        this.db.prepare('DELETE FROM message_sources WHERE id = ?').run(id)
        return this.getSources()
    }

    setSourceError(id: string, revision: number, error: string) {
        this.db.prepare('UPDATE message_sources SET last_error = ? WHERE id = ? AND revision = ? AND enabled = 1')
            .run(error.slice(0, 500), id, revision)
    }

    close() {
        this.db.close()
    }
}

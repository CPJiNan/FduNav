import {DatabaseSync} from 'node:sqlite'
import type {Theme} from '../shared/accounts'
import type {Notice, NoticeList, ParsedNotice} from '../shared/notices'
import type {Timetable} from '../shared/timetable'
import type {CalendarEvent} from '../shared/calendar'
import {defaultSources, type MessageSource, type SourceId} from '../shared/sources.ts'
import {
    emptyMessagePreferences,
    type MessagePreferences,
    readSavedMessagePreferences,
    validateMessagePreferences
} from '../shared/message-preferences.ts'

const defaultSourceRank = new Map<string, number>(defaultSources.map((source, index) => [source.id, index]))

export interface SavedAccount {
    username: string
    cookies: Uint8Array
    target: string
    last_login: string
}

export interface SavedLlmSettings {
    baseUrl: string;
    model: string;
    encryptedApiKey: Uint8Array | null
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
            CREATE TABLE IF NOT EXISTS timetable_cache (
                username TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY (username, kind)
            );
            CREATE TABLE IF NOT EXISTS calendar_events (
                username TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY (username, id)
            );
            CREATE TABLE IF NOT EXISTS account (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                username TEXT NOT NULL, cookies BLOB NOT NULL,
                target TEXT NOT NULL, last_login TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notices (url TEXT PRIMARY KEY, title TEXT NOT NULL, published TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS llm_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                base_url TEXT NOT NULL, model TEXT NOT NULL, api_key BLOB
            );
        `)
        this.db.exec('PRAGMA foreign_keys = ON;')
        if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 3) this.migrateSources()
        if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 4) {
            this.db.exec('BEGIN IMMEDIATE')
            try {
                this.db.exec(`
                    DELETE
                    FROM notices
                    WHERE source_id IN
                          (SELECT id FROM message_sources WHERE url = 'https://cec.fudan.edu.cn/')
                      AND NOT EXISTS (SELECT 1
                                      FROM message_sources
                                      WHERE url = 'https://cec.fudan.edu.cn/23080/list.htm');
                    UPDATE message_sources
                    SET url        = 'https://cec.fudan.edu.cn/23080/list.htm',
                        revision   = revision + 1,
                        list_url   = NULL,
                        updated_at = NULL,
                        last_error = NULL
                    WHERE url = 'https://cec.fudan.edu.cn/'
                      AND NOT EXISTS
                        (SELECT 1 FROM message_sources WHERE url = 'https://cec.fudan.edu.cn/23080/list.htm');
                    PRAGMA
                    user_version = 4;
                    COMMIT;
                `)
            } catch (error) {
                this.db.exec('ROLLBACK')
                throw error
            }
        }
        if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 5) {
            this.db.exec('BEGIN IMMEDIATE')
            try {
                this.db.exec(`
                    DROP TABLE IF EXISTS notice_tags;
                    PRAGMA
                    user_version = 5;
                    COMMIT;
                `)
            } catch (error) {
                this.db.exec('ROLLBACK')
                throw error
            }
        }
        if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 6) {
            this.db.exec('BEGIN IMMEDIATE')
            try {
                this.db.exec(`
                    UPDATE message_sources
                    SET enabled = 0
                    WHERE id = 'cec'
                      AND revision = 1;
                    PRAGMA
                    user_version = 6;
                    COMMIT;
                `)
            } catch (error) {
                this.db.exec('ROLLBACK')
                throw error
            }
        }
        if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 8) {
            const columns = this.db.prepare('PRAGMA table_info(message_sources)').all() as unknown as { name: string }[]
            if (!columns.some(column => column.name === 'preset')) {
                this.db.exec('PRAGMA user_version = 8;')
            } else {
                this.db.exec('BEGIN IMMEDIATE')
                try {
                    this.db.exec(`
                        ALTER TABLE message_sources DROP COLUMN preset;
                        PRAGMA
                        user_version = 8;
                        COMMIT;
                    `)
                } catch (error) {
                    this.db.exec('ROLLBACK')
                    throw error
                }
            }
        }
        if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 9) {
            this.db.exec('BEGIN IMMEDIATE')
            try {
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS notice_summaries
                    (
                        source_id
                        TEXT
                        NOT
                        NULL,
                        url
                        TEXT
                        NOT
                        NULL,
                        content_hash
                        TEXT
                        NOT
                        NULL,
                        model
                        TEXT
                        NOT
                        NULL,
                        summary
                        TEXT
                        NOT
                        NULL,
                        created_at
                        TEXT
                        NOT
                        NULL,
                        PRIMARY
                        KEY
                    (
                        source_id,
                        url
                    ),
                        FOREIGN KEY
                    (
                        source_id,
                        url
                    ) REFERENCES notices
                    (
                        source_id,
                        url
                    ) ON DELETE CASCADE
                        );
                    PRAGMA
                    user_version = 9;
                    COMMIT;
                `)
            } catch (error) {
                this.db.exec('ROLLBACK')
                throw error
            }
        }
        this.syncSources()
    }

    getLlmSettings(): SavedLlmSettings | null {
        return this.db.prepare('SELECT base_url AS baseUrl, model, api_key AS encryptedApiKey FROM llm_settings WHERE id = 1')
            .get() as unknown as SavedLlmSettings ?? null
    }

    getLlmEnabled(): boolean {
        return this.db.prepare("SELECT value FROM preferences WHERE key = 'llm_enabled'").get()?.value === 'true'
    }

    setLlmEnabled(enabled: boolean) {
        this.db.prepare("INSERT INTO preferences (key, value) VALUES ('llm_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(JSON.stringify(enabled))
    }

    saveLlmSettings(value: SavedLlmSettings) {
        this.db.prepare(`INSERT INTO llm_settings (id, base_url, model, api_key)
                         VALUES (1, ?, ?, ?) ON CONFLICT(id) DO
        UPDATE SET base_url = excluded.base_url, model = excluded.model, api_key = excluded.api_key`)
            .run(value.baseUrl, value.model, value.encryptedApiKey)
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
        this.db.exec('DELETE FROM account; DELETE FROM timetable_cache; PRAGMA wal_checkpoint(TRUNCATE);')
    }

    getTimetable(username: string, kind: Timetable['kind']): Timetable | null {
        const row = this.db.prepare('SELECT data FROM timetable_cache WHERE username = ? AND kind = ?').get(username, kind)
        if (!row) return null
        try {
            return JSON.parse(String(row.data)) as Timetable
        } catch {
            return null
        }
    }

    saveTimetable(username: string, timetable: Timetable) {
        this.db.prepare('INSERT INTO timetable_cache (username, kind, data) VALUES (?, ?, ?) ON CONFLICT(username, kind) DO UPDATE SET data = excluded.data')
            .run(username, timetable.kind, JSON.stringify(timetable))
    }

    getTheme(): Theme | null {
        const value = this.db.prepare("SELECT value FROM preferences WHERE key = 'theme'").get()?.value
        return value === 'light' || value === 'dark' || value === 'auto' ? value : null
    }

    getCalendarEvents(username: string): CalendarEvent[] {
        return this.db.prepare('SELECT data FROM calendar_events WHERE username = ? ORDER BY id').all(username)
            .map(row => JSON.parse(String(row.data)) as CalendarEvent)
    }

    hasCalendarEvent(username: string, id: string) {
        return !!this.db.prepare('SELECT 1 FROM calendar_events WHERE username = ? AND id = ?').get(username, id)
    }

    saveCalendarEvent(username: string, event: CalendarEvent) {
        this.db.prepare('INSERT INTO calendar_events (username, id, data) VALUES (?, ?, ?) ON CONFLICT(username, id) DO UPDATE SET data = excluded.data')
            .run(username, event.id, JSON.stringify(event))
    }

    removeCalendarEvent(username: string, id: string) {
        this.db.prepare('DELETE FROM calendar_events WHERE username = ? AND id = ?').run(username, id)
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
                                       FROM notices n
                                                JOIN message_sources s ON s.id = n.source_id
                                       WHERE s.enabled = 1
                                       ORDER BY n.published DESC, n.title, n.source_id`).all() as unknown as Notice[]
        const sources = this.getSources()
        const updatedAt = sources.filter(source => source.enabled && source.updatedAt).map(source => source.updatedAt!).sort().at(-1) ?? null
        return {items, updatedAt, sources}
    }

    hasNotice(url: string, sourceId = 'jwc') {
        return !!this.db.prepare('SELECT 1 FROM notices WHERE url = ? AND source_id = ?').get(url, sourceId)
    }

    getNotice(sourceId: string, url: string): Notice | null {
        return this.db.prepare(`SELECT n.url,
                                       n.title,
                                       n.published,
                                       n.source_id AS sourceId,
                                       s.name      AS sourceName
                                FROM notices n
                                         JOIN message_sources s ON s.id = n.source_id
                                WHERE n.source_id = ?
                                  AND n.url = ?`).get(sourceId, url) as unknown as Notice ?? null
    }

    getNoticeSummary(sourceId: string, url: string): { contentHash: string; model: string; summary: string } | null {
        return this.db.prepare(`SELECT content_hash AS contentHash, model, summary
                                FROM notice_summaries
                                WHERE source_id = ?
                                  AND url = ?`).get(sourceId, url) as unknown as {
            contentHash: string;
            model: string;
            summary: string
        } ?? null
    }

    saveNoticeSummary(sourceId: string, url: string, contentHash: string, model: string, summary: string) {
        this.db.prepare(`INSERT INTO notice_summaries (source_id, url, content_hash, model, summary, created_at)
                         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(source_id, url) DO
        UPDATE SET content_hash = excluded.content_hash,
            model = excluded.model,
            summary = excluded.summary,
            created_at = excluded.created_at`)
            .run(sourceId, url, contentHash, model, summary, new Date().toISOString())
    }

    saveNotices(items: ParsedNotice[], sourceId = 'jwc', expectedRevision?: number, listUrl?: string) {
        this.db.exec('BEGIN IMMEDIATE')
        try {
            const source = this.getSource(sourceId)
            if (!source?.enabled || (expectedRevision !== undefined && source.revision !== expectedRevision)) {
                this.db.exec('ROLLBACK')
                return false
            }
            const insert = this.db.prepare(`INSERT INTO notices (source_id, url, title, published)
                                            VALUES (?, ?, ?, ?) ON CONFLICT(source_id, url) DO
            UPDATE SET title = excluded.title, published = excluded.published`)
            for (const item of items) {
                insert.run(sourceId, item.url, item.title, item.published)
            }
            this.db.prepare('UPDATE message_sources SET updated_at = ?, last_error = NULL, list_url = COALESCE(?, list_url) WHERE id = ?')
                .run(new Date().toISOString(), listUrl ?? null, sourceId)
            this.db.prepare(`DELETE
                             FROM notices
                             WHERE source_id = ?
                               AND url NOT IN
                                   (SELECT url FROM notices WHERE source_id = ? ORDER BY published DESC, title
                                 LIMIT 200)`).run(sourceId, sourceId)
            this.db.exec('COMMIT')
            return true
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error
        }
    }

    getSources(): MessageSource[] {
        return (this.db.prepare(`SELECT id,
                                        name,
                                        url,
                                        enabled,
                                        revision,
                                        list_url   AS listUrl,
                                        updated_at AS updatedAt,
                                        last_error AS lastError
                                 FROM message_sources
                                 ORDER BY rowid`).all()
            .map(row => ({...row, enabled: row.enabled === 1})) as unknown as MessageSource[])
            .sort((a, b) => (defaultSourceRank.get(a.id) ?? defaultSources.length) -
                (defaultSourceRank.get(b.id) ?? defaultSources.length))
    }

    getSource(id: string): MessageSource | undefined {
        return this.getSources().find(source => source.id === id)
    }

    setSourceEnabled(id: SourceId, enabled: boolean): MessageSource[] {
        this.db.prepare('UPDATE message_sources SET enabled = ? WHERE id = ?').run(Number(enabled), id)
        return this.getSources()
    }

    setSourceError(id: string, revision: number, error: string) {
        this.db.prepare('UPDATE message_sources SET last_error = ? WHERE id = ? AND revision = ? AND enabled = 1')
            .run(error.slice(0, 500), id, revision)
    }

    close() {
        this.db.close()
    }

    private migrateSources() {
        this.db.exec('BEGIN IMMEDIATE')
        try {
            this.db.exec(`
                CREATE TABLE message_sources
                (
                    id         TEXT PRIMARY KEY,
                    name       TEXT    NOT NULL,
                    url        TEXT    NOT NULL UNIQUE,
                    enabled    INTEGER NOT NULL DEFAULT 1,
                    revision   INTEGER NOT NULL DEFAULT 1,
                    list_url   TEXT,
                    updated_at TEXT,
                    last_error TEXT
                );
                CREATE TABLE notices_v3
                (
                    source_id TEXT NOT NULL REFERENCES message_sources (id) ON DELETE CASCADE,
                    url       TEXT NOT NULL,
                    title     TEXT NOT NULL,
                    published TEXT NOT NULL,
                    PRIMARY KEY (source_id, url)
                );
            `)
            const insert = this.db.prepare('INSERT INTO message_sources (id, name, url, enabled) VALUES (?, ?, ?, ?)')
            for (const source of defaultSources) insert.run(source.id, source.name, source.url, Number(source.enabled))
            this.db.exec(`
                INSERT INTO notices_v3
                SELECT 'jwc', url, title, published
                FROM notices;
                DROP TABLE notices;
                ALTER TABLE notices_v3 RENAME TO notices;
                CREATE INDEX notices_published ON notices (published DESC);
                UPDATE message_sources
                SET updated_at = (SELECT value FROM preferences WHERE key = 'notices_updated_at')
                WHERE id = 'jwc';
                DELETE
                FROM preferences
                WHERE key = 'notices_updated_at';
                PRAGMA
                user_version = 3;
                COMMIT;
            `)
        } catch (error) {
            this.db.exec('ROLLBACK')
            throw error
        }
    }

    private syncSources() {
        type Row = { id: string; name: string; url: string; enabled: number; revision: number }
        const rows = this.db.prepare('SELECT id, name, url, enabled, revision FROM message_sources')
            .all() as unknown as Row[]
        this.db.exec('BEGIN IMMEDIATE')
        try {
            const remove = this.db.prepare('DELETE FROM message_sources WHERE id = ?')
            const insert = this.db.prepare(`INSERT INTO message_sources
                                                (id, name, url, enabled, revision, list_url, updated_at, last_error)
                                            VALUES (?, ?, ?, ?, 1, NULL, NULL, NULL)`)
            for (const source of defaultSources) {
                const current = rows.find(row => row.id === source.id)
                if (current) {
                    if (current.url !== source.url) {
                        const conflict = rows.find(row => row.id !== source.id && row.url === source.url)
                        if (conflict) remove.run(conflict.id)
                        this.db.prepare('DELETE FROM notices WHERE source_id = ?').run(source.id)
                        this.db.prepare(`UPDATE message_sources
                                         SET name       = ?,
                                             url        = ?,
                                             revision   = revision + 1,
                                             list_url   = NULL,
                                             updated_at = NULL,
                                             last_error = NULL
                                         WHERE id = ?`)
                            .run(source.name, source.url, source.id)
                    } else if (current.name !== source.name) {
                        this.db.prepare('UPDATE message_sources SET name = ? WHERE id = ?').run(source.name, source.id)
                    }
                    continue
                }
                const adopted = rows.find(row => row.url === source.url)
                if (adopted) remove.run(adopted.id)
                insert.run(source.id, source.name, source.url, adopted ? adopted.enabled : Number(source.enabled))
            }
            for (const row of rows) {
                if (!defaultSources.some(source => source.id === row.id)) remove.run(row.id)
            }
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            throw error
        }
    }
}

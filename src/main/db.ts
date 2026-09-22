import Database from 'better-sqlite3'
import { dataDir } from './paths'
import { join } from 'path'
import { mkdirSync } from 'fs'

let db: Database.Database

export function getDb(): Database.Database {
  if (db) return db
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'reelforge.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  const version = d.pragma('user_version', { simple: true }) as number
  if (version < 1) {
    d.exec(`
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        folder      TEXT NOT NULL,
        source_json TEXT NOT NULL,
        thumbnail   TEXT,
        status      TEXT NOT NULL DEFAULT 'imported',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      PRAGMA user_version = 1;
    `)
  }
  if (version < 2) {
    d.exec(`
      CREATE TABLE clips (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        group_id      TEXT NOT NULL,
        version       INTEGER NOT NULL,
        note          TEXT NOT NULL DEFAULT '',
        score         REAL NOT NULL DEFAULT 0,
        reason        TEXT NOT NULL DEFAULT '',
        doc_json      TEXT NOT NULL,
        autosave_json TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_clips_project ON clips(project_id);
      CREATE TABLE checkpoints (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        clip_id    TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        doc_json   TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_checkpoints_clip ON checkpoints(clip_id);
      PRAGMA user_version = 2;
    `)
  }
}

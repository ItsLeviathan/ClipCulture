import { randomUUID } from 'crypto'
import { getDb } from './db'
import { outputDuration, type ClipDoc, type ClipRecord } from '../shared/types'

export { buildDoc, type HighlightResult, type ReframeResult } from '../shared/docbuild'

interface Row {
  id: string
  project_id: string
  group_id: string
  version: number
  note: string
  score: number
  reason: string
  doc_json: string
  autosave_json: string | null
  updated_at: number
}

const label = (v: number): string => {
  let s = ''
  let n = v
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

function toRecord(r: Row): ClipRecord {
  const doc = JSON.parse(r.doc_json) as ClipDoc
  const starts = doc.segments.map((s) => s.srcStart)
  const ends = doc.segments.map((s) => s.srcEnd)
  return {
    id: r.id,
    projectId: r.project_id,
    groupId: r.group_id,
    version: r.version,
    label: label(r.version - 1),
    versionNote: r.note,
    score: r.score,
    reason: r.reason,
    duration: outputDuration(doc),
    srcStart: Math.min(...starts),
    srcEnd: Math.max(...ends),
    updatedAt: r.updated_at,
    doc,
    autosave: r.autosave_json ? (JSON.parse(r.autosave_json) as ClipDoc) : null
  }
}

export function insertClip(projectId: string, doc: ClipDoc, opts: { groupId?: string; note?: string; score: number; reason: string }): string {
  const db = getDb()
  const id = randomUUID()
  const groupId = opts.groupId ?? randomUUID()
  const version =
    ((db.prepare('SELECT MAX(version) AS v FROM clips WHERE group_id=?').get(groupId) as { v: number | null }).v ?? 0) + 1
  const now = Date.now()
  db.prepare(
    `INSERT INTO clips (id,project_id,group_id,version,note,score,reason,doc_json,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, projectId, groupId, version, opts.note ?? (version === 1 ? 'Original AI edit' : ''), opts.score, opts.reason, JSON.stringify(doc), now, now)
  return id
}

export function listClips(projectId: string): ClipRecord[] {
  return (getDb().prepare('SELECT * FROM clips WHERE project_id=? ORDER BY created_at, version').all(projectId) as Row[])
    .map(toRecord)
    .sort((a, b) => a.srcStart - b.srcStart || a.version - b.version)
}

export function getClip(id: string): ClipRecord | null {
  const r = getDb().prepare('SELECT * FROM clips WHERE id=?').get(id) as Row | undefined
  return r ? toRecord(r) : null
}

const CHECKPOINT_KEEP = 25

function addCheckpoint(clipId: string, docJson: string): void {
  const db = getDb()
  const last = db.prepare('SELECT doc_json FROM checkpoints WHERE clip_id=? ORDER BY id DESC LIMIT 1').get(clipId) as
    | { doc_json: string }
    | undefined
  if (last?.doc_json === docJson) return
  db.prepare('INSERT INTO checkpoints (clip_id,doc_json,created_at) VALUES (?,?,?)').run(clipId, docJson, Date.now())
  db.prepare(
    'DELETE FROM checkpoints WHERE clip_id=? AND id NOT IN (SELECT id FROM checkpoints WHERE clip_id=? ORDER BY id DESC LIMIT ?)'
  ).run(clipId, clipId, CHECKPOINT_KEEP)
}

/** Explicit save: commits the document, clears the autosave, and records a recovery checkpoint. */
export function saveClip(id: string, doc: ClipDoc, checkpoint = true): void {
  const json = JSON.stringify(doc)
  getDb().prepare('UPDATE clips SET doc_json=?, autosave_json=NULL, updated_at=? WHERE id=?').run(json, Date.now(), id)
  if (checkpoint) addCheckpoint(id, json)
}

/** Autosave never overwrites the saved document; it is offered back as "recovered changes" after a crash. */
export function autosaveClip(id: string, doc: ClipDoc): void {
  getDb().prepare('UPDATE clips SET autosave_json=? WHERE id=?').run(JSON.stringify(doc), id)
}

export function discardAutosave(id: string): void {
  getDb().prepare('UPDATE clips SET autosave_json=NULL WHERE id=?').run(id)
}

export function deleteClip(id: string): void {
  getDb().prepare('DELETE FROM clips WHERE id=?').run(id)
}

export function deleteHighlight(groupId: string): void {
  getDb().prepare('DELETE FROM clips WHERE group_id=?').run(groupId)
}

export function deleteProjectClips(projectId: string): void {
  getDb().prepare('DELETE FROM clips WHERE project_id=?').run(projectId)
}

export function clipCount(projectId: string): number {
  return (getDb().prepare('SELECT COUNT(DISTINCT group_id) AS n FROM clips WHERE project_id=?').get(projectId) as { n: number }).n
}

export function listCheckpoints(clipId: string): { id: number; createdAt: number }[] {
  return (getDb().prepare('SELECT id, created_at FROM checkpoints WHERE clip_id=? ORDER BY id DESC').all(clipId) as { id: number; created_at: number }[]).map(
    (r) => ({ id: r.id, createdAt: r.created_at })
  )
}

export function restoreCheckpoint(clipId: string, checkpointId: number): ClipDoc | null {
  const r = getDb().prepare('SELECT doc_json FROM checkpoints WHERE id=? AND clip_id=?').get(checkpointId, clipId) as
    | { doc_json: string }
    | undefined
  return r ? (JSON.parse(r.doc_json) as ClipDoc) : null
}

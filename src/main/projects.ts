import { shell } from 'electron'
import { projectsDir } from './paths'
import { join } from 'path'
import { mkdirSync, readFileSync, existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { getDb } from './db'
import { clipCount } from './clips'
import { probeVideo, makeThumbnail } from './ffmpeg'
import type { ProjectSummary, SourceInfo, Transcript } from '../shared/types'

const projectsRoot = projectsDir

function safeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'Untitled'
}

function uniqueFolder(name: string): string {
  const root = projectsRoot()
  mkdirSync(root, { recursive: true })
  const base = safeFolderName(name)
  let candidate = join(root, base)
  for (let i = 2; existsSync(candidate); i++) candidate = join(root, `${base} ${i}`)
  return candidate
}

function thumbToDataUrl(p: string | null): string | null {
  if (!p || !existsSync(p)) return null
  return `data:image/jpeg;base64,${readFileSync(p).toString('base64')}`
}

interface Row {
  id: string
  name: string
  folder: string
  source_json: string
  thumbnail: string | null
  status: ProjectSummary['status']
  created_at: number
  updated_at: number
}

export const transcriptPath = (folder: string): string => join(folder, 'transcript.json')
export const proxyPath = (folder: string): string => join(folder, 'proxy.mp4')
export const highlightsPath = (folder: string): string => join(folder, 'highlights.json')

export function getProjectRecord(id: string): { id: string; folder: string; source: SourceInfo } | null {
  const r = getDb().prepare('SELECT * FROM projects WHERE id=?').get(id) as Row | undefined
  return r ? { id: r.id, folder: r.folder, source: JSON.parse(r.source_json) as SourceInfo } : null
}

export function setProjectStatus(id: string, status: ProjectSummary['status']): void {
  getDb().prepare('UPDATE projects SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), id)
}

/** An app crash mid-analysis must not leave projects stuck in "analyzing". */
export function resetStaleStatuses(): void {
  getDb().prepare("UPDATE projects SET status='imported' WHERE status='analyzing'").run()
}

export function getTranscript(id: string): Transcript | null {
  const rec = getProjectRecord(id)
  if (!rec) return null
  const p = transcriptPath(rec.folder)
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as Transcript) : null
}

const toSummary = (r: Row): ProjectSummary => ({
  hasTranscript: existsSync(transcriptPath(r.folder)),
  hasProxy: existsSync(proxyPath(r.folder)),
  clipCount: clipCount(r.id),
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  source: JSON.parse(r.source_json) as SourceInfo,
  thumbnail: thumbToDataUrl(r.thumbnail),
  status: r.status
})

/** The original video is only referenced by path — never copied, never modified. */
export async function createProject(sourcePath: string, name?: string): Promise<ProjectSummary> {
  const source = await probeVideo(sourcePath)
  const projectName = name?.trim() || source.fileName.replace(/\.[^.]+$/, '')
  const folder = uniqueFolder(projectName)
  mkdirSync(join(folder, 'cache'), { recursive: true })

  const thumbPath = join(folder, 'thumbnail.jpg')
  const at = Math.min(Math.max(source.duration * 0.1, 0), 30)
  let thumb: string | null = thumbPath
  try {
    await makeThumbnail(sourcePath, thumbPath, at)
  } catch {
    thumb = null // thumbnail is cosmetic; don't fail the import over it
  }

  const now = Date.now()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO projects (id,name,folder,source_json,thumbnail,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(id, projectName, folder, JSON.stringify(source), thumb, 'imported', now, now)
  return toSummary(getDb().prepare('SELECT * FROM projects WHERE id=?').get(id) as Row)
}

export function listProjects(): ProjectSummary[] {
  return (getDb().prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Row[]).map(toSummary)
}

export function renameProject(id: string, name: string): void {
  getDb().prepare('UPDATE projects SET name=?, updated_at=? WHERE id=?').run(name.trim() || 'Untitled', Date.now(), id)
}

/** Removes the project folder (thumbnail, cache, analysis). The source video is never touched. */
export function deleteProject(id: string): void {
  const row = getDb().prepare('SELECT folder FROM projects WHERE id=?').get(id) as { folder: string } | undefined
  if (!row) return
  getDb().prepare('DELETE FROM projects WHERE id=?').run(id)
  rmSync(row.folder, { recursive: true, force: true })
}

export function revealProject(id: string): void {
  const row = getDb().prepare('SELECT folder FROM projects WHERE id=?').get(id) as { folder: string } | undefined
  if (row) void shell.openPath(row.folder)
}

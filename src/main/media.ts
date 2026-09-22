import { BrowserWindow, dialog, protocol } from 'electron'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { Readable } from 'stream'
import { appRoot } from './paths'
import { getProjectRecord, proxyPath } from './projects'
import { probeDuration } from './ffmpeg'
import type { MusicTrack } from '../shared/types'

/** Must be called before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'rf-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
  ])
}

const musicDir = (): string => join(appRoot(), 'assets', 'music')

export function assetPath(projectId: string, name: string): string | null {
  const rec = getProjectRecord(projectId)
  if (!rec) return null
  const p = join(rec.folder, 'assets', basename(name))
  return existsSync(p) ? p : null
}

export function resolveMusicFile(trackId: string | null): string | null {
  if (!trackId) return null
  if (trackId.startsWith('user:')) {
    const [, projectId, file] = trackId.split(':')
    return assetPath(projectId, file ?? '')
  }
  const lib = readLibrary().find((t) => t.id === trackId)
  const p = lib ? join(musicDir(), lib.file) : null
  return p && existsSync(p) ? p : null
}

function readLibrary(): MusicTrack[] {
  const f = join(musicDir(), 'library.json')
  if (!existsSync(f)) return []
  return (JSON.parse(readFileSync(f, 'utf-8')) as Omit<MusicTrack, 'builtin'>[]).map((t) => ({ ...t, builtin: true }))
}

export function listMusic(projectId?: string): MusicTrack[] {
  const tracks = readLibrary()
  if (projectId) {
    const rec = getProjectRecord(projectId)
    const dir = rec ? join(rec.folder, 'assets') : null
    if (dir && existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (!f.startsWith('music-')) continue
        tracks.push({
          id: `user:${projectId}:${f}`,
          title: f.replace(/^music-/, '').replace(/\.[^.]+$/, ''),
          artist: 'Your file',
          category: 'yours',
          duration: 0,
          bpm: 0,
          license: 'Your own file: you are responsible for its rights',
          file: f,
          builtin: false
        })
      }
    }
  }
  return tracks
}

export function registerMediaHandler(): void {
  protocol.handle('rf-media', async (request) => {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    let file: string | null = null
    if (url.hostname === 'proxy') {
      const rec = getProjectRecord(parts[0] ?? '')
      file = rec ? proxyPath(rec.folder) : null
    } else if (url.hostname === 'asset') {
      file = assetPath(parts[0] ?? '', parts[1] ?? '')
    } else if (url.hostname === 'music') {
      file = resolveMusicFile(parts.join('/'))
    }
    if (!file || !existsSync(file)) return new Response('Not found', { status: 404 })
    return serveFile(file, request.headers.get('range'))
  })
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'
}

/** Serves a local file with HTTP Range support: Chromium needs it to seek inside <video>/<audio>. */
function serveFile(file: string, range: string | null): Response {
  const size = statSync(file).size
  let start = 0
  let end = size - 1
  let status = 200
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
  if (m) {
    if (m[1] === '' && m[2] !== '') {
      start = Math.max(0, size - Number(m[2]))
    } else {
      if (m[1] !== '') start = Number(m[1])
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1)
    }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    status = 206
  }
  const headers: Record<string, string> = {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1)
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream
  return new Response(body, { status, headers })
}

function copyIntoAssets(projectId: string, src: string, prefix: string): string | null {
  const rec = getProjectRecord(projectId)
  if (!rec) return null
  const dir = join(rec.folder, 'assets')
  mkdirSync(dir, { recursive: true })
  const base = basename(src, extname(src)).replace(/[^\w.\- ]/g, '_')
  let name = `${prefix}${base}${extname(src).toLowerCase()}`
  for (let i = 2; existsSync(join(dir, name)); i++) name = `${prefix}${base} (${i})${extname(src).toLowerCase()}`
  copyFileSync(src, join(dir, name))
  return name
}

export async function pickImage(projectId: string): Promise<string | null> {
  const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? undefined!, {
    title: 'Add an image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  })
  return r.canceled ? null : copyIntoAssets(projectId, r.filePaths[0], 'img-')
}

export async function pickMusic(projectId: string): Promise<MusicTrack | null> {
  const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? undefined!, {
    title: 'Add your own music',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }]
  })
  if (r.canceled) return null
  const name = copyIntoAssets(projectId, r.filePaths[0], 'music-')
  if (!name) return null
  const p = assetPath(projectId, name)
  return {
    id: `user:${projectId}:${name}`,
    title: name.replace(/^music-/, '').replace(/\.[^.]+$/, ''),
    artist: 'Your file',
    category: 'yours',
    duration: p ? await probeDuration(p) : 0,
    bpm: 0,
    license: 'Your own file: you are responsible for its rights',
    file: name,
    builtin: false
  }
}

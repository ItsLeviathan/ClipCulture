import { BrowserWindow } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { downloadsDir, pythonExe, tempDir } from './paths'
import { ffmpegPath } from './ffmpeg'
import type { DownloadUpdate } from '../shared/types'

const execFileP = promisify(execFile)
const jobs = new Map<string, AbortController>()

function send(u: DownloadUpdate): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('download-update', u)
}

/** yt-dlp needs a JavaScript runtime to read YouTube reliably; use Node if this PC has it. */
let nodePath: string | null | undefined
async function findNode(): Promise<string | null> {
  if (nodePath !== undefined) return nodePath
  try {
    const { stdout } = await execFileP('where', ['node'], { windowsHide: true })
    nodePath = stdout.split(/\r?\n/)[0].trim() || null
  } catch {
    nodePath = null
  }
  return nodePath
}

function friendly(raw: string): string {
  if (/private video|sign in|log in|members-only|age[- ]restricted|confirm your age|use --cookies/i.test(raw))
    return 'This video needs a signed-in account (it may be private, members-only or age-restricted), so it can’t be downloaded.'
  if (/http error 404|not found/i.test(raw)) return 'That link doesn’t lead to a video (page not found).'
  if (/unavailable|removed|does not exist|not available/i.test(raw)) return 'This video is unavailable.'
  if (/unsupported url/i.test(raw)) return 'That link isn’t a video link Clip Culture can download.'
  if (/429|too many requests|getaddrinfo|timed out|network|connection|unable to download/i.test(raw))
    return 'Couldn’t reach the site. Check your internet connection and try again.'
  return 'The download failed.'
}

/** Downloads a video from a link into the downloads folder. Progress is pushed on 'download-update'. */
export async function startDownload(url: string, maxHeight: number): Promise<string> {
  if (!/^https?:\/\/\S+$/i.test(url.trim())) throw new Error('Please paste a full link starting with https://')
  const py = pythonExe()
  if (!existsSync(py)) throw new Error('The local AI environment is not installed, so the downloader is unavailable.')

  const jobId = randomUUID()
  const abort = new AbortController()
  jobs.set(jobId, abort)
  const node = await findNode()
  const fmt = maxHeight > 0 ? `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/b` : 'bv*+ba/b'
  const args = [
    '-m', 'yt_dlp',
    '--no-playlist', '--newline', '--progress', '--no-warnings',
    '--ffmpeg-location', ffmpegPath,
    ...(node ? ['--js-runtimes', `node:${node}`] : []),
    '-f', fmt,
    '--merge-output-format', 'mp4',
    '-o', `${downloadsDir()}/%(title).80s [%(id)s].%(ext)s`,
    '--progress-template', 'download:RFPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
    '--print', 'before_dl:RFTITLE %(title)s',
    '--print', 'after_move:RFFILE %(filepath)s',
    url.trim()
  ]

  void (async () => {
    let title = ''
    let file = ''
    let stream = 0
    let prevBytes = 0
    let stderr = ''
    send({ jobId, state: 'running', progress: null, message: 'Contacting the site…' })
    const p = spawn(py, args, { windowsHide: true, cwd: tempDir(), env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    abort.signal.addEventListener('abort', () => p.kill())
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const l of lines) {
        if (l.startsWith('RFTITLE ')) {
          title = l.slice(8).trim()
          send({ jobId, state: 'running', progress: 0, message: `Downloading “${title}”`, title })
        } else if (l.startsWith('RFFILE ')) file = l.slice(7).trim()
        else if (l.startsWith('RFPROG ')) {
          const [got, total, est] = l.slice(7).split(' ').map((x) => Number(x))
          const size = Number.isFinite(total) && total > 0 ? total : Number.isFinite(est) && est > 0 ? est : 0
          if (Number.isFinite(got) && got < prevBytes) stream++ // video finished, audio stream started
          prevBytes = Number.isFinite(got) ? got : prevBytes
          if (size > 0) {
            const frac = Math.min(1, got / size)
            send({ jobId, state: 'running', progress: Math.min(0.98, (stream + frac) / 2), message: `Downloading “${title}”`, title })
          }
        } else if (/^\[Merger\]|^\[ffmpeg\]/.test(l)) send({ jobId, state: 'running', progress: 0.99, message: 'Finishing the video file…', title })
      }
    })
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
    p.on('error', (e) => send({ jobId, state: 'error', progress: null, message: 'The downloader could not start.', error: { message: 'The downloader could not start.', details: String(e) } }))
    p.on('close', (code) => {
      jobs.delete(jobId)
      if (abort.signal.aborted) return send({ jobId, state: 'cancelled', progress: null, message: 'Download cancelled' })
      if (code === 0 && file && existsSync(file)) return send({ jobId, state: 'done', progress: 1, message: 'Download complete', title, filePath: file })
      const message = friendly(stderr)
      send({ jobId, state: 'error', progress: null, message, error: { message, details: stderr || `exit code ${code}` } })
    })
  })()
  return jobId
}

export const cancelDownload = (jobId: string): void => jobs.get(jobId)?.abort()

export async function downloaderVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileP(pythonExe(), ['-m', 'yt_dlp', '--version'], { windowsHide: true, timeout: 15000 })
    return stdout.trim()
  } catch {
    return null
  }
}

/** YouTube changes often; this fetches the newest yt-dlp so downloads keep working. */
export async function updateDownloader(): Promise<string | null> {
  await execFileP(pythonExe(), ['-m', 'pip', 'install', '-U', 'yt-dlp[default]'], {
    windowsHide: true,
    timeout: 300000,
    env: { ...process.env, PIP_CACHE_DIR: `${tempDir()}/pip-cache` }
  })
  return downloaderVersion()
}

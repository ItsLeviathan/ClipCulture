import { BrowserWindow, shell } from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { detectHardware, ffmpegPath } from './ffmpeg'
import { getClip } from './clips'
import { getDb } from './db'
import { getProjectRecord } from './projects'
import { exportsDir, tempDir } from './paths'
import { assetPath, resolveMusicFile } from './media'
import { buildRenderPlan, cleanupWorkdir, prepareWorkdir } from './render'
import { EXPORT_PRESETS, outputDuration, type ClipDoc, type ExportOptions, type ExportUpdate } from '../shared/types'

interface ExportJob {
  abort: AbortController
}
const jobs = new Map<string, ExportJob>()

function send(u: ExportUpdate): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('export-update', u)
}

const safe = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'clip'

function uniqueOutput(dir: string, base: string): string {
  mkdirSync(dir, { recursive: true })
  let p = join(dir, `${base}.mp4`)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${base} (${i}).mp4`)
  return p
}

let nvencOk: boolean | null = null
async function nvencAvailable(): Promise<boolean> {
  if (nvencOk === null) nvencOk = (await detectHardware()).nvenc
  return nvencOk
}

function runFfmpeg(
  args: string[],
  cwd: string,
  totalSec: number,
  onProgress: (p: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, [...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', args[args.length - 1]], { cwd, windowsHide: true })
    let err = ''
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) {
        const m = l.match(/^out_time_us=(\d+)/)
        if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / totalSec))
      }
    })
    p.stderr.on('data', (d) => (err = (err + d).slice(-40000)))
    signal.addEventListener('abort', () => p.kill())
    p.on('error', reject)
    p.on('close', (code) => {
      if (signal.aborted) reject(new Error('CANCELLED'))
      else if (code === 0) resolve()
      else {
        // surface the lines that explain the failure first; the raw tail is mostly stream info
        const key = err.split(/\r?\n/).filter((l) => /error|invalid|unable|no such|fail|cannot|not found|unrecogni|discarding|does not|option/i.test(l) && !/^\s*(encoder|Metadata)/.test(l))
        const tail = err.split(/\r?\n/).slice(-12).join('\n')
        reject(new Error(`${key.slice(0, 12).join('\n')}\n--- end of log ---\n${tail}` || `ffmpeg exited with code ${code}`))
      }
    })
  })
}

/** Starts an export and returns its job id; progress is pushed on 'export-update'. */
export function exportClip(clipId: string, options: ExportOptions, docOverride?: ClipDoc): string {
  const found = getClip(clipId)
  if (!found) throw new Error('Clip not found')
  const clip = found
  const foundRec = getProjectRecord(clip.projectId)
  if (!foundRec) throw new Error('Project not found')
  const rec = foundRec
  const jobId = randomUUID()
  const job: ExportJob = { abort: new AbortController() }
  jobs.set(jobId, job)

  void (async () => {
    const doc = docOverride ?? clip.doc
    const workdir = prepareWorkdir(tempDir(), jobId.slice(0, 8))
    const projName = getDb().prepare('SELECT name FROM projects WHERE id=?').get(rec.id) as { name: string }
    const dir = join(exportsDir(), safe(projName.name))
    const preset = EXPORT_PRESETS[options.preset]
    const outputPath = uniqueOutput(dir, `${safe(doc.meta.title || 'clip')} ${clip.label} - ${preset.label}`)
    let encoderUsed = ''
    try {
      if (!existsSync(rec.source.path)) throw new Error('SOURCE_MISSING')
      const dur = outputDuration(doc)
      send({ jobId, clipId, state: 'running', progress: 0, message: `Rendering ${dur.toFixed(0)}s clip…` })

      const musicFile = doc.music ? resolveMusicFile(doc.music.trackId) : null
      const imageFiles = doc.images.map((im) => assetPath(rec.id, im.asset) ?? '')
      let encoder: 'nvenc' | 'x264' = options.encoder === 'x264' ? 'x264' : (await nvencAvailable()) || options.encoder === 'nvenc' ? 'nvenc' : 'x264'

      for (let attempt = 0; attempt < 2; attempt++) {
        const plan = buildRenderPlan({ doc, source: rec.source, options, encoder, workdir, outputPath, musicFile, imageFiles })
        writeFileSync(join(workdir, 'graph.txt'), plan.graph, 'utf8')
        encoderUsed = encoder === 'nvenc' ? 'GPU (NVENC)' : 'CPU (x264)'
        try {
          await runFfmpeg(plan.args, workdir, plan.duration, (p) => send({ jobId, clipId, state: 'running', progress: p, message: `Rendering with ${encoderUsed}`, encoder: encoderUsed }), job.abort.signal)
          break
        } catch (e) {
          if (e instanceof Error && e.message === 'CANCELLED') throw e
          if (encoder === 'nvenc' && options.encoder === 'auto' && attempt === 0) {
            encoder = 'x264' // GPU encode failed (driver/session limit): quietly fall back to CPU
            continue
          }
          throw e
        }
      }
      send({ jobId, clipId, state: 'done', progress: 1, message: 'Export complete', outputPath, encoder: encoderUsed })
    } catch (e) {
      rmSync(outputPath, { force: true }) // never leave a half-written video behind
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'CANCELLED') {
        send({ jobId, clipId, state: 'cancelled', progress: 0, message: 'Export cancelled' })
      } else if (msg === 'SOURCE_MISSING') {
        send({ jobId, clipId, state: 'error', progress: 0, message: 'The original video was moved or deleted.', error: { message: 'The original video was moved or deleted.', details: rec.source.path } })
      } else {
        send({ jobId, clipId, state: 'error', progress: 0, message: 'We could not export this clip.', error: { message: 'We could not export this clip.', details: msg } })
      }
    } finally {
      jobs.delete(jobId)
      cleanupWorkdir(workdir)
    }
  })()
  return jobId
}

export const cancelExport = (jobId: string): void => jobs.get(jobId)?.abort.abort()
export const showInFolder = (p: string): void => shell.showItemInFolder(p)

import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { extractAudio, makeProxy } from './ffmpeg'
import { FasterWhisperProvider } from './ai/fasterWhisper'
import { AiError, type TranscriptionProvider } from './ai/types'
import { getProjectRecord, highlightsPath, proxyPath, setProjectStatus, transcriptPath } from './projects'
import { buildDoc, deleteProjectClips, getClip, insertClip, listClips, type HighlightResult, type ReframeResult } from './clips'
import { faceModelPath, llmModelPath, runWorker } from './workers'
import type { AnalysisStep, AnalysisUpdate, RegenerateOption, Transcript } from '../shared/types'

const transcriber: TranscriptionProvider = new FasterWhisperProvider()

interface Job {
  state: AnalysisUpdate
  abort: AbortController
}
const jobs = new Map<string, Job>()
const lastState = new Map<string, AnalysisUpdate>()

type Rec = NonNullable<ReturnType<typeof getProjectRecord>>

const PIPELINE: AnalysisStep[] = [
  { id: 'audio', label: 'Extracting audio', state: 'pending' },
  { id: 'transcribe', label: 'Transcribing speech', state: 'pending' },
  { id: 'highlights', label: 'Finding highlights', state: 'pending' },
  { id: 'proxy', label: 'Preparing fast preview', state: 'pending' },
  { id: 'framing', label: 'Framing vertical clips', state: 'pending' }
]
const REGEN: AnalysisStep[] = [
  { id: 'regen', label: 'Creating a new version', state: 'pending' },
  { id: 'framing', label: 'Framing the shot', state: 'pending' }
]

function publish(job: Job, patch: Partial<AnalysisUpdate>): void {
  job.state = { ...job.state, ...patch }
  lastState.set(job.state.projectId, job.state)
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('analysis-update', job.state)
}

function setStep(job: Job, id: string, state: AnalysisStep['state']): void {
  publish(job, { steps: job.state.steps.map((s) => (s.id === id ? { ...s, state } : s)) })
}

export const getAnalysisState = (id: string): AnalysisUpdate | null => lastState.get(id) ?? null
export const cancelAnalysis = (id: string): void => jobs.get(id)?.abort.abort()

function begin(id: string, steps: AnalysisStep[], work: (job: Job, rec: Rec) => Promise<void>): void {
  if (jobs.has(id)) return
  const rec = getProjectRecord(id)
  if (!rec) throw new Error('Project not found')
  const job: Job = {
    abort: new AbortController(),
    state: { projectId: id, running: true, steps: steps.map((s) => ({ ...s })), message: 'Starting…', progress: null }
  }
  jobs.set(id, job)
  publish(job, {})
  void (async () => {
    let current = steps[0].id
    try {
      setProjectStatus(id, 'analyzing')
      await work(job, rec)
      setProjectStatus(id, listClips(id).length ? 'ready' : 'imported')
      publish(job, { running: false, finished: true, message: 'Done', progress: 1 })
    } catch (e) {
      setProjectStatus(id, listClips(id).length ? 'ready' : 'imported')
      if (e instanceof Error && e.message === 'CANCELLED') {
        publish(job, {
          running: false,
          cancelled: true,
          message: 'Cancelled',
          steps: job.state.steps.map((s) => (s.state === 'active' ? { ...s, state: 'pending' } : s))
        })
      } else {
        const message = e instanceof AiError ? e.message : 'Something went wrong while analyzing this video.'
        const details = e instanceof AiError ? e.details : e instanceof Error ? e.stack ?? e.message : String(e)
        const active = job.state.steps.find((s) => s.state === 'active')?.id ?? current
        current = active
        setStep(job, current, 'error')
        publish(job, { running: false, message, error: { message, details } })
      }
    } finally {
      jobs.delete(id)
    }
  })()
}

/** Returns immediately; progress arrives through 'analysis-update' events. */
export function startAnalysis(id: string, force = false, redoHighlights = false): void {
  begin(id, PIPELINE, (job, rec) => runPipeline(job, rec, force, redoHighlights))
}

const step = async (job: Job, id: string, msg: string, fn: () => Promise<void>): Promise<void> => {
  setStep(job, id, 'active')
  publish(job, { message: msg, progress: null })
  await fn()
  setStep(job, id, 'done')
}

/**
 * force = redo everything (audio, transcript, highlights, preview).
 * redoHighlights = keep transcript/audio/preview but search for highlights again and replace the clips.
 */
async function runPipeline(job: Job, rec: Rec, force: boolean, redoHighlights: boolean): Promise<void> {
  const { signal } = job.abort
  const cache = join(rec.folder, 'cache')
  mkdirSync(cache, { recursive: true })
  const wav = join(cache, 'audio.wav')
  const tpath = transcriptPath(rec.folder)
  const hpath = highlightsPath(rec.folder)
  const proxy = proxyPath(rec.folder)
  const source = rec.source

  if (!existsSync(source.path)) throw new AiError('The original video file was moved or deleted.', source.path)
  if (source.audioStreams.length === 0) throw new AiError("This video has no audio track, so speech can't be transcribed.")

  await step(job, 'audio', 'Extracting audio from video', async () => {
    if (force || !existsSync(wav) || statSync(wav).size < 1024) {
      publish(job, { progress: 0 })
      const tmp = wav + '.part.wav'
      await extractAudio(source.path, tmp, (s) => publish(job, { progress: Math.min(1, s / source.duration) }), signal)
      if (existsSync(wav)) unlinkSync(wav)
      renameSync(tmp, wav)
    }
  })

  await step(job, 'transcribe', 'Preparing speech model', async () => {
    if (force || !existsSync(tpath)) {
      await transcriber.transcribe({
        audioPath: wav,
        outPath: tpath,
        signal,
        onStatus: (m) => publish(job, { message: m }),
        onProgress: (done, total) => publish(job, { progress: total > 0 ? done / total : null })
      })
    }
  })
  const transcript = JSON.parse(readFileSync(tpath, 'utf-8')) as Transcript

  await step(job, 'highlights', 'Preparing language model', async () => {
    if (force || redoHighlights || !existsSync(hpath)) {
      await runWorker(
        'highlights.py',
        ['--mode', 'detect', '--transcript', tpath, '--audio', wav, '--out', hpath, '--model', llmModelPath()],
        {
          signal,
          failMessage: 'Highlight detection failed.',
          onStatus: (m) => publish(job, { message: m }),
          onProgress: (d, t) => publish(job, { progress: t ? d / t : null })
        }
      )
    }
  })

  await step(job, 'proxy', 'Creating a smooth preview copy of the video', async () => {
    if (force || !existsSync(proxy)) {
      const tmp = proxy + '.part.mp4'
      publish(job, { progress: 0 })
      await makeProxy(source.path, tmp, true, (s) => publish(job, { progress: Math.min(1, s / source.duration) }), signal)
      if (existsSync(proxy)) unlinkSync(proxy)
      renameSync(tmp, proxy)
    }
  })

  await step(job, 'framing', 'Tracking people for vertical framing', async () => {
    if (!force && !redoHighlights && listClips(rec.id).length > 0) return // never overwrite the user's edits unless asked
    const { highlights } = JSON.parse(readFileSync(hpath, 'utf-8')) as { highlights: HighlightResult[] }
    if (force || redoHighlights) deleteProjectClips(rec.id)
    if (highlights.length === 0) return
    const reframes = await trackFaces(job, rec, highlights.map((h, i) => ({ id: String(i), start: h.start, end: h.end })))
    highlights.forEach((h, i) => {
      insertClip(rec.id, buildDoc(h, transcript, reframes.get(String(i))), { score: h.score, reason: h.reason })
    })
  })
}

async function trackFaces(
  job: Job,
  rec: Rec,
  ranges: { id: string; start: number; end: number }[]
): Promise<Map<string, ReframeResult>> {
  const cache = join(rec.folder, 'cache')
  const rpath = join(cache, 'ranges.json')
  const opath = join(cache, 'reframe.json')
  writeFileSync(rpath, JSON.stringify(ranges))
  await runWorker('reframe.py', ['--video', proxyPath(rec.folder), '--ranges', rpath, '--out', opath, '--model', faceModelPath()], {
    signal: job.abort.signal,
    failMessage: 'Face tracking failed.',
    onStatus: (m) => publish(job, { message: m }),
    onProgress: (d, t) => publish(job, { progress: t ? d / t : null })
  })
  const { results } = JSON.parse(readFileSync(opath, 'utf-8')) as { results: ReframeResult[] }
  return new Map(results.map((r) => [r.id, r]))
}

const NOTES: Record<RegenerateOption, string> = {
  'stronger-hook': 'Stronger hook',
  shorter: 'Shorter edit',
  'more-context': 'More context',
  'more-emotional': 'More emotional',
  information: 'Focus on information',
  auto: 'Alternative edit'
}

/** Creates a new version of a highlight; the original clip is left untouched. */
export function startRegenerate(clipId: string, option: RegenerateOption): void {
  const clip = getClip(clipId)
  if (!clip) throw new Error('Clip not found')
  begin(clip.projectId, REGEN, async (job, rec) => {
    const cache = join(rec.folder, 'cache')
    const out = join(cache, `regen-${Date.now()}.json`)
    await step(job, 'regen', 'Preparing language model', async () => {
      await runWorker(
        'highlights.py',
        [
          '--mode', 'regenerate',
          '--transcript', transcriptPath(rec.folder),
          '--audio', join(cache, 'audio.wav'),
          '--out', out,
          '--model', llmModelPath(),
          '--instruction', option,
          '--range-start', String(clip.srcStart),
          '--range-end', String(clip.srcEnd)
        ],
        {
          signal: job.abort.signal,
          failMessage: 'Creating a new version failed.',
          onStatus: (m) => publish(job, { message: m }),
          onProgress: (d, t) => publish(job, { progress: t ? d / t : null })
        }
      )
    })
    const { highlights } = JSON.parse(readFileSync(out, 'utf-8')) as { highlights: HighlightResult[] }
    unlinkSync(out)
    if (highlights.length === 0)
      throw new AiError("The AI couldn't find a different version of this moment. Try another option.")
    const h = highlights[0]
    const transcript = JSON.parse(readFileSync(transcriptPath(rec.folder), 'utf-8')) as Transcript
    await step(job, 'framing', 'Tracking people for vertical framing', async () => {
      const rf = await trackFaces(job, rec, [{ id: 'r', start: h.start, end: h.end }])
      insertClip(rec.id, buildDoc(h, transcript, rf.get('r')), {
        groupId: clip.groupId,
        note: NOTES[option],
        score: h.score,
        reason: h.reason
      })
    })
  })
}

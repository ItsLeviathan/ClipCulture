/**
 * The complete, non-destructive description of one short-form clip.
 * Everything the preview shows and the exporter renders is derived from this document;
 * the source video is never modified.
 *
 * Time conventions:
 *   - segments, reframe keys and caption words use SOURCE time (seconds in the original video)
 *   - zoom keys, texts and images use OUTPUT time (seconds from the start of the finished clip)
 */

export interface Segment {
  id: string
  srcStart: number
  srcEnd: number
}

/** Camera position: cx is the horizontal centre of the 9:16 window as a fraction (0..1) of source width. */
export interface CropKey {
  t: number
  cx: number
}

export interface CaptionWord {
  id: string
  text: string
  start: number
  end: number
}

export interface CaptionStyle {
  font: string
  size: number // px on a 1080x1920 canvas
  color: string
  highlightColor: string
  outlineColor: string
  outline: number
  shadow: number
  background: string | null // e.g. "#000000", null for none
  backgroundOpacity: number
  uppercase: boolean
  bold: boolean
  y: number // vertical centre, 0..1 of frame height
  align: 'left' | 'center' | 'right'
  wordsPerLine: number
  highlightWord: boolean
  animation: 'none' | 'pop'
}

export interface Captions {
  enabled: boolean
  style: CaptionStyle
  words: CaptionWord[]
}

export interface TextOverlay {
  id: string
  text: string
  start: number
  end: number
  x: number // centre, 0..1
  y: number
  size: number
  font: string
  color: string
  outlineColor: string
  outline: number
  bold: boolean
  animation: 'none' | 'fade' | 'pop' | 'slide'
}

export interface ImageOverlay {
  id: string
  asset: string // file name inside the project's assets folder
  start: number
  end: number
  x: number
  y: number
  width: number // fraction of frame width
  opacity: number
}

export interface MusicSettings {
  trackId: string | null
  title: string
  volume: number // 0..1
  fadeIn: number
  fadeOut: number
  ducking: boolean
  offset: number // seconds into the track where playback starts
}

export interface ZoomKey {
  t: number
  scale: number // 1 = none
}

export type EffectName = 'none' | 'vivid' | 'warm' | 'cool' | 'bw' | 'cinematic' | 'vignette'

export interface ClipMeta {
  title: string
  hook: string
  caption: string
  hashtags: string[]
}

export interface ClipDoc {
  schema: 1
  segments: Segment[]
  reframe: { mode: 'track' | 'center' | 'manual'; keys: CropKey[] }
  zoom: ZoomKey[]
  captions: Captions
  texts: TextOverlay[]
  images: ImageOverlay[]
  music: MusicSettings | null
  audio: { videoVolume: number; mute: boolean }
  transitions: {
    intro: 'none' | 'fade' | 'zoom'
    outro: 'none' | 'fade'
    between: 'none' | 'crossfade' | 'dip'
    duration: number
  }
  effect: EffectName
  meta: ClipMeta
}

export interface ClipRecord {
  id: string
  projectId: string
  groupId: string
  version: number
  label: string // "A", "B", ...
  versionNote: string // e.g. "Original AI edit", "Shorter"
  score: number
  reason: string
  duration: number
  srcStart: number
  srcEnd: number
  updatedAt: number
  doc: ClipDoc
  /** unsaved changes recovered after an unexpected close */
  autosave: ClipDoc | null
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  font: 'Arial Black',
  size: 96,
  color: '#FFFFFF',
  highlightColor: '#FFE500',
  outlineColor: '#000000',
  outline: 8,
  shadow: 3,
  background: null,
  backgroundOpacity: 0.55,
  uppercase: true,
  bold: true,
  y: 0.68,
  align: 'center',
  wordsPerLine: 3,
  highlightWord: true,
  animation: 'pop'
}

export const FONT_CHOICES = ['Arial Black', 'Impact', 'Segoe UI Black', 'Bahnschrift', 'Verdana', 'Georgia', 'Trebuchet MS', 'Comic Sans MS']

export const EFFECTS: { id: EffectName; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'bw', label: 'Black & white' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'vignette', label: 'Vignette' }
]

export interface MusicTrack {
  id: string
  title: string
  artist: string
  category: string
  duration: number
  bpm: number
  license: string
  file: string // relative to the music folder
  builtin: boolean
}

export type RegenerateOption = 'stronger-hook' | 'shorter' | 'more-context' | 'more-emotional' | 'information' | 'auto'

export type ExportPresetId = 'reels' | 'tiktok' | 'shorts' | 'facebook'

export interface ExportOptions {
  preset: ExportPresetId
  encoder: 'auto' | 'nvenc' | 'x264'
  codec: 'h264' | 'hevc'
  quality: number // CRF (x264) / CQ (nvenc): lower = better
  fps: 'source' | 24 | 30 | 60
  width: number
  height: number
  audioKbps: number
}

export const EXPORT_PRESETS: Record<ExportPresetId, { label: string; maxSeconds: number; fpsCap: number; note: string }> = {
  reels: { label: 'Instagram Reels', maxSeconds: 180, fpsCap: 60, note: 'Reels up to 3 minutes' },
  tiktok: { label: 'TikTok', maxSeconds: 600, fpsCap: 60, note: 'TikTok up to 10 minutes' },
  shorts: { label: 'YouTube Shorts', maxSeconds: 180, fpsCap: 60, note: 'Shorts up to 3 minutes' },
  facebook: { label: 'Facebook Reels', maxSeconds: 90, fpsCap: 60, note: 'Facebook Reels up to 90 seconds' }
}

export const DEFAULT_EXPORT: ExportOptions = {
  preset: 'reels',
  encoder: 'auto',
  codec: 'h264',
  quality: 18,
  fps: 'source',
  width: 1080,
  height: 1920,
  audioKbps: 192
}

export interface ExportUpdate {
  jobId: string
  clipId: string
  state: 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  message: string
  outputPath?: string
  encoder?: string
  error?: { message: string; details: string }
}

/* ---------- pure helpers shared by preview and exporter ---------- */

export const segDuration = (s: Segment): number => Math.max(0, s.srcEnd - s.srcStart)
export const docDuration = (d: ClipDoc): number => d.segments.reduce((n, s) => n + segDuration(s), 0)

/** Overlap (seconds) between neighbouring segments consumed by a crossfade transition. */
export function transitionOverlap(d: ClipDoc): number {
  return d.transitions.between === 'none' ? 0 : d.transitions.duration
}

export function outputDuration(d: ClipDoc): number {
  const n = d.segments.length
  return Math.max(0, docDuration(d) - transitionOverlap(d) * Math.max(0, n - 1))
}

/** Output-time start of each segment. */
export function segmentOffsets(d: ClipDoc): number[] {
  const overlap = transitionOverlap(d)
  const out: number[] = []
  let acc = 0
  for (const s of d.segments) {
    out.push(acc)
    acc += segDuration(s) - overlap
  }
  return out
}

/** Source time -> output time. Returns null if the source moment is cut out of the clip. */
export function srcToOut(d: ClipDoc, src: number): number | null {
  const offs = segmentOffsets(d)
  for (let i = 0; i < d.segments.length; i++) {
    const s = d.segments[i]
    if (src >= s.srcStart && src <= s.srcEnd) return offs[i] + (src - s.srcStart)
  }
  return null
}

/** Output time -> segment index + source time. */
export function outToSrc(d: ClipDoc, out: number): { index: number; src: number } | null {
  const offs = segmentOffsets(d)
  for (let i = d.segments.length - 1; i >= 0; i--) {
    if (out >= offs[i] - 1e-6) {
      const s = d.segments[i]
      const src = Math.min(s.srcEnd, s.srcStart + (out - offs[i]))
      return { index: i, src }
    }
  }
  return d.segments.length ? { index: 0, src: d.segments[0].srcStart } : null
}

/** Piecewise-linear interpolation over sorted keys. */
export function lerpKeys(keys: { t: number; v: number }[], t: number, fallback: number): number {
  if (keys.length === 0) return fallback
  if (t <= keys[0].t) return keys[0].v
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1]
      const b = keys[i]
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
      return a.v + (b.v - a.v) * k
    }
  }
  return keys[keys.length - 1].v
}

export const cropCenter = (d: ClipDoc, srcT: number): number =>
  d.reframe.mode === 'center' ? 0.5 : lerpKeys(d.reframe.keys.map((k) => ({ t: k.t, v: k.cx })), srcT, 0.5)

export const zoomAt = (d: ClipDoc, outT: number): number => {
  let z = lerpKeys(d.zoom.map((k) => ({ t: k.t, v: k.scale })), outT, 1)
  if (d.transitions.intro === 'zoom' && outT < d.transitions.duration)
    z *= 1 + 0.18 * (1 - outT / d.transitions.duration)
  return z
}

export type TimedWord = CaptionWord & { outStart: number; outEnd: number }

export interface Phrase {
  words: TimedWord[]
  start: number // output time
  end: number
}

/** Groups visible caption words (those inside kept segments) into on-screen phrases, in output time. */
export function buildPhrases(d: ClipDoc): { phrases: Phrase[]; words: TimedWord[] } {
  const offs = segmentOffsets(d)
  const words: TimedWord[] = []
  for (const w of d.captions.words) {
    for (let i = 0; i < d.segments.length; i++) {
      const s = d.segments[i]
      if (w.start >= s.srcStart - 0.02 && w.start < s.srcEnd) {
        const outStart = offs[i] + Math.max(0, w.start - s.srcStart)
        const outEnd = offs[i] + Math.min(s.srcEnd, w.end) - s.srcStart
        words.push({ ...w, outStart, outEnd: Math.max(outEnd, outStart + 0.05) })
        break
      }
    }
  }
  words.sort((a, b) => a.outStart - b.outStart)
  const per = Math.max(1, d.captions.style.wordsPerLine)
  const phrases: Phrase[] = []
  let cur: typeof words = []
  const flush = (): void => {
    if (cur.length) phrases.push({ words: cur, start: cur[0].outStart, end: cur[cur.length - 1].outEnd })
    cur = []
  }
  for (const w of words) {
    const prev = cur[cur.length - 1]
    const gap = prev ? w.outStart - prev.outEnd : 0
    if (cur.length >= per || gap > 0.7) flush()
    cur.push(w)
    if (/[.!?]$/.test(w.text)) flush()
  }
  flush()
  return { phrases, words }
}

export const uid = (): string => Math.random().toString(36).slice(2, 10)

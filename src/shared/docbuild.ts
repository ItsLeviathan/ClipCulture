import { DEFAULT_CAPTION_STYLE, uid, type CaptionWord, type ClipDoc, type CropKey } from './clip'
import type { Transcript } from './types'

/** Output of ai/workers/highlights.py for one moment. */
export interface HighlightResult {
  start: number
  end: number
  duration: number
  segments: [number, number][]
  score: number
  reason: string
  title: string
  hook: string
  caption: string
  hashtags: string[]
}

export interface ReframeResult {
  id: string
  mode: 'track' | 'center'
  keys: CropKey[]
}

/** Caption words (source time) for everything inside the kept segments, with split tokens glued back together. */
export function captionWordsFor(segments: { srcStart: number; srcEnd: number }[], transcript: Transcript): CaptionWord[] {
  return transcript.segments
    .flatMap((s) => s.words)
    .filter((w) => segments.some((s) => w.start >= s.srcStart - 0.02 && w.start < s.srcEnd))
    .map((w) => ({ id: uid(), text: w.word.trim(), start: w.start, end: w.end }))
    .filter((w) => w.text.length > 0)
    // Whisper sometimes splits one written word ("$200,000" -> "$200" + ",000"): glue such pieces back together
    .reduce<{ id: string; text: string; start: number; end: number }[]>((acc, w) => {
      const prev = acc[acc.length - 1]
      if (prev && /^[,.;:!?%)'’]|^\d{3}/.test(w.text) && /[\d$€£]$/.test(prev.text) && w.start - prev.end < 0.15) {
        prev.text += w.text
        prev.end = w.end
      } else if (prev && /^[,.;:!?%)]/.test(w.text) && w.start - prev.end < 0.15) {
        prev.text += w.text
        prev.end = w.end
      } else acc.push(w)
      return acc
    }, [])
}

/** Turns an AI highlight + transcript + camera path into a complete, editable clip document. */
export function buildDoc(h: HighlightResult, transcript: Transcript, reframe: ReframeResult | undefined): ClipDoc {
  const segments = h.segments.map(([srcStart, srcEnd]) => ({ id: uid(), srcStart, srcEnd }))
  const words = captionWordsFor(segments, transcript)

  return {
    schema: 1,
    segments,
    reframe: reframe
      ? { mode: reframe.mode, keys: reframe.keys }
      : { mode: 'center', keys: [{ t: h.start, cx: 0.5 }] },
    zoom: [],
    captions: { enabled: true, style: { ...DEFAULT_CAPTION_STYLE }, words },
    texts: [],
    images: [],
    music: null,
    audio: { videoVolume: 1, mute: false },
    transitions: { intro: 'none', outro: 'none', between: 'none', duration: 0.3 },
    effect: 'none',
    meta: { title: h.title, hook: h.hook, caption: h.caption, hashtags: h.hashtags }
  }
}

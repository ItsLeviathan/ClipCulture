import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { buildAss } from './ass'
import {
  cropCenter,
  segDuration,
  outputDuration,
  segmentOffsets,
  transitionOverlap,
  type ClipDoc,
  type EffectName,
  type ExportOptions,
  type SourceInfo
} from '../shared/types'

export interface RenderInput {
  doc: ClipDoc
  source: SourceInfo
  options: ExportOptions
  encoder: 'nvenc' | 'x264'
  workdir: string
  outputPath: string
  /** absolute path of the music file, if the clip has music */
  musicFile: string | null
  /** absolute paths of image overlay files, in the same order as doc.images */
  imageFiles: string[]
}

export interface RenderPlan {
  args: string[]
  duration: number
  graph: string
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
const f = (n: number, d = 4): string => String(Number(n.toFixed(d)))

/** Piecewise-linear expression in variable `t` through (t, v) points; constant outside the range. */
function pwl(points: { t: number; v: number }[], v = 't'): string {
  if (points.length === 0) return '0'
  if (points.length === 1) return f(points[0].v)
  let expr = f(points[points.length - 1].v)
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i]
    const b = points[i + 1]
    const seg = b.t === a.t ? f(b.v) : `${f(a.v)}+(${f(b.v - a.v, 5)})*(${v}-${f(a.t)})/${f(b.t - a.t)}`
    expr = `if(lt(${v},${f(b.t)}),${seg},${expr})`
  }
  // Before the first key the value must stay constant (otherwise the first segment extrapolates backwards)
  return `if(lt(${v},${f(points[0].t)}),${f(points[0].v)},${expr})`
}

/** Reduce a dense polyline so expressions stay short. */
function thin<T extends { t: number; v: number }>(pts: T[], max = 48): T[] {
  if (pts.length <= max) return pts
  const out: T[] = []
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))])
  return out
}

const EFFECT_FILTERS: Record<EffectName, string> = {
  none: '',
  vivid: 'eq=saturation=1.35:contrast=1.06:brightness=0.02',
  warm: 'colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.06:bm=-0.06,eq=saturation=1.1',
  cool: 'colorbalance=rs=-0.06:bs=0.09:bm=0.05,eq=saturation=1.05',
  bw: 'hue=s=0,eq=contrast=1.1',
  cinematic: 'eq=contrast=1.15:saturation=0.9:gamma=0.96,colorbalance=rs=0.05:bs=-0.04:rh=0.04:bh=0.02',
  vignette: 'vignette=angle=PI/4'
}

export function buildRenderPlan(inp: RenderInput): RenderPlan {
  const { doc, source, options, encoder } = inp
  const W = options.width
  const H = options.height
  const outDur = outputDuration(doc)
  const n = doc.segments.length
  if (n === 0 || outDur <= 0) throw new Error('This clip has no video left to export.')

  const sw = source.width
  const sh = source.height
  const ar = W / H
  let cropW: number, cropH: number
  if (sw / sh >= ar) {
    cropH = even(sh)
    cropW = Math.min(even(sh * ar), even(sw))
  } else {
    cropW = even(sw)
    cropH = Math.min(even(sw / ar), even(sh))
  }
  const cropY = Math.round((sh - cropH) / 2)

  const fpsCap = { reels: 60, tiktok: 60, shorts: 60, facebook: 60 }[options.preset]
  const fps = options.fps === 'source' ? Math.min(Math.round(source.fps) || 30, fpsCap) : options.fps
  const hasAudio = source.audioStreams.length > 0

  const overlap = Math.min(
    transitionOverlap(doc),
    Math.min(...doc.segments.map(segDuration)) / 2 - 0.01
  )
  const useX = n > 1 && doc.transitions.between !== 'none' && overlap > 0.05

  const g: string[] = []

  // ---- per-segment video (cut + reframe) and audio
  doc.segments.forEach((seg, i) => {
    const a = seg.srcStart
    const b = seg.srcEnd
    let xExpr: string
    if (cropW >= sw) {
      xExpr = '0'
    } else {
      const px = (srcT: number): number => Math.min(Math.max(cropCenter(doc, srcT) * sw - cropW / 2, 0), sw - cropW)
      const times = [a, ...doc.reframe.keys.map((k) => k.t).filter((t) => t > a && t < b), b]
      const pts = thin(times.map((t) => ({ t: t - a, v: px(t) })))
      xExpr = `'${pwl(pts)}'`
    }
    g.push(
      `[${i}:v]setpts=PTS-STARTPTS,crop=${cropW}:${cropH}:${xExpr}:${cropY},scale=${W}:${H}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p[v${i}]`
    )
    if (hasAudio) g.push(`[${i}:a:0]asetpts=PTS-STARTPTS,aresample=48000[a${i}]`)
  })

  // ---- join segments
  if (n === 1) {
    g.push('[v0]null[vj]')
    if (hasAudio) g.push('[a0]anull[aj]')
  } else if (!useX) {
    const ins = doc.segments.map((_, i) => `[v${i}]${hasAudio ? `[a${i}]` : ''}`).join('')
    g.push(`${ins}concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}[vj]${hasAudio ? '[aj]' : ''}`)
  } else {
    const tr = doc.transitions.between === 'dip' ? 'fadeblack' : 'fade'
    let acc = segDuration(doc.segments[0])
    let vPrev = 'v0'
    let aPrev = 'a0'
    for (let i = 1; i < n; i++) {
      const last = i === n - 1
      g.push(`[${vPrev}][v${i}]xfade=transition=${tr}:duration=${f(overlap, 3)}:offset=${f(acc - overlap, 3)}[${last ? 'vj' : 'vx' + i}]`)
      if (hasAudio) g.push(`[${aPrev}][a${i}]acrossfade=d=${f(overlap, 3)}[${last ? 'aj' : 'ax' + i}]`)
      vPrev = `vx${i}`
      aPrev = `ax${i}`
      acc += segDuration(doc.segments[i]) - overlap
    }
  }

  // ---- video post chain
  let cur = 'vj'
  let step = 0
  const next = (): string => `p${step++}`
  const add = (filter: string): void => {
    const out = next()
    g.push(`[${cur}]${filter}[${out}]`)
    cur = out
  }

  const zoomPts: { t: number; v: number }[] = doc.zoom.map((k) => ({ t: k.t, v: k.scale })).sort((x, y) => x.t - y.t)
  if (doc.transitions.intro === 'zoom') {
    const d = doc.transitions.duration
    // fold the intro zoom into the same expression: start 1.18 -> user zoom curve
    zoomPts.unshift({ t: 0, v: 1.18 }, { t: d, v: 1 })
    zoomPts.sort((x, y) => x.t - y.t)
  }
  if (zoomPts.length && zoomPts.some((p) => Math.abs(p.v - 1) > 0.001)) {
    const ex = `max(1,${pwl(thin(zoomPts))})` // zoom-out below 1x would expose empty edges
    add(`scale=w='trunc(${W}*(${ex})/2)*2':h='trunc(${H}*(${ex})/2)*2':eval=frame:flags=bilinear`)
    add(`crop=${W}:${H}:'(iw-${W})/2':'(ih-${H})/2'`)
  }

  const eff = EFFECT_FILTERS[doc.effect]
  if (eff) add(eff)

  // image overlays (input indexes: 0 = source, then music if present, then each valid image in order)
  let imgInput = n + (inp.musicFile && doc.music ? 1 : 0)
  doc.images.forEach((im, i) => {
    if (!inp.imageFiles[i] || im.end <= im.start) return
    const label = `img${i}`
    g.push(`[${imgInput++}:v]scale=w=${Math.round(W * im.width)}:h=-1,format=rgba,colorchannelmixer=aa=${f(im.opacity, 2)}[${label}]`)
    const out = next()
    g.push(
      `[${cur}][${label}]overlay=x='${f(im.x * W)}-w/2':y='${f(im.y * H)}-h/2':enable='between(t,${f(im.start, 3)},${f(im.end, 3)})':format=auto[${out}]`
    )
    cur = out
  })

  // captions + text (single ASS file)
  const ass = buildAss(doc, W, H, outDur)
  if (ass) {
    writeFileSync(join(inp.workdir, 'subs.ass'), ass, 'utf8')
    add(`ass=filename=subs.ass`)
  }

  // intro / outro
  const tdur = Math.min(doc.transitions.duration, outDur / 3)
  if (doc.transitions.intro === 'fade') add(`fade=t=in:st=0:d=${f(tdur, 3)}`)
  if (doc.transitions.outro === 'fade') add(`fade=t=out:st=${f(Math.max(0, outDur - tdur), 3)}:d=${f(tdur, 3)}`)
  add('format=yuv420p')
  g.push(`[${cur}]null[vout]`)

  // ---- audio
  const vol = doc.audio.mute ? 0 : doc.audio.videoVolume
  let audioLabel: string | null = null
  if (hasAudio) {
    let sp = 'aj'
    const out = 'sp0'
    g.push(`[${sp}]volume=${f(vol, 3)}[${out}]`)
    sp = out
    audioLabel = sp
  }
  if (doc.music && inp.musicFile) {
    const m = doc.music
    const fadeOutStart = Math.max(0, outDur - m.fadeOut)
    let chain = `[${n}:a]aresample=48000,asetpts=PTS-STARTPTS,atrim=0:${f(outDur, 3)},volume=${f(m.volume, 3)}`
    if (m.fadeIn > 0) chain += `,afade=t=in:st=0:d=${f(m.fadeIn, 2)}`
    if (m.fadeOut > 0) chain += `,afade=t=out:st=${f(fadeOutStart, 3)}:d=${f(m.fadeOut, 2)}`
    g.push(`${chain}[mus]`)
    if (audioLabel) {
      if (m.ducking && vol > 0) {
        g.push(`[${audioLabel}]asplit=2[spk][sc]`)
        g.push(`[mus][sc]sidechaincompress=threshold=0.02:ratio=9:attack=25:release=450:makeup=1[duck]`)
        g.push(`[spk][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`)
      } else {
        g.push(`[${audioLabel}][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`)
      }
      audioLabel = 'mix'
    } else {
      audioLabel = 'mus'
    }
  }
  if (audioLabel) {
    const fadeA: string[] = []
    if (doc.transitions.intro === 'fade') fadeA.push(`afade=t=in:st=0:d=${f(tdur, 3)}`)
    if (doc.transitions.outro === 'fade') fadeA.push(`afade=t=out:st=${f(Math.max(0, outDur - tdur), 3)}:d=${f(tdur, 3)}`)
    g.push(`[${audioLabel}]${[...fadeA, 'alimiter=limit=0.97', `atrim=0:${f(outDur, 3)}`].join(',')}[aout]`)
  }

  const graph = g.join(';\n')

  // ---- command line
  // One fast-seeked input per kept segment: decoding starts at the cut point, so a clip 50 minutes
  // into a 1-hour video renders as quickly as one at the start.
  const args: string[] = ['-y', '-hide_banner']
  for (const seg of doc.segments) args.push('-ss', f(seg.srcStart, 3), '-t', f(segDuration(seg) + 0.05, 3), '-i', source.path)
  if (doc.music && inp.musicFile) args.push('-stream_loop', '-1', '-ss', f(doc.music.offset, 2), '-i', inp.musicFile)
  doc.images.forEach((im, i) => {
    if (inp.imageFiles[i] && im.end > im.start) args.push('-loop', '1', '-framerate', '2', '-i', inp.imageFiles[i])
  })
  args.push('-filter_complex_script', 'graph.txt', '-map', '[vout]')
  if (audioLabel) args.push('-map', '[aout]')
  args.push('-t', f(outDur, 3))

  const q = String(options.quality)
  if (encoder === 'nvenc') {
    args.push(
      '-c:v', options.codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc',
      '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', q, '-b:v', '0', '-maxrate', '30M', '-bufsize', '60M',
      ...(options.codec === 'hevc' ? ['-tag:v', 'hvc1'] : ['-profile:v', 'high'])
    )
  } else {
    args.push(
      '-c:v', options.codec === 'hevc' ? 'libx265' : 'libx264',
      '-preset', 'medium', '-crf', q,
      ...(options.codec === 'hevc' ? ['-tag:v', 'hvc1'] : ['-profile:v', 'high'])
    )
  }
  args.push('-pix_fmt', 'yuv420p', '-r', String(fps))
  if (audioLabel) args.push('-c:a', 'aac', '-b:a', `${options.audioKbps}k`, '-ar', '48000')
  args.push('-movflags', '+faststart', '-metadata', `title=${doc.meta.title}`, inp.outputPath)

  return { args, duration: outDur, graph }
}

/** Prepares a private working folder with the graph + subtitle files (ffmpeg runs with this as cwd). */
export function prepareWorkdir(base: string, id: string): string {
  const dir = join(base, `render-${id}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function cleanupWorkdir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* temp files are best-effort */
  }
}

export function copyIfExists(src: string, dst: string): boolean {
  if (!existsSync(src)) return false
  copyFileSync(src, dst)
  return true
}

export { segmentOffsets }

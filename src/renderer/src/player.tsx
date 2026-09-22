import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as RPointerEvent, type ReactElement } from 'react'
import {
  buildPhrases,
  cropCenter,
  outToSrc,
  outputDuration,
  segmentOffsets,
  zoomAt,
  type ClipDoc,
  type SourceInfo
} from '@shared/types'

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

export const proxyUrl = (projectId: string): string => `rf-media://proxy/${projectId}`
export const assetUrl = (projectId: string, name: string): string => `rf-media://asset/${projectId}/${encodeURIComponent(name)}`
export const musicUrl = (trackId: string): string => `rf-media://music/${encodeURIComponent(trackId)}`

const FILTERS: Record<string, string> = {
  none: 'none',
  vivid: 'saturate(1.3) contrast(1.06) brightness(1.02)',
  warm: 'sepia(0.22) saturate(1.1)',
  cool: 'hue-rotate(-12deg) saturate(1.05)',
  bw: 'grayscale(1) contrast(1.1)',
  cinematic: 'contrast(1.15) saturate(0.9)',
  vignette: 'none'
}

/* ------------------------------------------------------------------ playback */

export interface Playback {
  t: number
  playing: boolean
  duration: number
  play(): void
  pause(): void
  toggle(): void
  seek(t: number): void
}

/**
 * Drives the source proxy <video> through the clip's kept segments so the preview plays the edit
 * (cuts included) in output time. Optional <audio> plays the music bed with approximate ducking.
 */
export function usePlayback(
  doc: ClipDoc,
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  audioRef?: MutableRefObject<HTMLAudioElement | null>,
  opts: { loop?: boolean } = {}
): Playback {
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const docRef = useRef(doc)
  docRef.current = doc
  const tRef = useRef(0)
  const idxRef = useRef(0)
  const playingRef = useRef(false)
  const raf = useRef(0)
  /** A seek the <video> has been asked to do but hasn't finished; the play loop must not trust currentTime until then. */
  const pendingRef = useRef<{ src: number; at: number } | null>(null)
  const duration = outputDuration(doc)

  const jumpTo = (v: HTMLVideoElement, src: number): void => {
    v.currentTime = src
    pendingRef.current = { src, at: performance.now() }
  }

  const applyAudio = useCallback((tt: number, isPlaying: boolean) => {
    const a = audioRef?.current
    const d = docRef.current
    if (!a) return
    if (!d.music || !d.music.trackId) {
      a.pause()
      return
    }
    let vol = d.music.volume
    const total = outputDuration(d)
    if (d.music.fadeIn > 0 && tt < d.music.fadeIn) vol *= tt / d.music.fadeIn
    if (d.music.fadeOut > 0 && tt > total - d.music.fadeOut) vol *= Math.max(0, (total - tt) / d.music.fadeOut)
    if (d.music.ducking && d.captions.words.length) {
      const src = outToSrc(d, tt)?.src ?? 0
      const speaking = d.captions.words.some((w) => src >= w.start - 0.05 && src <= w.end + 0.25)
      if (speaking) vol *= 0.3
    }
    a.volume = clamp(vol, 0, 1)
    if (isPlaying && a.paused) void a.play().catch(() => undefined)
    if (!isPlaying && !a.paused) a.pause()
  }, [audioRef])

  const syncMusicPosition = useCallback((tt: number) => {
    const a = audioRef?.current
    const d = docRef.current
    if (!a || !d.music) return
    const len = a.duration
    const pos = d.music.offset + tt
    try {
      a.currentTime = Number.isFinite(len) && len > 0 ? pos % len : pos
    } catch {
      /* metadata not loaded yet */
    }
  }, [audioRef])

  const seek = useCallback(
    (tt: number) => {
      const d = docRef.current
      const total = outputDuration(d)
      const c = clamp(tt, 0, Math.max(0, total - 0.001))
      const m = outToSrc(d, c)
      const v = videoRef.current
      if (m && v) {
        idxRef.current = m.index
        jumpTo(v, m.src)
      }
      tRef.current = c
      setT(c)
      syncMusicPosition(c)
      applyAudio(c, playingRef.current)
    },
    [videoRef, applyAudio, syncMusicPosition]
  )

  const stopLoop = (): void => cancelAnimationFrame(raf.current)

  const tick = useCallback(() => {
    const d = docRef.current
    const v = videoRef.current
    if (!v || !playingRef.current) return
    const pend = pendingRef.current
    if (pend) {
      // wait for the seek to land (or give up after 1.5 s) before reading currentTime again
      if (Math.abs(v.currentTime - pend.src) < 0.35 || performance.now() - pend.at > 1500) pendingRef.current = null
      else {
        raf.current = requestAnimationFrame(tick)
        return
      }
    }
    const offs = segmentOffsets(d)
    let i = idxRef.current
    const seg = d.segments[i]
    if (!seg) return
    if (v.currentTime >= seg.srcEnd - 0.03 || v.currentTime < seg.srcStart - 0.5) {
      if (i + 1 < d.segments.length) {
        i++
        idxRef.current = i
        jumpTo(v, d.segments[i].srcStart)
        raf.current = requestAnimationFrame(tick)
        return
      } else if (opts.loop) {
        idxRef.current = 0
        jumpTo(v, d.segments[0].srcStart)
        syncMusicPosition(0)
        raf.current = requestAnimationFrame(tick)
        return
      } else {
        v.pause()
        playingRef.current = false
        setPlaying(false)
        applyAudio(tRef.current, false)
        return
      }
    }
    const cur = d.segments[i]
    const tt = offs[i] + Math.max(0, v.currentTime - cur.srcStart)
    tRef.current = tt
    setT(tt)
    applyAudio(tt, true)
    raf.current = requestAnimationFrame(tick)
  }, [videoRef, opts.loop, applyAudio, syncMusicPosition])

  const play = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const d = docRef.current
    if (tRef.current >= outputDuration(d) - 0.05) seek(0)
    playingRef.current = true
    setPlaying(true)
    v.muted = d.audio.mute
    v.volume = clamp(d.audio.videoVolume, 0, 1)
    void v.play().catch(() => undefined)
    syncMusicPosition(tRef.current)
    stopLoop()
    raf.current = requestAnimationFrame(tick)
  }, [videoRef, tick, seek, syncMusicPosition])

  const pause = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
    videoRef.current?.pause()
    audioRef?.current?.pause()
    stopLoop()
  }, [videoRef, audioRef])

  useEffect(() => () => stopLoop(), [])

  // keep audio levels in sync with sliders while playing / paused
  useEffect(() => {
    const v = videoRef.current
    if (v) {
      v.muted = doc.audio.mute
      v.volume = clamp(doc.audio.videoVolume, 0, 1)
    }
  }, [doc.audio.mute, doc.audio.videoVolume, videoRef])

  useEffect(() => {
    // the edit changed (cut, trim, undo): re-clamp the playhead so preview never sits outside the clip
    if (tRef.current > duration) seek(duration)
    else {
      const m = outToSrc(docRef.current, tRef.current)
      if (m) idxRef.current = m.index
    }
    applyAudio(tRef.current, playingRef.current)
  }, [doc, duration, seek, applyAudio])

  return {
    t,
    playing,
    duration,
    play,
    pause,
    toggle: () => (playingRef.current ? pause() : play()),
    seek
  }
}

/* ------------------------------------------------------------------ surface */

export interface SurfaceProps {
  projectId: string
  source: SourceInfo
  doc: ClipDoc
  t: number
  videoRef: MutableRefObject<HTMLVideoElement | null>
  height?: number | string
  /** enables drag interactions (editor only) */
  interactive?: boolean
  onPanCamera?: (cx: number) => void
  onMoveText?: (id: string, x: number, y: number) => void
  onMoveImage?: (id: string, x: number, y: number) => void
  onMoveCaptions?: (y: number) => void
  selectedId?: string | null
  onSelect?: (kind: 'text' | 'image' | 'captions', id: string) => void
  onVideoReady?: () => void
}

const cq = (px: number): string => `${(px / 1080) * 100}cqw`

/** Shows the clip exactly as the exporter will render it: crop + camera path, zoom, effect, images, text, captions. */
export function PreviewSurface(p: SurfaceProps): ReactElement {
  const { doc, source, t } = p
  const boxRef = useRef<HTMLDivElement>(null)
  const srcT = outToSrc(doc, t)?.src ?? doc.segments[0]?.srcStart ?? 0
  const ar = source.width / source.height
  const target = 9 / 16

  // horizontal camera placement (same clamping as the exporter)
  const wide = ar >= target
  const half = wide ? target / (2 * ar) : 0.5
  const cx = clamp(cropCenter(doc, srcT), half, 1 - half)
  const zoom = zoomAt(doc, t)
  const videoWpct = wide ? (ar / target) * 100 : 100
  const leftPct = wide ? 50 - cx * videoWpct : 0

  const { phrases, words } = useMemo(() => buildPhrases(doc), [doc])
  const activeWord = words.find((w) => t >= w.outStart && t < w.outEnd) ?? null
  let phrase = phrases.find((ph) => t >= ph.start && t < ph.end + 0.25) ?? null
  if (phrase && phrases.some((o) => o !== phrase && t >= o.start && t < o.end)) phrase = phrases.find((o) => t >= o.start && t < o.end) ?? phrase

  const dur = outputDuration(doc)
  const tdur = Math.min(doc.transitions.duration, dur / 3)
  let fade = 0
  if (doc.transitions.intro === 'fade' && t < tdur) fade = Math.max(fade, 1 - t / tdur)
  if (doc.transitions.outro === 'fade' && t > dur - tdur) fade = Math.max(fade, 1 - (dur - t) / tdur)

  const drag = useRef<null | { kind: string; id?: string; startX: number; startY: number; cx0: number; x0: number; y0: number }>(null)

  const onDown = (e: RPointerEvent, kind: string, id?: string, x0 = 0, y0 = 0): void => {
    if (!p.interactive) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, id, startX: e.clientX, startY: e.clientY, cx0: cx, x0, y0 }
    if (kind !== 'camera' && id) p.onSelect?.(kind as 'text' | 'image' | 'captions', id)
  }
  const onMove = (e: RPointerEvent): void => {
    const d = drag.current
    const box = boxRef.current
    if (!d || !box) return
    const r = box.getBoundingClientRect()
    const dx = (e.clientX - d.startX) / r.width
    const dy = (e.clientY - d.startY) / r.height
    if (d.kind === 'camera') p.onPanCamera?.(clamp(d.cx0 - dx / (videoWpct / 100), half, 1 - half))
    else if (d.kind === 'text' && d.id) p.onMoveText?.(d.id, clamp(d.x0 + dx, 0, 1), clamp(d.y0 + dy, 0, 1))
    else if (d.kind === 'image' && d.id) p.onMoveImage?.(d.id, clamp(d.x0 + dx, 0, 1), clamp(d.y0 + dy, 0, 1))
    else if (d.kind === 'captions') p.onMoveCaptions?.(clamp(d.y0 + dy, 0.05, 0.95))
  }
  const onUp = (): void => {
    drag.current = null
  }

  const st = doc.captions.style
  const shown = (s: string): string => (st.uppercase ? s.toUpperCase() : s)
  const stroke = `${cq(st.outline)} ${st.outlineColor}`
  const capStyle: CSSProperties = {
    fontFamily: `'${st.font}', 'Arial Black', sans-serif`,
    fontWeight: st.bold ? 900 : 400,
    fontSize: cq(st.size),
    lineHeight: 1.12,
    textAlign: st.align,
    color: st.color,
    WebkitTextStroke: st.background ? undefined : stroke,
    paintOrder: 'stroke fill',
    textShadow: st.background ? undefined : `0 ${cq(st.shadow)} ${cq(st.shadow * 2)} rgba(0,0,0,.6)`,
    background: st.background
      ? `${st.background}${Math.round(st.backgroundOpacity * 255).toString(16).padStart(2, '0')}`
      : undefined,
    padding: st.background ? `${cq(10)} ${cq(22)}` : undefined,
    borderRadius: st.background ? cq(14) : undefined
  }

  return (
    <div
      ref={boxRef}
      className="surface"
      style={{ height: p.height ?? '100%', aspectRatio: '9 / 16', containerType: 'inline-size' }}
      onPointerDown={(e) => onDown(e, 'camera')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="zoomwrap" style={{ transform: `scale(${zoom})` }}>
        <video
          ref={p.videoRef}
          src={proxyUrl(p.projectId)}
          preload="auto"
          playsInline
          onLoadedMetadata={p.onVideoReady}
          style={{
            position: 'absolute',
            top: wide ? 0 : '50%',
            height: wide ? '100%' : 'auto',
            width: `${videoWpct}%`,
            left: `${leftPct}%`,
            transform: wide ? undefined : 'translateY(-50%)',
            filter: FILTERS[doc.effect],
            pointerEvents: 'none'
          }}
        />
      </div>
      {doc.effect === 'vignette' && <div className="vignette" />}

      {doc.images.map((im) =>
        t >= im.start && t <= im.end ? (
          <img
            key={im.id}
            src={assetUrl(p.projectId, im.asset)}
            alt=""
            draggable={false}
            className={'ov' + (p.selectedId === im.id ? ' sel' : '')}
            style={{ left: `${im.x * 100}%`, top: `${im.y * 100}%`, width: `${im.width * 100}%`, opacity: im.opacity, transform: 'translate(-50%,-50%)', cursor: p.interactive ? 'move' : 'default' }}
            onPointerDown={(e) => onDown(e, 'image', im.id, im.x, im.y)}
          />
        ) : null
      )}

      {doc.texts.map((tx) => {
        if (t < tx.start || t > tx.end) return null
        const age = t - tx.start
        let opacity = 1
        let scale = 1
        let dy = 0
        if (tx.animation === 'fade' || tx.animation === 'pop' || tx.animation === 'slide') {
          opacity = Math.min(1, age / 0.25, (tx.end - t) / 0.25)
        }
        if (tx.animation === 'pop') scale = 0.6 + 0.4 * Math.min(1, age / 0.22)
        if (tx.animation === 'slide') dy = (1 - Math.min(1, age / 0.32)) * 70
        return (
          <div
            key={tx.id}
            className={'ov txt' + (p.selectedId === tx.id ? ' sel' : '')}
            style={{
              left: `${tx.x * 100}%`,
              top: `${tx.y * 100}%`,
              transform: `translate(-50%,-50%) translateY(${(dy / 1080) * 100}cqw) scale(${scale})`,
              opacity: Math.max(0, opacity),
              fontFamily: `'${tx.font}', Arial, sans-serif`,
              fontWeight: tx.bold ? 800 : 400,
              fontSize: cq(tx.size),
              color: tx.color,
              WebkitTextStroke: `${cq(tx.outline)} ${tx.outlineColor}`,
              paintOrder: 'stroke fill',
              cursor: p.interactive ? 'move' : 'default'
            }}
            onPointerDown={(e) => onDown(e, 'text', tx.id, tx.x, tx.y)}
          >
            {tx.text}
          </div>
        )
      })}

      {doc.captions.enabled && phrase && (
        <div
          className={'ov cap' + (p.selectedId === 'captions' ? ' sel' : '')}
          style={{
            top: `${st.y * 100}%`,
            left: st.align === 'center' ? '50%' : st.align === 'left' ? '6.5%' : undefined,
            right: st.align === 'right' ? '6.5%' : undefined,
            transform: st.align === 'center' ? 'translate(-50%,-50%)' : 'translateY(-50%)',
            maxWidth: '87%',
            cursor: p.interactive ? 'ns-resize' : 'default'
          }}
          onPointerDown={(e) => onDown(e, 'captions', 'captions', 0, st.y)}
        >
          <span style={capStyle}>
            {phrase.words.map((w, i) => (
              <span key={w.id} style={{ color: st.highlightWord && activeWord?.id === w.id ? st.highlightColor : st.color }}>
                {shown(w.text)}
                {i < phrase!.words.length - 1 ? ' ' : ''}
              </span>
            ))}
          </span>
        </div>
      )}
      {fade > 0 && <div className="fadeov" style={{ opacity: fade }} />}
    </div>
  )
}

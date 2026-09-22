import { useEffect, useMemo, useRef, type PointerEvent as RPointerEvent, type ReactElement } from 'react'
import { buildPhrases, outputDuration, segDuration, segmentOffsets, type ClipDoc } from '@shared/types'

export type Selection = { kind: 'segment' | 'text' | 'image' | 'zoom' | 'music' | 'captions'; id: string } | null

interface Props {
  doc: ClipDoc
  t: number
  sourceDuration: number
  pps: number
  selection: Selection
  onSelect: (s: Selection) => void
  onSeek: (t: number) => void
  edit: (fn: (d: ClipDoc) => void, key?: string) => void
  playing: boolean
}

const LABEL_W = 92
const ROW_H = 36
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))
const MIN_LEN = 0.3

export default function Timeline({ doc, t, sourceDuration, pps, selection, onSelect, onSeek, edit, playing }: Props): ReactElement {
  const dur = outputDuration(doc)
  const offs = segmentOffsets(doc)
  const width = Math.max(dur, 1) * pps + 120
  const scroller = useRef<HTMLDivElement>(null)
  const { phrases } = useMemo(() => buildPhrases(doc), [doc])

  // keep the playhead visible during playback
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const x = t * pps
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
  }, [t, pps, playing])

  const seekFromEvent = (e: RPointerEvent): void => {
    const el = scroller.current
    if (!el) return
    const r = el.getBoundingClientRect()
    onSeek(clamp((e.clientX - r.left + el.scrollLeft) / pps, 0, dur))
  }

  /** Generic horizontal drag with document-level listeners. */
  const startDrag = (e: RPointerEvent, onMove: (dx: number) => void): void => {
    e.stopPropagation()
    e.preventDefault()
    const x0 = e.clientX
    const move = (ev: PointerEvent): void => onMove((ev.clientX - x0) / pps)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- video segments: trim + reorder
  const trimSeg = (e: RPointerEvent, i: number, side: 'l' | 'r'): void => {
    const s0 = doc.segments[i]
    const id = s0.id
    onSelect({ kind: 'segment', id })
    startDrag(e, (dx) =>
      edit((d) => {
        const s = d.segments.find((x) => x.id === id)
        if (!s) return
        if (side === 'l') s.srcStart = clamp(s0.srcStart + dx, 0, s.srcEnd - MIN_LEN)
        else s.srcEnd = clamp(s0.srcEnd + dx, s.srcStart + MIN_LEN, sourceDuration)
      }, `trim:${id}:${side}`)
    )
  }

  const dragSeg = (e: RPointerEvent, i: number): void => {
    const id = doc.segments[i].id
    onSelect({ kind: 'segment', id })
    const startOut = offs[i]
    onSeek(clamp(((e.clientX - (scroller.current?.getBoundingClientRect().left ?? 0) + (scroller.current?.scrollLeft ?? 0)) / pps), 0, dur))
    if (doc.segments.length < 2) return
    startDrag(e, (dx) =>
      edit((d) => {
        const cur = d.segments.findIndex((x) => x.id === id)
        const o = segmentOffsets(d)
        const center = startOut + dx + segDuration(d.segments[cur]) / 2
        let target = 0
        d.segments.forEach((s, k) => {
          if (k !== cur && o[k] + segDuration(s) / 2 < center) target++
        })
        if (target !== cur) {
          const [m] = d.segments.splice(cur, 1)
          d.segments.splice(target, 0, m)
        }
      }, `reorder:${id}`)
    )
  }

  // ---- text / image blocks: move + resize
  const moveItem = (e: RPointerEvent, kind: 'text' | 'image', id: string): void => {
    const list = kind === 'text' ? doc.texts : doc.images
    const it0 = list.find((x) => x.id === id)
    if (!it0) return
    onSelect({ kind, id })
    startDrag(e, (dx) =>
      edit((d) => {
        const it = (kind === 'text' ? d.texts : d.images).find((x) => x.id === id)
        if (!it) return
        const len = it0.end - it0.start
        const s = clamp(it0.start + dx, 0, Math.max(0, dur - 0.3))
        it.start = s
        it.end = s + len
      }, `move:${id}`)
    )
  }
  const resizeItem = (e: RPointerEvent, kind: 'text' | 'image', id: string, side: 'l' | 'r'): void => {
    const list = kind === 'text' ? doc.texts : doc.images
    const it0 = list.find((x) => x.id === id)
    if (!it0) return
    onSelect({ kind, id })
    startDrag(e, (dx) =>
      edit((d) => {
        const it = (kind === 'text' ? d.texts : d.images).find((x) => x.id === id)
        if (!it) return
        if (side === 'l') it.start = clamp(it0.start + dx, 0, it.end - 0.2)
        else it.end = clamp(it0.end + dx, it.start + 0.2, dur)
      }, `resize:${id}:${side}`)
    )
  }

  const moveZoom = (e: RPointerEvent, idx: number): void => {
    const k0 = doc.zoom[idx]
    onSelect({ kind: 'zoom', id: String(idx) })
    startDrag(e, (dx) =>
      edit((d) => {
        const k = d.zoom[idx]
        if (k) k.t = clamp(k0.t + dx, 0, dur)
      }, `zoom:${idx}`)
    )
  }

  const ticks: number[] = []
  const step = pps >= 90 ? 1 : pps >= 40 ? 2 : pps >= 18 ? 5 : 10
  for (let s = 0; s <= dur; s += step) ticks.push(s)
  const mm = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const isSel = (kind: string, id: string): boolean => selection?.kind === kind && selection.id === id

  const rows: [string, string][] = [
    ['video', 'Video'],
    ['captions', 'Captions'],
    ['text', 'Text'],
    ['image', 'Images'],
    ['music', 'Music'],
    ['zoom', 'Zoom']
  ]

  return (
    <div className="timeline">
      <div className="tl-labels" style={{ width: LABEL_W }}>
        <div className="tl-ruler-label" />
        {rows.map(([k, l]) => (
          <div key={k} className="tl-label" style={{ height: ROW_H }}>{l}</div>
        ))}
      </div>
      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner" style={{ width }}>
          <div className="tl-ruler" onPointerDown={(e) => { seekFromEvent(e); const mv = (ev: PointerEvent): void => seekFromEvent(ev as unknown as RPointerEvent); const up = (): void => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up) }}>
            {ticks.map((s) => (
              <div key={s} className="tick" style={{ left: s * pps }}>
                <span>{mm(s)}</span>
              </div>
            ))}
          </div>

          <div className="tl-row" style={{ height: ROW_H }} onPointerDown={() => onSelect(null)}>
            {doc.segments.map((s, i) => (
              <div
                key={s.id}
                className={'blk seg' + (isSel('segment', s.id) ? ' sel' : '')}
                style={{ left: offs[i] * pps, width: Math.max(6, segDuration(s) * pps) }}
                onPointerDown={(e) => dragSeg(e, i)}
                title={`Source ${s.srcStart.toFixed(1)}s – ${s.srcEnd.toFixed(1)}s`}
              >
                <div className="handle l" onPointerDown={(e) => trimSeg(e, i, 'l')} />
                <span>{segDuration(s).toFixed(1)}s</span>
                <div className="handle r" onPointerDown={(e) => trimSeg(e, i, 'r')} />
              </div>
            ))}
          </div>

          <div className="tl-row" style={{ height: ROW_H }}>
            {doc.captions.enabled &&
              phrases.map((ph, i) => (
                <div
                  key={i}
                  className={'blk cap' + (selection?.kind === 'captions' ? ' sel' : '')}
                  style={{ left: ph.start * pps, width: Math.max(4, (ph.end - ph.start) * pps - 1) }}
                  onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: 'captions', id: 'captions' }); onSeek(ph.start + 0.01) }}
                  title={ph.words.map((w) => w.text).join(' ')}
                >
                  <span>{ph.words.map((w) => w.text).join(' ')}</span>
                </div>
              ))}
          </div>

          <div className="tl-row" style={{ height: ROW_H }}>
            {doc.texts.map((x) => (
              <div key={x.id} className={'blk txt' + (isSel('text', x.id) ? ' sel' : '')} style={{ left: x.start * pps, width: Math.max(10, (x.end - x.start) * pps) }} onPointerDown={(e) => moveItem(e, 'text', x.id)}>
                <div className="handle l" onPointerDown={(e) => resizeItem(e, 'text', x.id, 'l')} />
                <span>{x.text}</span>
                <div className="handle r" onPointerDown={(e) => resizeItem(e, 'text', x.id, 'r')} />
              </div>
            ))}
          </div>

          <div className="tl-row" style={{ height: ROW_H }}>
            {doc.images.map((x) => (
              <div key={x.id} className={'blk img' + (isSel('image', x.id) ? ' sel' : '')} style={{ left: x.start * pps, width: Math.max(10, (x.end - x.start) * pps) }} onPointerDown={(e) => moveItem(e, 'image', x.id)}>
                <div className="handle l" onPointerDown={(e) => resizeItem(e, 'image', x.id, 'l')} />
                <span>{x.asset.replace(/^img-/, '')}</span>
                <div className="handle r" onPointerDown={(e) => resizeItem(e, 'image', x.id, 'r')} />
              </div>
            ))}
          </div>

          <div className="tl-row" style={{ height: ROW_H }}>
            {doc.music && (
              <div className={'blk mus' + (isSel('music', 'music') ? ' sel' : '')} style={{ left: 0, width: dur * pps }} onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: 'music', id: 'music' }) }}>
                <span>♪ {doc.music.title}</span>
              </div>
            )}
          </div>

          <div className="tl-row" style={{ height: ROW_H }}>
            {doc.zoom.map((k, i) => (
              <div key={i} className={'zkey' + (isSel('zoom', String(i)) ? ' sel' : '')} style={{ left: k.t * pps - 7 }} onPointerDown={(e) => moveZoom(e, i)} title={`Zoom ${k.scale.toFixed(2)}× at ${k.t.toFixed(1)}s`} />
            ))}
          </div>

          <div className="playhead" style={{ left: t * pps }} />
        </div>
      </div>
    </div>
  )
}

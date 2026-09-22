import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  DEFAULT_CAPTION_STYLE,
  EFFECTS,
  FONT_CHOICES,
  buildPhrases,
  outToSrc,
  outputDuration,
  uid,
  type ClipDoc,
  type ClipRecord,
  type EffectName,
  type HardwareInfo,
  type MusicTrack,
  type ProjectSummary
} from '@shared/types'
import { captionWordsFor } from '@shared/docbuild'
import { PreviewSurface, musicUrl, usePlayback } from './player'
import { useDocHistory } from './useDocHistory'
import Timeline, { type Selection } from './Timeline'
import ExportDialog from './ExportDialog'
import { formatDuration, timeAgo } from './format'
import { Icon, type IconName } from './Icon'

type Tab = 'clip' | 'captions' | 'text' | 'images' | 'music' | 'effects' | 'audio'
const TABS: [Tab, string, IconName][] = [['clip', 'Clip', 'film'], ['captions', 'Captions', 'type'], ['text', 'Text', 'edit'], ['images', 'Images', 'image'], ['music', 'Music', 'music'], ['effects', 'Effects', 'sparkles'], ['audio', 'Audio', 'volume']]
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

export default function Editor(props: { clipId: string; project: ProjectSummary; hardware: HardwareInfo | null; onBack: () => void }): ReactElement {
  const [clip, setClip] = useState<ClipRecord | null | undefined>(undefined)
  useEffect(() => {
    void window.reelforge.getClip(props.clipId).then(setClip)
  }, [props.clipId])
  if (clip === undefined) return <div className="page"><p className="muted">Loading clip…</p></div>
  if (clip === null) return <div className="page"><p>This clip no longer exists.</p><button onClick={props.onBack}>Back</button></div>
  return <EditorInner key={clip.id} clip={clip} {...props} />
}

function EditorInner({ clip, project, hardware, onBack }: { clip: ClipRecord; project: ProjectSummary; hardware: HardwareInfo | null; onBack: () => void }): ReactElement {
  const H = useDocHistory(clip.doc)
  const { doc, edit } = H
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pb = usePlayback(doc, videoRef, audioRef, { loop: false })
  const [tab, setTab] = useState<Tab>('clip')
  const [sel, setSel] = useState<Selection>(null)
  const [pps, setPps] = useState(26)
  const [showExport, setShowExport] = useState(false)
  const [recover, setRecover] = useState<ClipDoc | null>(clip.autosave)
  const [status, setStatus] = useState('')
  const dur = outputDuration(doc)
  const src = project.source

  // ---------------------------------------------------------------- save / autosave / recovery
  const save = useCallback(async (checkpoint = true) => {
    await window.reelforge.saveClip(clip.id, H.docRef.current, { checkpoint })
    H.markSaved()
    setStatus('Saved')
    setTimeout(() => setStatus(''), 1800)
  }, [clip.id, H])

  const dirtyRef = useRef(false)
  dirtyRef.current = H.dirty
  const lastAuto = useRef<ClipDoc | null>(null)
  useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current && lastAuto.current !== H.docRef.current) {
        lastAuto.current = H.docRef.current
        void window.reelforge.autosaveClip(clip.id, H.docRef.current)
      }
    }, 4000)
    const flush = (): void => {
      if (dirtyRef.current) void window.reelforge.autosaveClip(clip.id, H.docRef.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      clearInterval(id)
      window.removeEventListener('beforeunload', flush)
      flush() // leaving the editor with unsaved edits keeps them recoverable
    }
  }, [clip.id, H])

  // ---------------------------------------------------------------- editing operations
  const srcAtPlayhead = (): number => outToSrc(doc, pb.t)?.src ?? 0

  const split = (): void => {
    const m = outToSrc(doc, pb.t)
    if (!m) return
    const s = doc.segments[m.index]
    if (m.src - s.srcStart < 0.2 || s.srcEnd - m.src < 0.2) return setStatus('Move the playhead inside a clip to split it')
    edit((d) => {
      const seg = d.segments[m.index]
      d.segments.splice(m.index, 1, { id: uid(), srcStart: seg.srcStart, srcEnd: m.src }, { id: uid(), srcStart: m.src, srcEnd: seg.srcEnd })
    })
  }

  const removeSelected = (): void => {
    if (!sel) return
    if (sel.kind === 'segment') {
      if (doc.segments.length <= 1) return setStatus("A clip needs at least one video segment")
      edit((d) => { d.segments = d.segments.filter((s) => s.id !== sel.id) })
    } else if (sel.kind === 'text') edit((d) => { d.texts = d.texts.filter((x) => x.id !== sel.id) })
    else if (sel.kind === 'image') edit((d) => { d.images = d.images.filter((x) => x.id !== sel.id) })
    else if (sel.kind === 'zoom') edit((d) => { d.zoom.splice(Number(sel.id), 1) })
    else if (sel.kind === 'music') edit((d) => { d.music = null })
    setSel(null)
  }

  const duplicateSelected = (): void => {
    if (!sel) return
    if (sel.kind === 'segment') edit((d) => { const i = d.segments.findIndex((s) => s.id === sel.id); if (i >= 0) d.segments.splice(i + 1, 0, { ...d.segments[i], id: uid() }) })
    else if (sel.kind === 'text') edit((d) => { const x = d.texts.find((t) => t.id === sel.id); if (x) d.texts.push({ ...x, id: uid(), start: x.start + 0.5, end: x.end + 0.5 }) })
    else if (sel.kind === 'image') edit((d) => { const x = d.images.find((t) => t.id === sel.id); if (x) d.images.push({ ...x, id: uid(), start: x.start + 0.5, end: x.end + 0.5 }) })
  }

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (showExport) return // the export dialog owns the keyboard while it is open
      const el = e.target as HTMLElement
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? H.redo() : H.undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); H.redo(); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return }
      if (typing) return
      if (e.code === 'Space') { e.preventDefault(); pb.toggle() }
      else if (e.key.toLowerCase() === 's') split()
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected()
      else if (e.key === 'ArrowLeft') pb.seek(pb.t - (e.shiftKey ? 1 : 1 / 30))
      else if (e.key === 'ArrowRight') pb.seek(pb.t + (e.shiftKey ? 1 : 1 / 30))
      else if (e.key === 'Home') pb.seek(0)
      else if (e.key === 'End') pb.seek(dur)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onSelect = (s: Selection): void => {
    setSel(s)
    if (!s) return
    if (s.kind === 'text') setTab('text')
    else if (s.kind === 'image') setTab('images')
    else if (s.kind === 'music') setTab('music')
    else if (s.kind === 'zoom') setTab('effects')
    else if (s.kind === 'captions') setTab('captions')
  }

  const setPan = (cx: number): void =>
    edit((d) => {
      const t = outToSrc(d, pb.t)?.src ?? 0
      d.reframe.mode = 'track'
      d.reframe.keys = d.reframe.keys.filter((k) => Math.abs(k.t - t) > 0.2)
      d.reframe.keys.push({ t, cx })
      d.reframe.keys.sort((a, b) => a.t - b.t)
    }, 'pan')

  return (
    <div className="editor">
      <div className="toolbar">
        <button className="ghost" onClick={async () => { if (H.dirty) await save(false); onBack() }}><Icon name="back" size={16} /> Back</button>
        <span className="sep" />
        <div className="tb-title">{doc.meta.title || 'Untitled clip'} <span className="chip">Version {clip.label}</span></div>
        <div className="tb-spacer" />
        <button className="iconbtn ghost" title="Undo (Ctrl+Z)" disabled={!H.canUndo} onClick={H.undo}><Icon name="undo" /></button>
        <button className="iconbtn ghost" title="Redo (Ctrl+Shift+Z)" disabled={!H.canRedo} onClick={H.redo}><Icon name="redo" /></button>
        <span className="sep" />
        <button className="ghost" title="Split at playhead (S)" onClick={split}><Icon name="scissors" size={16} /> Split</button>
        <button className="iconbtn ghost" title="Duplicate (Ctrl+D)" disabled={!sel} onClick={duplicateSelected}><Icon name="copy" size={16} /></button>
        <button className="iconbtn ghost" title="Delete (Del)" disabled={!sel} onClick={removeSelected}><Icon name="trash" size={16} /></button>
        <span className="sep" />
        <span className={'save-state' + (H.dirty && !status ? ' dirty' : '')}>{status || (H.dirty ? 'Unsaved changes' : 'All changes saved')}</span>
        <button title="Save (Ctrl+S)" onClick={() => save()}><Icon name="save" size={15} /> Save</button>
        <button className="primary" onClick={() => setShowExport(true)}><Icon name="download" size={15} /> Export</button>
      </div>

      {recover && (
        <div className="banner">
          We recovered unsaved changes from your last session.
          <button onClick={() => { H.reset(recover, true); setRecover(null) }}>Restore them</button>
          <button onClick={() => { void window.reelforge.discardAutosave(clip.id); setRecover(null) }}>Discard</button>
        </div>
      )}

      <div className="ed-main">
        <div className="ed-tools">
          <div className="tabs">
            {TABS.map(([id, label, icon]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon name={icon} size={19} />{label}</button>
            ))}
          </div>
          <div className="panel">
            {tab === 'clip' && <ClipPanel clip={clip} doc={doc} edit={edit} pbT={pb.t} setPan={setPan} srcT={srcAtPlayhead()} onRestore={(d) => H.reset(d, true)} />}
            {tab === 'captions' && <CaptionsPanel project={project} doc={doc} edit={edit} t={pb.t} seek={pb.seek} />}
            {tab === 'text' && <TextPanel doc={doc} edit={edit} t={pb.t} dur={dur} sel={sel} setSel={setSel} />}
            {tab === 'images' && <ImagesPanel project={project} doc={doc} edit={edit} t={pb.t} dur={dur} sel={sel} setSel={setSel} />}
            {tab === 'music' && <MusicPanel project={project} doc={doc} edit={edit} />}
            {tab === 'effects' && <EffectsPanel doc={doc} edit={edit} t={pb.t} dur={dur} sel={sel} setSel={setSel} />}
            {tab === 'audio' && <AudioPanel doc={doc} edit={edit} />}
          </div>
        </div>

        <div className="ed-preview">
          <div className="stage">
            <PreviewSurface
              projectId={project.id}
              source={src}
              doc={doc}
              t={pb.t}
              videoRef={videoRef}
              interactive
              selectedId={sel?.id}
              onVideoReady={() => pb.seek(0)}
              onPanCamera={setPan}
              onMoveText={(id, x, y) => edit((d) => { const t = d.texts.find((z) => z.id === id); if (t) { t.x = x; t.y = y } }, `mv:${id}`)}
              onMoveImage={(id, x, y) => edit((d) => { const t = d.images.find((z) => z.id === id); if (t) { t.x = x; t.y = y } }, `mv:${id}`)}
              onMoveCaptions={(y) => edit((d) => { d.captions.style.y = y }, 'capy')}
              onSelect={(kind, id) => onSelect({ kind, id })}
            />
            {doc.music?.trackId && <audio ref={audioRef} src={musicUrl(doc.music.trackId)} loop preload="auto" />}
          </div>
          <div className="transport">
            <button className="iconbtn ghost" onClick={() => pb.seek(0)} title="Start (Home)"><Icon name="first" size={16} fill /></button>
            <button className="primary playbtn" onClick={pb.toggle} title="Play / pause (Space)"><Icon name={pb.playing ? 'pause' : 'play'} size={20} fill /></button>
            <span className="time"><b>{formatDuration(pb.t)}</b> / {formatDuration(dur)}</span>
            <label className="zoomctl">Zoom <input type="range" min={8} max={140} value={pps} onChange={(e) => setPps(Number(e.target.value))} /></label>
          </div>
          <div className="muted small hint">Drag the video to reposition the camera · drag text, images and captions in the preview · Space plays · S splits</div>
        </div>
      </div>

      <Timeline doc={doc} t={pb.t} sourceDuration={src.duration} pps={pps} selection={sel} onSelect={onSelect} onSeek={pb.seek} edit={edit} playing={pb.playing} />

      {showExport && (
        <ExportDialog
          clipId={clip.id}
          doc={doc}
          hardware={hardware}
          beforeExport={() => save(true)}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}

/* ================================================================== panels */

type Edit = (fn: (d: ClipDoc) => void, key?: string) => void

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return <label className="frow"><span>{label}</span>{children}</label>
}

function Num({ value, onChange, step = 0.1, min, max, w = 70 }: { value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; w?: number }): ReactElement {
  return <input type="number" style={{ width: w }} value={Number(value.toFixed(3))} step={step} min={min} max={max} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(min !== undefined && max !== undefined ? clamp(n, min, max) : n) }} />
}

/* ---------------------------------------------------------------- clip */
function ClipPanel({ clip, doc, edit, setPan, srcT, onRestore }: { clip: ClipRecord; doc: ClipDoc; edit: Edit; pbT: number; setPan: (cx: number) => void; srcT: number; onRestore: (d: ClipDoc) => void }): ReactElement {
  const [cps, setCps] = useState<{ id: number; createdAt: number }[]>([])
  useEffect(() => { void window.reelforge.listCheckpoints(clip.id).then(setCps) }, [clip.id])
  const cxNow = useMemo(() => {
    const keys = doc.reframe.keys
    if (!keys.length) return 0.5
    const a = [...keys].sort((x, y) => x.t - y.t)
    if (srcT <= a[0].t) return a[0].cx
    for (let i = 1; i < a.length; i++) if (srcT <= a[i].t) return a[i - 1].cx + ((a[i].cx - a[i - 1].cx) * (srcT - a[i - 1].t)) / Math.max(1e-6, a[i].t - a[i - 1].t)
    return a[a.length - 1].cx
  }, [doc.reframe.keys, srcT])
  return (
    <>
      <h3>Details</h3>
      <p className="muted small">Everything here was written by the AI from what is actually said. Edit anything.</p>
      <Row label="Title"><input value={doc.meta.title} onChange={(e) => edit((d) => { d.meta.title = e.target.value }, 'meta')} /></Row>
      <Row label="Hook"><textarea rows={2} value={doc.meta.hook} onChange={(e) => edit((d) => { d.meta.hook = e.target.value }, 'meta')} /></Row>
      <Row label="Description"><textarea rows={3} value={doc.meta.caption} onChange={(e) => edit((d) => { d.meta.caption = e.target.value }, 'meta')} /></Row>
      <Row label="Hashtags"><input value={doc.meta.hashtags.map((h) => '#' + h).join(' ')} onChange={(e) => edit((d) => { d.meta.hashtags = e.target.value.split(/[\s,]+/).map((h) => h.replace(/^#/, '').toLowerCase()).filter(Boolean) }, 'meta')} /></Row>
      <div className="row">
        <button onClick={() => void navigator.clipboard.writeText(`${doc.meta.caption}\n\n${doc.meta.hashtags.map((h) => '#' + h).join(' ')}`)}>Copy description + hashtags</button>
      </div>
      {clip.reason && <p className="muted small"><b>Why the AI picked this:</b> {clip.reason}</p>}

      <h3>Camera</h3>
      <Row label="Framing">
        <select value={doc.reframe.mode === 'center' ? 'center' : 'track'} onChange={(e) => edit((d) => { d.reframe.mode = e.target.value as 'track' | 'center' })}>
          <option value="track">Follow the speaker</option>
          <option value="center">Fixed centre crop</option>
        </select>
      </Row>
      <Row label={`Position at playhead: ${Math.round(cxNow * 100)}%`}>
        <input type="range" min={0} max={1} step={0.005} value={cxNow} onChange={(e) => setPan(Number(e.target.value))} />
      </Row>
      <p className="muted small">You can also drag the video in the preview. Movement smooths between the points you set.</p>

      <h3>Version history</h3>
      {cps.length === 0 ? <p className="muted small">Checkpoints are saved each time you press Save.</p> : (
        <ul className="plain">
          {cps.slice(0, 8).map((c) => (
            <li key={c.id}>
              <span className="muted small">{timeAgo(c.createdAt)}</span>
              <button className="small" onClick={async () => { const d = await window.reelforge.restoreCheckpoint(clip.id, c.id); if (d) onRestore(d) }}>Restore</button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ---------------------------------------------------------------- captions */
function CaptionsPanel({ project, doc, edit, t, seek }: { project: ProjectSummary; doc: ClipDoc; edit: Edit; t: number; seek: (t: number) => void }): ReactElement {
  const st = doc.captions.style
  const setStyle = <K extends keyof typeof st>(k: K, v: (typeof st)[K]): void => edit((d) => { d.captions.style[k] = v }, `cap:${String(k)}`)
  const { phrases } = useMemo(() => buildPhrases(doc), [doc])
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Row label="Captions"><input type="checkbox" checked={doc.captions.enabled} onChange={(e) => edit((d) => { d.captions.enabled = e.target.checked })} /></Row>
      <Row label="Font"><select value={st.font} onChange={(e) => setStyle('font', e.target.value)}>{FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}</select></Row>
      <Row label={`Size ${st.size}`}><input type="range" min={40} max={160} value={st.size} onChange={(e) => setStyle('size', Number(e.target.value))} /></Row>
      <Row label={`Position ${Math.round(st.y * 100)}%`}><input type="range" min={5} max={95} value={st.y * 100} onChange={(e) => setStyle('y', Number(e.target.value) / 100)} /></Row>
      <Row label="Text colour"><input type="color" value={st.color} onChange={(e) => setStyle('color', e.target.value)} /></Row>
      <Row label="Highlight"><input type="color" value={st.highlightColor} onChange={(e) => setStyle('highlightColor', e.target.value)} /></Row>
      <Row label="Word highlight"><input type="checkbox" checked={st.highlightWord} onChange={(e) => setStyle('highlightWord', e.target.checked)} /></Row>
      <Row label="Outline colour"><input type="color" value={st.outlineColor} onChange={(e) => setStyle('outlineColor', e.target.value)} /></Row>
      <Row label={`Outline ${st.outline}`}><input type="range" min={0} max={16} value={st.outline} onChange={(e) => setStyle('outline', Number(e.target.value))} /></Row>
      <Row label="Background box">
        <input type="checkbox" checked={st.background !== null} onChange={(e) => setStyle('background', e.target.checked ? '#000000' : null)} />
        {st.background !== null && <input type="color" value={st.background} onChange={(e) => setStyle('background', e.target.value)} />}
      </Row>
      <Row label="Alignment"><select value={st.align} onChange={(e) => setStyle('align', e.target.value as typeof st.align)}><option value="center">Centre</option><option value="left">Left</option><option value="right">Right</option></select></Row>
      <Row label={`Words per line ${st.wordsPerLine}`}><input type="range" min={1} max={6} value={st.wordsPerLine} onChange={(e) => setStyle('wordsPerLine', Number(e.target.value))} /></Row>
      <Row label="Animation"><select value={st.animation} onChange={(e) => setStyle('animation', e.target.value as typeof st.animation)}><option value="pop">Pop</option><option value="none">None</option></select></Row>
      <Row label="UPPERCASE"><input type="checkbox" checked={st.uppercase} onChange={(e) => setStyle('uppercase', e.target.checked)} /></Row>
      <div className="row">
        <button onClick={() => edit((d) => { d.captions.style = { ...DEFAULT_CAPTION_STYLE } })}>Reset style</button>
        <button
          disabled={busy}
          title="Rebuild captions from the transcript for the current cuts. Your text edits will be replaced."
          onClick={async () => {
            if (!confirm('Rebuild captions from the transcript? Your caption text edits will be replaced.')) return
            setBusy(true)
            const tr = await window.reelforge.getTranscript(project.id)
            if (tr) edit((d) => { d.captions.words = captionWordsFor(d.segments, tr) })
            setBusy(false)
          }}
        >Rebuild from transcript</button>
      </div>

      <h3>Edit captions</h3>
      <p className="muted small">Fix wrong words here. Captions must match what was said, so only correct mistakes.</p>
      <div className="wordlist">
        {phrases.map((ph, i) => (
          <div key={i} className={'phrase' + (t >= ph.start && t < ph.end ? ' now' : '')}>
            <button className="small" onClick={() => seek(ph.start + 0.01)}>{formatDuration(ph.start)}</button>
            {ph.words.map((w) => (
              <span key={w.id} className="wedit">
                <input value={w.text} size={Math.max(2, w.text.length)} onChange={(e) => edit((d) => { const x = d.captions.words.find((z) => z.id === w.id); if (x) x.text = e.target.value }, `w:${w.id}`)} />
                <button className="x" title="Remove word" onClick={() => edit((d) => { d.captions.words = d.captions.words.filter((z) => z.id !== w.id) })}>×</button>
              </span>
            ))}
            <span className="nudge">
              <button className="small" title="Show earlier" onClick={() => edit((d) => { for (const w of ph.words) { const x = d.captions.words.find((z) => z.id === w.id); if (x) { x.start -= 0.1; x.end -= 0.1 } } })}>−0.1s</button>
              <button className="small" title="Show later" onClick={() => edit((d) => { for (const w of ph.words) { const x = d.captions.words.find((z) => z.id === w.id); if (x) { x.start += 0.1; x.end += 0.1 } } })}>+0.1s</button>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- text */
function TextPanel({ doc, edit, t, dur, sel, setSel }: { doc: ClipDoc; edit: Edit; t: number; dur: number; sel: Selection; setSel: (s: Selection) => void }): ReactElement {
  const cur = sel?.kind === 'text' ? doc.texts.find((x) => x.id === sel.id) : undefined
  const upd = (fn: (x: ClipDoc['texts'][number]) => void): void => edit((d) => { const x = d.texts.find((z) => z.id === cur?.id); if (x) fn(x) }, `text:${cur?.id}`)
  return (
    <>
      <button className="primary" onClick={() => {
        const id = uid()
        edit((d) => { d.texts.push({ id, text: 'Your text', start: t, end: Math.min(dur, t + 3), x: 0.5, y: 0.2, size: 72, font: 'Arial Black', color: '#FFFFFF', outlineColor: '#000000', outline: 6, bold: true, animation: 'pop' }) })
        setSel({ kind: 'text', id })
      }}>+ Add text at playhead</button>
      <ul className="plain">
        {doc.texts.map((x) => (
          <li key={x.id} className={cur?.id === x.id ? 'on' : ''} onClick={() => setSel({ kind: 'text', id: x.id })}>{x.text}</li>
        ))}
      </ul>
      {cur ? (
        <>
          <Row label="Text"><textarea rows={2} value={cur.text} onChange={(e) => upd((x) => { x.text = e.target.value })} /></Row>
          <Row label="Font"><select value={cur.font} onChange={(e) => upd((x) => { x.font = e.target.value })}>{FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}</select></Row>
          <Row label={`Size ${cur.size}`}><input type="range" min={24} max={200} value={cur.size} onChange={(e) => upd((x) => { x.size = Number(e.target.value) })} /></Row>
          <Row label="Colour"><input type="color" value={cur.color} onChange={(e) => upd((x) => { x.color = e.target.value })} /></Row>
          <Row label="Outline"><input type="color" value={cur.outlineColor} onChange={(e) => upd((x) => { x.outlineColor = e.target.value })} /><Num value={cur.outline} step={1} min={0} max={20} onChange={(n) => upd((x) => { x.outline = n })} /></Row>
          <Row label="Animation"><select value={cur.animation} onChange={(e) => upd((x) => { x.animation = e.target.value as typeof cur.animation })}><option value="none">None</option><option value="fade">Fade</option><option value="pop">Pop</option><option value="slide">Slide up</option></select></Row>
          <Row label="Timing (s)"><Num value={cur.start} min={0} max={dur} onChange={(n) => upd((x) => { x.start = Math.min(n, x.end - 0.2) })} /><Num value={cur.end} min={0} max={dur} onChange={(n) => upd((x) => { x.end = Math.max(n, x.start + 0.2) })} /></Row>
          <p className="muted small">Drag the text in the preview to position it.</p>
        </>
      ) : <p className="muted small">Select or add a text layer to edit it.</p>}
    </>
  )
}

/* ---------------------------------------------------------------- images */
function ImagesPanel({ project, doc, edit, t, dur, sel, setSel }: { project: ProjectSummary; doc: ClipDoc; edit: Edit; t: number; dur: number; sel: Selection; setSel: (s: Selection) => void }): ReactElement {
  const cur = sel?.kind === 'image' ? doc.images.find((x) => x.id === sel.id) : undefined
  const upd = (fn: (x: ClipDoc['images'][number]) => void): void => edit((d) => { const x = d.images.find((z) => z.id === cur?.id); if (x) fn(x) }, `img:${cur?.id}`)
  return (
    <>
      <button className="primary" onClick={async () => {
        const name = await window.reelforge.pickImage(project.id)
        if (!name) return
        const id = uid()
        edit((d) => { d.images.push({ id, asset: name, start: t, end: Math.min(dur, t + 4), x: 0.5, y: 0.35, width: 0.4, opacity: 1 }) })
        setSel({ kind: 'image', id })
      }}>+ Add image</button>
      <ul className="plain">
        {doc.images.map((x) => <li key={x.id} className={cur?.id === x.id ? 'on' : ''} onClick={() => setSel({ kind: 'image', id: x.id })}>{x.asset.replace(/^img-/, '')}</li>)}
      </ul>
      {cur ? (
        <>
          <Row label={`Width ${Math.round(cur.width * 100)}%`}><input type="range" min={5} max={100} value={cur.width * 100} onChange={(e) => upd((x) => { x.width = Number(e.target.value) / 100 })} /></Row>
          <Row label={`Opacity ${Math.round(cur.opacity * 100)}%`}><input type="range" min={5} max={100} value={cur.opacity * 100} onChange={(e) => upd((x) => { x.opacity = Number(e.target.value) / 100 })} /></Row>
          <Row label="Timing (s)"><Num value={cur.start} min={0} max={dur} onChange={(n) => upd((x) => { x.start = Math.min(n, x.end - 0.2) })} /><Num value={cur.end} min={0} max={dur} onChange={(n) => upd((x) => { x.end = Math.max(n, x.start + 0.2) })} /></Row>
          <p className="muted small">Drag the image in the preview to position it.</p>
        </>
      ) : <p className="muted small">Add a logo, sticker or screenshot on top of the video.</p>}
    </>
  )
}

/* ---------------------------------------------------------------- music */
function MusicPanel({ project, doc, edit }: { project: ProjectSummary; doc: ClipDoc; edit: Edit }): ReactElement {
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [cat, setCat] = useState('all')
  const [playing, setPlaying] = useState<string | null>(null)
  const prev = useRef<HTMLAudioElement | null>(null)
  useEffect(() => { void window.reelforge.listMusic(project.id).then(setTracks) }, [project.id])
  useEffect(() => () => prev.current?.pause(), [])
  const cats = ['all', ...Array.from(new Set(tracks.map((t) => t.category)))]
  const list = tracks.filter((t) => cat === 'all' || t.category === cat)
  const m = doc.music

  const preview = (t: MusicTrack): void => {
    prev.current?.pause()
    if (playing === t.id) return setPlaying(null)
    const a = new Audio(musicUrl(t.id))
    a.volume = 0.6
    a.onended = () => setPlaying(null)
    void a.play()
    prev.current = a
    setPlaying(t.id)
  }
  const use = (t: MusicTrack): void => edit((d) => { d.music = { trackId: t.id, title: t.title, volume: d.music?.volume ?? 0.25, fadeIn: d.music?.fadeIn ?? 0.8, fadeOut: d.music?.fadeOut ?? 1.5, ducking: d.music?.ducking ?? true, offset: 0 } })
  const upd = (fn: (x: NonNullable<ClipDoc['music']>) => void): void => edit((d) => { if (d.music) fn(d.music) }, 'music')

  return (
    <>
      {m && (
        <div className="card" style={{ padding: 12 }}>
          <b>♪ {m.title}</b>
          <Row label={`Music volume ${Math.round(m.volume * 100)}%`}><input type="range" min={0} max={100} value={m.volume * 100} onChange={(e) => upd((x) => { x.volume = Number(e.target.value) / 100 })} /></Row>
          <Row label={`Fade in ${m.fadeIn.toFixed(1)}s`}><input type="range" min={0} max={5} step={0.1} value={m.fadeIn} onChange={(e) => upd((x) => { x.fadeIn = Number(e.target.value) })} /></Row>
          <Row label={`Fade out ${m.fadeOut.toFixed(1)}s`}><input type="range" min={0} max={5} step={0.1} value={m.fadeOut} onChange={(e) => upd((x) => { x.fadeOut = Number(e.target.value) })} /></Row>
          <Row label="Start at (s)"><Num value={m.offset} min={0} max={600} step={1} onChange={(n) => upd((x) => { x.offset = n })} /></Row>
          <Row label="Lower music when speaking"><input type="checkbox" checked={m.ducking} onChange={(e) => upd((x) => { x.ducking = e.target.checked })} /></Row>
          <button className="danger small" onClick={() => edit((d) => { d.music = null })}>Remove music</button>
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        {cats.map((c) => <button key={c} className={'small' + (cat === c ? ' primary' : '')} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <ul className="plain tracks">
        {list.map((t) => (
          <li key={t.id} className={m?.trackId === t.id ? 'on' : ''}>
            <button className="small" onClick={() => preview(t)}>{playing === t.id ? '❚❚' : '▶'}</button>
            <span className="grow"><b>{t.title}</b><br /><span className="muted small">{t.category}{t.bpm ? ` · ${t.bpm} BPM` : ''}{t.duration ? ` · ${formatDuration(t.duration)}` : ''}</span></span>
            <button className="small" onClick={() => use(t)}>Use</button>
          </li>
        ))}
      </ul>
      <button onClick={async () => { const t = await window.reelforge.pickMusic(project.id); if (t) { setTracks(await window.reelforge.listMusic(project.id)); use(t) } }}>+ Add your own music</button>
      <p className="muted small">Built-in tracks are original Clip Culture compositions (CC0, free for any use). Tracks you add are your responsibility.</p>
    </>
  )
}

/* ---------------------------------------------------------------- effects / transitions / zoom */
function EffectsPanel({ doc, edit, t, dur, sel, setSel }: { doc: ClipDoc; edit: Edit; t: number; dur: number; sel: Selection; setSel: (s: Selection) => void }): ReactElement {
  const tr = doc.transitions
  const zi = sel?.kind === 'zoom' ? Number(sel.id) : -1
  const sortZ = (d: ClipDoc): void => { d.zoom.sort((a, b) => a.t - b.t) }
  return (
    <>
      <h3>Look</h3>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {EFFECTS.map((e) => <button key={e.id} className={'small' + (doc.effect === e.id ? ' primary' : '')} onClick={() => edit((d) => { d.effect = e.id as EffectName })}>{e.label}</button>)}
      </div>

      <h3>Transitions</h3>
      <Row label="Start"><select value={tr.intro} onChange={(e) => edit((d) => { d.transitions.intro = e.target.value as typeof tr.intro })}><option value="none">None</option><option value="fade">Fade from black</option><option value="zoom">Zoom in</option></select></Row>
      <Row label="End"><select value={tr.outro} onChange={(e) => edit((d) => { d.transitions.outro = e.target.value as typeof tr.outro })}><option value="none">None</option><option value="fade">Fade to black</option></select></Row>
      <Row label="Between cuts"><select value={tr.between} onChange={(e) => edit((d) => { d.transitions.between = e.target.value as typeof tr.between })}><option value="none">Hard cut</option><option value="crossfade">Crossfade</option><option value="dip">Dip to black</option></select></Row>
      <Row label={`Length ${tr.duration.toFixed(1)}s`}><input type="range" min={0.1} max={1} step={0.05} value={tr.duration} onChange={(e) => edit((d) => { d.transitions.duration = Number(e.target.value) }, 'tdur')} /></Row>

      <h3>Zoom</h3>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="small" onClick={() => edit((d) => { const a = Math.min(t, Math.max(0, dur - 0.5)); d.zoom.push({ t: a, scale: 1 }, { t: a + 0.35, scale: 1.3 }, { t: Math.min(dur, a + 2.4), scale: 1.3 }, { t: Math.min(dur, a + 2.8), scale: 1 }); sortZ(d) })}>Punch-in here (2 s)</button>
        <button className="small" onClick={() => edit((d) => { d.zoom = [{ t: 0, scale: 1 }, { t: dur, scale: 1.15 }] })}>Slow push-in</button>
        <button className="small" onClick={() => edit((d) => { d.zoom = [] })}>Clear</button>
      </div>
      <ul className="plain">
        {doc.zoom.map((k, i) => (
          <li key={i} className={zi === i ? 'on' : ''} onClick={() => setSel({ kind: 'zoom', id: String(i) })}>
            <span className="muted small">{k.t.toFixed(1)}s</span>
            <Num value={k.scale} step={0.05} min={1} max={3} w={64} onChange={(n) => edit((d) => { d.zoom[i].scale = n }, `z${i}`)} />×
            <button className="x" onClick={(e) => { e.stopPropagation(); edit((d) => { d.zoom.splice(i, 1) }) }}>×</button>
          </li>
        ))}
      </ul>
      <p className="muted small">Zoom keyframes also appear on the timeline; drag them to retime.</p>
    </>
  )
}

/* ---------------------------------------------------------------- audio */
function AudioPanel({ doc, edit }: { doc: ClipDoc; edit: Edit }): ReactElement {
  return (
    <>
      <Row label={`Video volume ${Math.round(doc.audio.videoVolume * 100)}%`}><input type="range" min={0} max={100} value={doc.audio.videoVolume * 100} onChange={(e) => edit((d) => { d.audio.videoVolume = Number(e.target.value) / 100 }, 'vol')} /></Row>
      <Row label="Mute video audio"><input type="checkbox" checked={doc.audio.mute} onChange={(e) => edit((d) => { d.audio.mute = e.target.checked })} /></Row>
      <p className="muted small">Music has its own volume, fades and speech ducking in the Music tab. To trim the audio, trim the video segments on the timeline; sound and picture stay in sync.</p>
    </>
  )
}

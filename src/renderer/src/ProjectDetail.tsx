import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { AnalysisUpdate, ClipRecord, HardwareInfo, ProjectSummary, Transcript } from '@shared/types'
import { ErrorBox, SourceDetails } from './common'
import { Icon } from './Icon'
import Highlights from './Highlights'
import { formatDuration } from './format'

export default function ProjectDetail(props: {
  p: ProjectSummary
  hardware: HardwareInfo | null
  onBack: () => void
  onEdit: (clipId: string) => void
  onChanged: () => void
}): ReactElement {
  const { p } = props
  const [update, setUpdate] = useState<AnalysisUpdate | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [clips, setClips] = useState<ClipRecord[]>([])
  const [hasTranscript, setHasTranscript] = useState(p.hasTranscript)
  const running = update?.running ?? false

  const loadClips = useCallback(async () => setClips(await window.reelforge.listClips(p.id)), [p.id])
  const loadTranscript = useCallback(async () => setTranscript(await window.reelforge.getTranscript(p.id)), [p.id])

  useEffect(() => {
    void loadClips()
    void window.reelforge.getAnalysisState(p.id).then((s) => s && setUpdate(s))
    if (p.hasTranscript) void loadTranscript()
    return window.reelforge.onAnalysisUpdate((u) => {
      if (u.projectId !== p.id) return
      setUpdate(u)
      if (u.finished || u.error || u.cancelled) {
        void loadClips()
        props.onChanged()
      }
      if (u.finished) {
        setHasTranscript(true)
        void loadTranscript()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id])

  /** resume = continue where it stopped; highlights = search for highlights again; full = redo everything */
  const start = (mode: 'resume' | 'highlights' | 'full' = 'resume'): void => {
    if (mode === 'highlights' && clips.length > 0 && !confirm('This replaces the current highlights (and any edits you made to them) with a fresh search. The transcript is reused, so it is much faster than a full analysis. Continue?')) return
    if (mode === 'full' && clips.length > 0 && !confirm('This throws away the current clips and your edits, and analyzes the video again from scratch. Continue?')) return
    setUpdate(null)
    void window.reelforge.analyzeProject(p.id, { force: mode === 'full', redoHighlights: mode === 'highlights' })
  }
  const groupCount = new Set(clips.map((c) => c.groupId)).size

  const analyzed = hasTranscript && (clips.length > 0 || (update?.finished ?? false))
  const noHighlights = update?.finished && clips.length === 0

  return (
    <div className="page wide">
      <button className="link" onClick={props.onBack}><Icon name="back" size={16} /> Projects</button>
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <div className="pmeta" style={{ marginTop: 12 }}>
            {running ? <span className="chip busy">Analyzing…</span> : groupCount > 0 ? <span className="chip ok"><Icon name="check" size={12} /> {groupCount} highlight{groupCount === 1 ? '' : 's'}</span> : <span className="chip">Not analyzed yet</span>}
            <span className="chip">{formatDuration(p.source.duration)}</span>
            <span className="chip">{p.source.width}×{p.source.height}</span>
          </div>
        </div>
      </div>

      <div className="card import-card">
        <SourceDetails source={p.source} thumbnail={p.thumbnail} />
        <div className="row wrap">
          {!analyzed || running ? (
            <button className="primary" disabled={running} onClick={() => start('resume')}><Icon name="sparkles" size={16} /> {running ? 'Analyzing…' : 'Analyze Video'}</button>
          ) : (
            <>
              <button className={groupCount < 10 ? 'primary' : ''} onClick={() => start('highlights')}><Icon name="refresh" size={16} /> Find highlights again</button>
              <button onClick={() => start('full')}>Analyze from scratch</button>
            </>
          )}
          <button className="ghost" onClick={() => window.reelforge.revealProject(p.id)}><Icon name="folder" size={16} /> Open project folder</button>
        </div>
        <p className="muted small">
          Analysis runs entirely on this PC: it transcribes the speech, finds the best moments, and frames them vertically. Your original video is only referenced, never copied or modified.
        </p>
      </div>

      {update && (running || update.error || update.cancelled) && (
        <AnalysisPanel u={update} onCancel={() => window.reelforge.cancelAnalysis(p.id)} onRetry={() => start('resume')} />
      )}

      {clips.length > 0 && (
        <>
          <h2 style={{ marginTop: 8 }}>Your highlights · {groupCount}</h2>
          {groupCount < 10 && !running && (
            <p className="muted small" style={{ marginTop: -6, marginBottom: 16 }}>
              Only {groupCount} highlight{groupCount === 1 ? '' : 's'} so far. Press <b>Find highlights again</b> to search for more (each is at least 30 seconds).
            </p>
          )}
          <Highlights project={p} clips={clips} hardware={props.hardware} busy={running} onEdit={props.onEdit} onChanged={() => { void loadClips(); props.onChanged() }} />
        </>
      )}
      {noHighlights && (
        <div className="card"><b>No strong standalone moments were found.</b><p className="muted small">The video may have little speech, or the content doesn't split into short stories. You can still open the transcript below.</p></div>
      )}

      {transcript && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Transcript</h3>
            <button className="small" onClick={() => setShowTranscript(!showTranscript)}>{showTranscript ? 'Hide' : 'Show'}</button>
          </div>
          <p className="muted small">
            Language: {transcript.language} ({Math.round(transcript.languageProbability * 100)}%) · {transcript.segments.length} segments · model {transcript.model} on {transcript.device.toUpperCase()}
          </p>
          {showTranscript && (
            <div className="transcript">
              {transcript.segments.map((s, i) => (
                <div key={i} className="seg"><span className="ts">{formatDuration(s.start)}</span><span>{s.text}</span></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AnalysisPanel({ u, onCancel, onRetry }: { u: AnalysisUpdate; onCancel: () => void; onRetry: () => void }): ReactElement {
  const icon = { done: '✓', active: '●', pending: '○', error: '✕' } as const
  return (
    <div className="card analysis">
      <h3>{u.running ? 'Analyzing your video' : u.cancelled ? 'Analysis cancelled' : "We couldn't finish this"}</h3>
      <ul className="steps">
        {u.steps.map((s) => (
          <li key={s.id} className={'step ' + s.state}><span className="ico">{icon[s.state]}</span> {s.label}</li>
        ))}
      </ul>
      {u.running && (
        <>
          <div className={'bar' + (u.progress == null ? ' indeterminate' : '')}>
            <div style={{ width: u.progress == null ? '40%' : `${Math.round(u.progress * 100)}%` }} />
          </div>
          <div className="muted small">{u.message}{u.progress != null && ` — ${Math.round(u.progress * 100)}%`}</div>
          <div className="row"><button onClick={onCancel}>Cancel</button></div>
        </>
      )}
      {u.error && (
        <>
          <ErrorBox message={u.error.message} details={u.error.details} />
          <div className="row"><button className="primary" onClick={onRetry}>Try Again</button></div>
        </>
      )}
      {u.cancelled && <div className="row"><button className="primary" onClick={onRetry}>Start again</button></div>}
    </div>
  )
}

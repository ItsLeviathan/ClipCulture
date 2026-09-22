import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ClipRecord, HardwareInfo, ProjectSummary, RegenerateOption } from '@shared/types'
import { PreviewSurface, musicUrl, usePlayback } from './player'
import ExportDialog from './ExportDialog'
import { Icon } from './Icon'
import { formatDuration } from './format'

const REGEN_OPTIONS: { id: RegenerateOption; label: string; hint: string }[] = [
  { id: 'stronger-hook', label: 'Stronger hook', hint: 'Start on the most attention-grabbing line' },
  { id: 'shorter', label: 'Shorter', hint: 'A tighter, punchier cut' },
  { id: 'more-context', label: 'More context', hint: 'Include the setup' },
  { id: 'more-emotional', label: 'More emotional', hint: 'Focus on the most intense part' },
  { id: 'information', label: 'Focus on information', hint: 'The most useful explanation' },
  { id: 'auto', label: 'Let AI decide', hint: 'A different strong version' }
]

interface Props {
  project: ProjectSummary
  clips: ClipRecord[]
  hardware: HardwareInfo | null
  busy: boolean
  onEdit: (clipId: string) => void
  onChanged: () => void
}

export default function Highlights({ project, clips, hardware, busy, onEdit, onChanged }: Props): ReactElement {
  const groups = useMemo(() => {
    const m = new Map<string, ClipRecord[]>()
    for (const c of clips) m.set(c.groupId, [...(m.get(c.groupId) ?? []), c])
    return [...m.values()].map((v) => v.sort((a, b) => a.version - b.version))
  }, [clips])

  return (
    <div className="grid clips">
      {groups.map((versions, i) => (
        <ClipCard key={versions[0].groupId} index={i + 1} project={project} versions={versions} hardware={hardware} busy={busy} onEdit={onEdit} onChanged={onChanged} />
      ))}
    </div>
  )
}

function ClipCard(props: { index: number; project: ProjectSummary; versions: ClipRecord[]; hardware: HardwareInfo | null; busy: boolean; onEdit: (id: string) => void; onChanged: () => void }): ReactElement {
  const { project, versions } = props
  const [vid, setVid] = useState(versions[versions.length - 1].id)
  const clip = versions.find((v) => v.id === vid) ?? versions[versions.length - 1]
  const [menu, setMenu] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [why, setWhy] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pb = usePlayback(clip.doc, videoRef, audioRef, { loop: true })

  // when a new version is created it becomes the visible one
  const lastCount = useRef(versions.length)
  useEffect(() => {
    if (versions.length > lastCount.current) setVid(versions[versions.length - 1].id)
    lastCount.current = versions.length
  }, [versions])

  return (
    <div className="card clipcard">
      <div className="cc-player" onMouseEnter={() => pb.play()} onMouseLeave={() => { pb.pause(); pb.seek(0) }} onClick={() => props.onEdit(clip.id)}>
        <PreviewSurface projectId={project.id} source={project.source} doc={clip.doc} t={pb.t} videoRef={videoRef} onVideoReady={() => pb.seek(0)} />
        {clip.doc.music?.trackId && <audio ref={audioRef} src={musicUrl(clip.doc.music.trackId)} loop preload="none" />}
        <div className="badge">#{props.index}</div>
        <span className="pill br">{formatDuration(clip.duration)}</span>
        {!pb.playing && <div className="play-hint"><Icon name="play" size={12} fill /> Hover to preview</div>}
      </div>

      <div className="cc-body">
        <div className="cc-title">{clip.doc.meta.title || 'Untitled'}</div>
        {clip.doc.meta.caption && <p className="cc-desc">{clip.doc.meta.caption}</p>}
        {clip.doc.meta.hashtags.length > 0 && (
          <div className="cc-tags">{clip.doc.meta.hashtags.slice(0, 5).map((h) => <span key={h} className="chip tag">#{h}</span>)}</div>
        )}
        <div className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="clock" size={13} /> from {formatDuration(clip.srcStart)} – {formatDuration(clip.srcEnd)} of the video
        </div>

        {versions.length > 1 && (
          <div className="versions">
            {versions.map((v) => (
              <button key={v.id} className={v.id === clip.id ? 'primary' : ''} title={v.versionNote || `Version ${v.label}`} onClick={() => setVid(v.id)}>{v.label}</button>
            ))}
            <span className="muted small">{clip.versionNote}</span>
          </div>
        )}

        {clip.reason && (
          <button className="link small" style={{ margin: '8px 0 0', textAlign: 'left' }} onClick={() => setWhy(!why)}>{why ? '▾' : '▸'} Why this moment?</button>
        )}
        {why && <p className="muted small" style={{ margin: '4px 0 0' }}>{clip.reason}</p>}

        <div className="cc-actions">
          <button className="primary small" onClick={() => props.onEdit(clip.id)}><Icon name="edit" size={14} /> Edit</button>
          <button className="small" onClick={() => setExporting(true)}><Icon name="download" size={14} /> Export</button>
          <div className="menu-wrap">
            <button className="small iconbtn" title="Regenerate a new version" disabled={props.busy} onClick={() => setMenu(!menu)}><Icon name="wand" size={15} /></button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                {REGEN_OPTIONS.map((o) => (
                  <button key={o.id} onClick={() => { setMenu(false); void window.reelforge.regenerateClip(clip.id, o.id) }}>
                    {o.label}<span className="muted small">{o.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="spacer" />
          <button
            className="danger small iconbtn"
            title="Delete"
            onClick={async () => {
              if (versions.length > 1 && confirm(`Delete only version ${clip.label}? (Cancel to keep everything)`)) {
                await window.reelforge.deleteClip(clip.id)
                setVid(versions.find((v) => v.id !== clip.id)!.id)
              } else if (versions.length === 1 || confirm(`Delete this highlight and all ${versions.length} versions?`)) {
                await window.reelforge.deleteHighlight(clip.groupId)
              } else return
              props.onChanged()
            }}
          ><Icon name="trash" size={15} /></button>
        </div>
      </div>

      {exporting && (
        <ExportDialog clipId={clip.id} doc={clip.doc} hardware={props.hardware} beforeExport={async () => undefined} onClose={() => setExporting(false)} />
      )}
    </div>
  )
}

import { useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_EXPORT, EXPORT_PRESETS, outputDuration, type ClipDoc, type ExportOptions, type ExportPresetId, type ExportUpdate, type HardwareInfo } from '@shared/types'

interface Props {
  clipId: string
  doc: ClipDoc
  hardware: HardwareInfo | null
  /** persist the latest edits before rendering */
  beforeExport: () => Promise<void>
  onClose: () => void
}

const RES: [string, number, number][] = [
  ['1080 × 1920 (recommended)', 1080, 1920],
  ['720 × 1280 (smaller file)', 720, 1280],
  ['1440 × 2560 (upscaled)', 1440, 2560]
]

export default function ExportDialog({ clipId, doc, hardware, beforeExport, onClose }: Props): ReactElement {
  const [opts, setOpts] = useState<ExportOptions>(() => {
    try {
      return { ...DEFAULT_EXPORT, ...(JSON.parse(localStorage.getItem('rf-export') ?? '{}') as Partial<ExportOptions>) }
    } catch {
      return DEFAULT_EXPORT
    }
  })
  const [advanced, setAdvanced] = useState(false)
  const [job, setJob] = useState<{ id: string } | null>(null)
  const [update, setUpdate] = useState<ExportUpdate | null>(null)
  const dur = outputDuration(doc)
  const preset = EXPORT_PRESETS[opts.preset]
  const tooLong = dur > preset.maxSeconds

  useEffect(
    () =>
      window.reelforge.onExportUpdate((u) => {
        if (job && u.jobId === job.id) setUpdate(u)
      }),
    [job]
  )

  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]): void => setOpts((o) => ({ ...o, [k]: v }))

  const start = async (): Promise<void> => {
    try {
      localStorage.setItem('rf-export', JSON.stringify(opts))
    } catch {
      /* preference only */
    }
    setUpdate({ jobId: '', clipId, state: 'running', progress: 0, message: 'Saving your edits…' })
    await beforeExport()
    const id = await window.reelforge.exportClip(clipId, opts)
    setJob({ id })
  }

  const running = update?.state === 'running'
  // Rendered on document.body: inside a highlight card the card's hover transform and overflow clipping would trap the dialog.
  return createPortal(
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal">
        <h2 style={{ marginTop: 0 }}>Export</h2>

        <div className="presets">
          {(Object.keys(EXPORT_PRESETS) as ExportPresetId[]).map((id) => (
            <button key={id} disabled={running} className={'preset' + (opts.preset === id ? ' primary' : '')} aria-pressed={opts.preset === id} onClick={() => set('preset', id)}>
              <span>{EXPORT_PRESETS[id].label}</span>
              <small>up to {Math.round(EXPORT_PRESETS[id].maxSeconds / 60 * 10) / 10} min</small>
            </button>
          ))}
        </div>
        <p className="muted small">
          1080 × 1920 · 9:16 · {dur.toFixed(0)} s · no watermark. {preset.note}.
        </p>
        {tooLong && <p className="warn small">This clip is longer than {preset.label} allows ({preset.maxSeconds}s). Trim it or pick another platform.</p>}

        <button className="link" onClick={() => setAdvanced(!advanced)}>{advanced ? '▾' : '▸'} Advanced settings</button>
        {advanced && (
          <div className="adv">
            <label>Resolution
              <select value={`${opts.width}x${opts.height}`} disabled={running} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); setOpts((o) => ({ ...o, width: w, height: h })) }}>
                {RES.map(([l, w, h]) => <option key={l} value={`${w}x${h}`}>{l}</option>)}
              </select>
            </label>
            <label>Encoder
              <select value={opts.encoder} disabled={running} onChange={(e) => set('encoder', e.target.value as ExportOptions['encoder'])}>
                <option value="auto">Automatic {hardware?.nvenc ? '(GPU)' : '(CPU)'}</option>
                <option value="nvenc" disabled={!hardware?.nvenc}>NVIDIA GPU (NVENC)</option>
                <option value="x264">CPU (best compatibility)</option>
              </select>
            </label>
            <label>Codec
              <select value={opts.codec} disabled={running} onChange={(e) => set('codec', e.target.value as ExportOptions['codec'])}>
                <option value="h264">H.264 (works everywhere)</option>
                <option value="hevc">H.265 / HEVC (smaller)</option>
              </select>
            </label>
            <label>Quality: {opts.quality} <span className="muted small">(lower = better, bigger file)</span>
              <input type="range" min={12} max={28} value={opts.quality} disabled={running} onChange={(e) => set('quality', Number(e.target.value))} />
            </label>
            <label>Frame rate
              <select value={String(opts.fps)} disabled={running} onChange={(e) => set('fps', (e.target.value === 'source' ? 'source' : Number(e.target.value)) as ExportOptions['fps'])}>
                <option value="source">Same as source</option>
                <option value="24">24</option><option value="30">30</option><option value="60">60</option>
              </select>
            </label>
            <label>Audio bitrate
              <select value={opts.audioKbps} disabled={running} onChange={(e) => set('audioKbps', Number(e.target.value))}>
                <option value={128}>128 kbps</option><option value={192}>192 kbps</option><option value={256}>256 kbps</option>
              </select>
            </label>
          </div>
        )}

        {update && (
          <div className="card" style={{ marginTop: 14 }}>
            {update.state === 'running' && (
              <>
                <div className="bar"><div style={{ width: `${Math.round(update.progress * 100)}%` }} /></div>
                <div className="muted small">{update.message} — {Math.round(update.progress * 100)}%</div>
              </>
            )}
            {update.state === 'done' && (
              <>
                <div style={{ color: '#5fd08a', fontWeight: 600 }}>✓ Export complete {update.encoder ? `(${update.encoder})` : ''}</div>
                <div className="muted small" style={{ wordBreak: 'break-all' }}>{update.outputPath}</div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="primary" onClick={() => window.reelforge.showInFolder(update.outputPath!)}>Show in folder</button>
                </div>
              </>
            )}
            {update.state === 'error' && (
              <div className="error">
                <div>{update.error?.message}</div>
                <details><summary>Technical details</summary><pre>{update.error?.details}</pre></details>
              </div>
            )}
            {update.state === 'cancelled' && <div className="muted">Export cancelled.</div>}
          </div>
        )}

        <div className="row modal-actions">
          {running ? (
            <button onClick={() => job && window.reelforge.cancelExport(job.id)}>Cancel export</button>
          ) : (
            <>
              <button onClick={onClose}>{update?.state === 'done' ? 'Close' : 'Cancel'}</button>
              <button className="primary" onClick={start}>{update?.state === 'done' ? 'Export again' : 'Export'}</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

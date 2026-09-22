import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { DownloadUpdate, HardwareInfo, ProjectSummary, SourceInfo, SystemInfo } from '@shared/types'
import { SUPPORTED_EXTENSIONS } from '@shared/types'
import { ErrorBox, SourceDetails, friendlyError } from './common'
import { estimateProcessing, formatDuration, timeAgo } from './format'
import { Icon, type IconName } from './Icon'
import logo from './assets/logo.png'
import banner from './assets/banner.jpg'
import ProjectDetail from './ProjectDetail'
import Editor from './Editor'

type Page = 'home' | 'projects' | 'project' | 'editor' | 'settings'

const NAV: { id: Exclude<Page, 'project'>; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
  { id: 'editor', label: 'Editor', icon: 'scissors' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
]

export default function App(): ReactElement {
  const [page, setPage] = useState<Page>('home')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [clipId, setClipId] = useState<string | null>(null)

  const refresh = useCallback(async () => setProjects(await window.reelforge.listProjects()), [])
  useEffect(() => {
    void refresh()
    window.reelforge.getHardware().then(setHardware).catch(() => setHardware(null))
  }, [refresh])

  const project = projects.find((p) => p.id === openId) ?? null
  const openProject = (p: ProjectSummary): void => { setOpenId(p.id); setPage('project') }
  const active = page === 'project' ? 'projects' : page

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <img className="logo-img" src={logo} alt="Clip Culture logo" />
          <span>Clip <span className="grad-text">Culture</span></span>
        </div>
        {NAV.map((n) => (
          <button key={n.id} className={'nav' + (active === n.id ? ' active' : '')} onClick={() => setPage(n.id)}>
            <Icon name={n.icon} />
            {n.label}
          </button>
        ))}
        <div className="side-foot">
          <b><span className={'dot' + (hardware?.cuda ? '' : ' off')} />{hardware?.cuda ? 'GPU ready' : hardware ? 'CPU mode' : 'Checking…'}</b>
          <span className="muted">{hardware?.gpu ?? 'Everything runs locally on this PC'}</span>
        </div>
      </nav>
      <main className="content">
        {page === 'home' && <Home projects={projects} hardware={hardware} onCreated={(p) => { void refresh(); openProject(p) }} onOpen={openProject} />}
        {page === 'projects' && <Projects projects={projects} onOpen={openProject} onChanged={refresh} />}
        {page === 'project' && project && (
          <ProjectDetail p={project} hardware={hardware} onBack={() => setPage('projects')} onChanged={refresh} onEdit={(id) => { setClipId(id); setPage('editor') }} />
        )}
        {page === 'editor' && (clipId && project ? (
          <Editor clipId={clipId} project={project} hardware={hardware} onBack={() => { setPage('project'); void refresh() }} />
        ) : (
          <div className="page">
            <div className="page-head"><div><h1>Editor</h1><p className="sub">Open a project and press <b>Edit</b> on a highlight to start editing.</p></div></div>
          </div>
        ))}
        {page === 'settings' && <Settings hardware={hardware} />}
      </main>
    </div>
  )
}

/* ---------- Home / import ---------- */

function Home(props: { projects: ProjectSummary[]; hardware: HardwareInfo | null; onCreated: (p: ProjectSummary) => void; onOpen: (p: ProjectSummary) => void }): ReactElement {
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<SourceInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; details: string } | null>(null)
  const [url, setUrl] = useState('')
  const [quality, setQuality] = useState(1080)
  const [dl, setDl] = useState<DownloadUpdate | null>(null)
  const dlJob = useRef<string | null>(null)
  const downloading = dl?.state === 'running'

  const load = async (path: string | null): Promise<void> => {
    if (!path) return
    setError(null)
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      setError({ message: `.${ext} files aren't supported. Try MP4, MOV, MKV, AVI or WebM.`, details: path })
      return
    }
    setBusy(true)
    try {
      setPending(await window.reelforge.inspectVideo(path))
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(
    () =>
      window.reelforge.onDownloadUpdate((u) => {
        if (u.jobId !== dlJob.current) return
        setDl(u)
        if (u.state === 'done' && u.filePath) {
          setUrl('')
          void load(u.filePath) // continue exactly like a dropped file
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const startDownload = async (): Promise<void> => {
    setError(null)
    setDl({ jobId: '', state: 'running', progress: null, message: 'Starting…' })
    try {
      dlJob.current = await window.reelforge.downloadVideo(url.trim(), quality)
    } catch (e) {
      setDl(null)
      setError({ message: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), details: String(e) })
    }
  }

  const create = async (): Promise<void> => {
    if (!pending) return
    setBusy(true)
    try {
      const p = await window.reelforge.createProject(pending.path)
      setPending(null)
      props.onCreated(p)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="hero-banner"><img src={banner} alt="Clip Culture" /></div>
      <section className="hero">
        <div className="eyebrow"><Icon name="sparkles" size={14} /> Local AI · your videos never leave this PC</div>
        <h1 className="hero-title">Turn long videos into <span className="grad-text">scroll-stopping Reels</span></h1>
        <p className="hero-sub">Drop a video or paste a link. Clip Culture finds the best moments, reframes them to 9:16, adds captions and titles, and gives you a full editor.</p>
      </section>

      {!pending && (
        <div
          className={'dropzone' + (dragging ? ' drag' : '')}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) void load(window.reelforge.pathForFile(f))
          }}
        >
          <div className="dz-icon"><Icon name="upload" size={28} /></div>
          <div className="dz-title">{busy ? 'Reading video…' : dragging ? 'Release to import' : 'Drop your video here'}</div>
          <div className="muted">or</div>
          <button className="primary" disabled={busy} onClick={async () => load(await window.reelforge.pickVideo())}>
            <Icon name="folder" size={16} /> Browse files
          </button>
          <div className="dz-formats">
            {['MP4', 'MOV', 'MKV', 'AVI', 'WebM'].map((f) => <span key={f} className="chip">{f}</span>)}
          </div>
        </div>
      )}

      {!pending && (
        <div className="card linkbox">
          <div className="linkbar">
            <div className="field">
              <Icon name="link" size={16} />
              <input
                placeholder="Or paste a video link (YouTube and most other sites)"
                value={url}
                disabled={downloading}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && url.trim() && !downloading && void startDownload()}
              />
            </div>
            <select value={quality} disabled={downloading} onChange={(e) => setQuality(Number(e.target.value))} title="Maximum download quality">
              <option value={1080}>Up to 1080p</option>
              <option value={720}>Up to 720p</option>
              <option value={1440}>Up to 1440p</option>
              <option value={0}>Best available</option>
            </select>
            {downloading ? (
              <button onClick={() => dlJob.current && void window.reelforge.cancelDownload(dlJob.current)}>Cancel</button>
            ) : (
              <button className="primary" disabled={!url.trim()} onClick={() => void startDownload()}><Icon name="download" size={16} /> Download</button>
            )}
          </div>
          {dl && dl.state === 'running' && (
            <>
              <div className={'bar' + (dl.progress == null ? ' indeterminate' : '')} style={{ marginTop: 12 }}>
                <div style={{ width: dl.progress == null ? '40%' : `${Math.round(dl.progress * 100)}%` }} />
              </div>
              <div className="muted small">{dl.message}{dl.progress != null && ` — ${Math.round(dl.progress * 100)}%`}</div>
            </>
          )}
          {dl?.state === 'error' && dl.error && <ErrorBox message={dl.error.message} details={dl.error.details} />}
          <p className="muted small" style={{ margin: '10px 0 0' }}>
            Only download videos you own or have permission to use. Downloading is the only step that goes online; everything after runs locally.
          </p>
        </div>
      )}

      {pending && (
        <div className="card import-card">
          <SourceDetails source={pending} thumbnail={null} />
          <p className="muted" style={{ margin: 0 }}><Icon name="clock" size={14} /> {estimateProcessing(pending.duration, !!props.hardware?.cuda)}</p>
          <div className="row">
            <button className="primary" disabled={busy} onClick={create}>{busy ? 'Creating project…' : 'Create project'}</button>
            <button disabled={busy} onClick={() => setPending(null)}>Choose another</button>
          </div>
        </div>
      )}
      {error && <ErrorBox {...error} />}

      {props.projects.length > 0 && (
        <>
          <h2>Recent projects</h2>
          <div className="grid">
            {props.projects.slice(0, 6).map((p) => <ProjectCard key={p.id} p={p} onOpen={() => props.onOpen(p)} />)}
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- Projects ---------- */

function Projects(props: { projects: ProjectSummary[]; onOpen: (p: ProjectSummary) => void; onChanged: () => Promise<void> }): ReactElement {
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Projects</h1><p className="sub">{props.projects.length} project{props.projects.length === 1 ? '' : 's'} saved on this PC</p></div>
      </div>
      {props.projects.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing here yet. Import a video from Home to get started.</p></div>}
      <div className="grid">
        {props.projects.map((p) => (
          <ProjectCard
            key={p.id}
            p={p}
            onOpen={() => props.onOpen(p)}
            onDelete={async () => {
              if (confirm(`Delete "${p.name}" and its clips? Your original video is not touched.`)) {
                await window.reelforge.deleteProject(p.id)
                await props.onChanged()
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectCard(props: { p: ProjectSummary; onOpen: () => void; onDelete?: () => void }): ReactElement {
  const { p } = props
  const status =
    p.status === 'analyzing' ? <span className="chip busy">Analyzing…</span>
    : p.clipCount > 0 ? <span className="chip ok"><Icon name="check" size={12} /> {p.clipCount} highlight{p.clipCount === 1 ? '' : 's'}</span>
    : <span className="chip">Not analyzed</span>
  return (
    <div className="card project" onClick={props.onOpen}>
      <div className="thumb">
        {p.thumbnail ? <img src={p.thumbnail} alt="" /> : <Icon name="film" size={34} />}
        <span className="pill br">{formatDuration(p.source.duration)}</span>
      </div>
      {props.onDelete && (
        <button className="danger iconbtn small delbtn" title="Delete project" onClick={(e) => { e.stopPropagation(); props.onDelete!() }}><Icon name="trash" size={15} /></button>
      )}
      <div className="pbody">
        <div className="pname">{p.name}</div>
        <div className="pmeta">
          {status}
          <span className="muted small">{p.source.width}×{p.source.height} · {timeAgo(p.updatedAt)}</span>
        </div>
      </div>
    </div>
  )
}

/* ---------- Settings ---------- */

function Settings({ hardware }: { hardware: HardwareInfo | null }): ReactElement {
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [updating, setUpdating] = useState(false)
  useEffect(() => { void window.reelforge.getSystemInfo().then(setSys) }, [])
  const ok = (b: boolean): ReactElement => (b ? <span className="chip ok"><Icon name="check" size={12} /> Installed</span> : <span className="chip">Missing</span>)
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p className="sub">Hardware, local AI models and where your files live.</p></div></div>
      <div className="card">
        <h3>Hardware</h3>
        {!hardware ? <p className="muted">Detecting…</p> : (
          <dl className="kv">
            <dt>GPU</dt><dd>{hardware.gpu ?? 'None detected (CPU mode)'}</dd>
            <dt>CUDA</dt><dd>{hardware.cuda ? 'Available' : 'Unavailable'}</dd>
            <dt>NVENC encoding</dt><dd>{hardware.nvenc ? 'Available' : 'Unavailable (CPU encoding will be used)'}</dd>
            <dt>FFmpeg</dt><dd>{hardware.ffmpegVersion}</dd>
          </dl>
        )}
      </div>
      <div className="card">
        <h3>Local AI models</h3>
        {!sys ? <p className="muted">Checking…</p> : (
          <dl className="kv">
            <dt>Speech recognition</dt><dd>Whisper large-v3-turbo {ok(sys.models.whisper)}</dd>
            <dt>Highlight finder</dt><dd>Qwen2.5-7B-Instruct {ok(sys.models.llm)}</dd>
            <dt>Face tracking</dt><dd>YuNet {ok(sys.models.face)}</dd>
            <dt>Python environment</dt><dd>{ok(sys.models.python)}</dd>
          </dl>
        )}
      </div>
      <div className="card">
        <h3>Where your files are saved</h3>
        {sys && (
          <dl className="kv">
            <dt>Projects</dt><dd>{sys.projectsDir}</dd>
            <dt>Exports</dt><dd>{sys.exportsDir}</dd>
            <dt>Database &amp; settings</dt><dd>{sys.dataDir}</dd>
            <dt>Music library</dt><dd>{sys.musicDir}</dd>
            <dt>Downloaded videos</dt><dd>{sys.downloadsDir}</dd>
          </dl>
        )}
      </div>
      <div className="card">
        <h3>Video downloader</h3>
        <p className="muted small">Used by “paste a video link” on Home (yt-dlp). Sites change often; if downloads stop working, update it.</p>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="chip">{sys?.downloaderVersion ? `yt-dlp ${sys.downloaderVersion}` : 'Not installed'}</span>
          <button
            disabled={updating}
            onClick={async () => {
              setUpdating(true)
              try {
                const v = await window.reelforge.updateDownloader()
                setSys((s) => (s ? { ...s, downloaderVersion: v } : s))
              } finally {
                setUpdating(false)
              }
            }}
          ><Icon name="refresh" size={15} /> {updating ? 'Updating…' : 'Update downloader'}</button>
        </div>
      </div>
      <div className="card">
        <h3>Privacy</h3>
        <p className="muted" style={{ margin: 0 }}>Videos never leave this PC. Clip Culture has no accounts, no uploads, and never adds a watermark.</p>
      </div>
    </div>
  )
}

import type { ClipDoc, ClipRecord, ExportOptions, ExportUpdate, MusicTrack, RegenerateOption } from './clip'
export * from './clip'

export interface SourceInfo {
  path: string
  fileName: string
  fileSize: number
  duration: number
  width: number
  height: number
  fps: number
  videoCodec: string
  orientation: 'landscape' | 'portrait' | 'square'
  audioStreams: { codec: string; sampleRate: number; channels: number; language?: string }[]
}

export interface ProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  source: SourceInfo
  thumbnail: string | null // data URL
  status: 'imported' | 'analyzing' | 'ready'
  hasTranscript: boolean
  hasProxy: boolean
  clipCount: number
}

export interface TranscriptWord {
  start: number
  end: number
  word: string
  prob: number
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  words: TranscriptWord[]
}

export interface Transcript {
  language: string
  languageProbability: number
  duration: number
  model: string
  device: 'cuda' | 'cpu'
  segments: TranscriptSegment[]
}

export type StepState = 'pending' | 'active' | 'done' | 'error'

export interface AnalysisStep {
  id: string
  label: string
  state: StepState
}

export interface AnalysisUpdate {
  projectId: string
  running: boolean
  steps: AnalysisStep[]
  message: string
  /** 0..1 for the active step, or null when indeterminate */
  progress: number | null
  error?: { message: string; details: string }
  finished?: boolean
  cancelled?: boolean
}

export interface HardwareInfo {
  gpu: string | null
  nvenc: boolean
  cuda: boolean
  ffmpegVersion: string
}

export interface DownloadUpdate {
  jobId: string
  state: 'running' | 'done' | 'error' | 'cancelled'
  /** 0..1, or null while unknown */
  progress: number | null
  message: string
  title?: string
  filePath?: string
  error?: { message: string; details: string }
}

export interface SystemInfo {
  downloadsDir: string
  downloaderVersion: string | null
  root: string
  dataDir: string
  projectsDir: string
  exportsDir: string
  musicDir: string
  models: { whisper: boolean; llm: boolean; face: boolean; python: boolean }
}

export interface ReelForgeApi {
  getSystemInfo(): Promise<SystemInfo>
  downloadVideo(url: string, maxHeight: number): Promise<string>
  cancelDownload(jobId: string): Promise<void>
  onDownloadUpdate(cb: (u: DownloadUpdate) => void): () => void
  updateDownloader(): Promise<string | null>
  pickVideo(): Promise<string | null>
  pathForFile(file: File): string
  inspectVideo(path: string): Promise<SourceInfo>
  createProject(path: string, name?: string): Promise<ProjectSummary>
  listProjects(): Promise<ProjectSummary[]>
  deleteProject(id: string): Promise<void>
  renameProject(id: string, name: string): Promise<void>
  revealProject(id: string): Promise<void>
  getHardware(): Promise<HardwareInfo>
  analyzeProject(id: string, opts?: { force?: boolean; redoHighlights?: boolean }): Promise<void>
  cancelAnalysis(id: string): Promise<void>
  getTranscript(id: string): Promise<Transcript | null>
  getAnalysisState(id: string): Promise<AnalysisUpdate | null>
  onAnalysisUpdate(cb: (u: AnalysisUpdate) => void): () => void

  // clips
  listClips(projectId: string): Promise<ClipRecord[]>
  getClip(clipId: string): Promise<ClipRecord | null>
  saveClip(clipId: string, doc: ClipDoc, opts?: { checkpoint?: boolean }): Promise<void>
  autosaveClip(clipId: string, doc: ClipDoc): Promise<void>
  discardAutosave(clipId: string): Promise<void>
  deleteClip(clipId: string): Promise<void>
  deleteHighlight(groupId: string): Promise<void>
  regenerateClip(clipId: string, option: RegenerateOption): Promise<void>
  listCheckpoints(clipId: string): Promise<{ id: number; createdAt: number }[]>
  restoreCheckpoint(clipId: string, checkpointId: number): Promise<ClipDoc | null>

  // media
  pickImage(projectId: string): Promise<string | null>
  pickMusic(projectId: string): Promise<MusicTrack | null>
  listMusic(projectId?: string): Promise<MusicTrack[]>

  // export
  exportClip(clipId: string, options: ExportOptions): Promise<string>
  cancelExport(jobId: string): Promise<void>
  onExportUpdate(cb: (u: ExportUpdate) => void): () => void
  showInFolder(path: string): Promise<void>
}

export const SUPPORTED_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'webm']

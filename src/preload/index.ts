import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ReelForgeApi } from '../shared/types'

const api: ReelForgeApi = {
  pickVideo: () => ipcRenderer.invoke('pick-video'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  inspectVideo: (p) => ipcRenderer.invoke('inspect-video', p),
  createProject: (p, name) => ipcRenderer.invoke('create-project', p, name),
  listProjects: () => ipcRenderer.invoke('list-projects'),
  deleteProject: (id) => ipcRenderer.invoke('delete-project', id),
  renameProject: (id, name) => ipcRenderer.invoke('rename-project', id, name),
  revealProject: (id) => ipcRenderer.invoke('reveal-project', id),
  getHardware: () => ipcRenderer.invoke('get-hardware'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  downloadVideo: (url, maxHeight) => ipcRenderer.invoke('download-video', url, maxHeight),
  cancelDownload: (jobId) => ipcRenderer.invoke('cancel-download', jobId),
  onDownloadUpdate: (cb) => {
    const h = (_: unknown, u: Parameters<typeof cb>[0]): void => cb(u)
    ipcRenderer.on('download-update', h)
    return () => ipcRenderer.removeListener('download-update', h)
  },
  updateDownloader: () => ipcRenderer.invoke('update-downloader'),
  analyzeProject: (id, opts) => ipcRenderer.invoke('analyze-project', id, opts),
  cancelAnalysis: (id) => ipcRenderer.invoke('cancel-analysis', id),
  getTranscript: (id) => ipcRenderer.invoke('get-transcript', id),
  getAnalysisState: (id) => ipcRenderer.invoke('get-analysis-state', id),
  onAnalysisUpdate: (cb) => {
    const h = (_: unknown, u: Parameters<typeof cb>[0]): void => cb(u)
    ipcRenderer.on('analysis-update', h)
    return () => ipcRenderer.removeListener('analysis-update', h)
  },

  listClips: (id) => ipcRenderer.invoke('list-clips', id),
  getClip: (id) => ipcRenderer.invoke('get-clip', id),
  saveClip: (id, doc, opts) => ipcRenderer.invoke('save-clip', id, doc, opts),
  autosaveClip: (id, doc) => ipcRenderer.invoke('autosave-clip', id, doc),
  discardAutosave: (id) => ipcRenderer.invoke('discard-autosave', id),
  deleteClip: (id) => ipcRenderer.invoke('delete-clip', id),
  deleteHighlight: (id) => ipcRenderer.invoke('delete-highlight', id),
  regenerateClip: (id, option) => ipcRenderer.invoke('regenerate-clip', id, option),
  listCheckpoints: (id) => ipcRenderer.invoke('list-checkpoints', id),
  restoreCheckpoint: (id, cp) => ipcRenderer.invoke('restore-checkpoint', id, cp),

  pickImage: (id) => ipcRenderer.invoke('pick-image', id),
  pickMusic: (id) => ipcRenderer.invoke('pick-music', id),
  listMusic: (id) => ipcRenderer.invoke('list-music', id),

  exportClip: (id, options) => ipcRenderer.invoke('export-clip', id, options),
  cancelExport: (jobId) => ipcRenderer.invoke('cancel-export', jobId),
  onExportUpdate: (cb) => {
    const h = (_: unknown, u: Parameters<typeof cb>[0]): void => cb(u)
    ipcRenderer.on('export-update', h)
    return () => ipcRenderer.removeListener('export-update', h)
  },
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p)
}

contextBridge.exposeInMainWorld('reelforge', api)

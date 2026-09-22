import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'path'
import { getDb } from './db'
import { existsSync } from 'fs'
import { cancelDownload, downloaderVersion, startDownload, updateDownloader } from './downloader'
import { appRoot, downloadsDir, dataDir, exportsDir, modelsDir, projectsDir, pythonExe, redirectStorage } from './paths'
import { faceModelPath, llmModelPath } from './workers'
import { cancelAnalysis, getAnalysisState, startAnalysis, startRegenerate } from './jobs'
import * as clips from './clips'
import { listMusic, pickImage, pickMusic, registerMediaHandler, registerMediaScheme } from './media'
import { cancelExport, exportClip, showInFolder } from './export'
import { detectHardware, probeVideo } from './ffmpeg'
import * as projects from './projects'
import { SUPPORTED_EXTENSIONS } from '../shared/types'

app.setName('Clip Culture')
redirectStorage()
registerMediaScheme()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0d0e12',
    title: 'Clip Culture',
    icon: nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png')),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs electron's webUtils
      autoplayPolicy: 'no-user-gesture-required', // desktop editor: preview playback must never be blocked
      backgroundThrottling: false // keep preview playback and timers steady even when the window is partly covered
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('pick-video', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose a video',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: SUPPORTED_EXTENSIONS }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('inspect-video', (_e, p: string) => probeVideo(p))
  ipcMain.handle('create-project', (_e, p: string, name?: string) => projects.createProject(p, name))
  ipcMain.handle('list-projects', () => projects.listProjects())
  ipcMain.handle('delete-project', (_e, id: string) => projects.deleteProject(id))
  ipcMain.handle('rename-project', (_e, id: string, name: string) => projects.renameProject(id, name))
  ipcMain.handle('reveal-project', (_e, id: string) => projects.revealProject(id))
  ipcMain.handle('get-hardware', () => detectHardware())
  ipcMain.handle('download-video', (_e, url: string, maxHeight: number) => startDownload(url, maxHeight))
  ipcMain.handle('cancel-download', (_e, jobId: string) => cancelDownload(jobId))
  ipcMain.handle('update-downloader', () => updateDownloader())
  ipcMain.handle('get-system-info', async () => ({
    downloadsDir: downloadsDir(),
    downloaderVersion: await downloaderVersion(),
    root: appRoot(),
    dataDir: dataDir(),
    projectsDir: projectsDir(),
    exportsDir: exportsDir(),
    musicDir: join(appRoot(), 'assets', 'music'),
    models: {
      whisper: existsSync(join(modelsDir(), 'mobiuslabsgmbh--faster-whisper-large-v3-turbo', 'model.bin')),
      llm: existsSync(llmModelPath()),
      face: existsSync(faceModelPath()),
      python: existsSync(pythonExe())
    }
  }))
  ipcMain.handle('analyze-project', (_e, id: string, opts?: { force?: boolean; redoHighlights?: boolean }) => startAnalysis(id, opts?.force, opts?.redoHighlights))
  ipcMain.handle('cancel-analysis', (_e, id: string) => cancelAnalysis(id))
  ipcMain.handle('get-transcript', (_e, id: string) => projects.getTranscript(id))
  ipcMain.handle('get-analysis-state', (_e, id: string) => getAnalysisState(id))

  ipcMain.handle('list-clips', (_e, id: string) => clips.listClips(id))
  ipcMain.handle('get-clip', (_e, id: string) => clips.getClip(id))
  ipcMain.handle('save-clip', (_e, id: string, doc, opts?: { checkpoint?: boolean }) => clips.saveClip(id, doc, opts?.checkpoint ?? true))
  ipcMain.handle('autosave-clip', (_e, id: string, doc) => clips.autosaveClip(id, doc))
  ipcMain.handle('discard-autosave', (_e, id: string) => clips.discardAutosave(id))
  ipcMain.handle('delete-clip', (_e, id: string) => clips.deleteClip(id))
  ipcMain.handle('delete-highlight', (_e, id: string) => clips.deleteHighlight(id))
  ipcMain.handle('regenerate-clip', (_e, id: string, option) => startRegenerate(id, option))
  ipcMain.handle('list-checkpoints', (_e, id: string) => clips.listCheckpoints(id))
  ipcMain.handle('restore-checkpoint', (_e, id: string, cp: number) => clips.restoreCheckpoint(id, cp))

  ipcMain.handle('pick-image', (_e, id: string) => pickImage(id))
  ipcMain.handle('pick-music', (_e, id: string) => pickMusic(id))
  ipcMain.handle('list-music', (_e, id?: string) => listMusic(id))

  ipcMain.handle('export-clip', (_e, id: string, options) => exportClip(id, options))
  ipcMain.handle('cancel-export', (_e, jobId: string) => cancelExport(jobId))
  ipcMain.handle('show-in-folder', (_e, p: string) => showInFolder(p))
}

app.whenReady().then(() => {
  getDb()
  projects.resetStaleStatuses()
  registerMediaHandler()
  registerIpc()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

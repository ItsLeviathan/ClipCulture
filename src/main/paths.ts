import { app } from 'electron'
import { dirname, join } from 'path'
import { mkdirSync } from 'fs'

/**
 * Everything Clip Culture writes lives under one root on the F: drive:
 *   <root>/data      SQLite database, app settings, Chromium cache
 *   <root>/projects  one folder per project (thumbnails, transcript, analysis, cache)
 *   <root>/exports   finished videos
 *   <root>/temp      temporary render files
 * Dev: the project folder itself. Packaged: the folder containing the .exe.
 * Override with the REELFORGE_HOME environment variable.
 */
export function appRoot(): string {
  if (process.env['REELFORGE_HOME']) return process.env['REELFORGE_HOME']
  return app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath()
}

export const dataDir = (): string => join(appRoot(), 'data')
export const projectsDir = (): string => join(appRoot(), 'projects')
export const exportsDir = (): string => join(appRoot(), 'exports')
export const downloadsDir = (): string => join(appRoot(), 'downloads')
export const aiDir = (): string => join(appRoot(), 'ai')
export const modelsDir = (): string => join(aiDir(), 'models')
export const pythonExe = (): string => join(aiDir(), 'venv', 'Scripts', 'python.exe')
export const tempDir =(): string => join(appRoot(), 'temp')

/** Must run before app 'ready' so Electron/Chromium never write to C:. */
export function redirectStorage(): void {
  for (const d of [dataDir(), projectsDir(), exportsDir(), tempDir(), downloadsDir()]) mkdirSync(d, { recursive: true })
  app.setPath('userData', dataDir())
  app.setPath('sessionData', join(dataDir(), 'session'))
  app.setPath('temp', tempDir())
  app.setPath('logs', join(dataDir(), 'logs'))
  app.setPath('crashDumps', join(dataDir(), 'crashes'))
}

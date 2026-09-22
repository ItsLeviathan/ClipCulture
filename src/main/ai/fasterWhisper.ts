import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { aiDir, modelsDir, pythonExe } from '../paths'
import type { Transcript } from '../../shared/types'
import { AiError, type TranscribeOptions, type TranscriptionProvider } from './types'

export class FasterWhisperProvider implements TranscriptionProvider {
  readonly id = 'faster-whisper'

  constructor(
    private model = 'large-v3-turbo',
    private cpuModel = 'small'
  ) {}

  transcribe(opts: TranscribeOptions): Promise<Transcript> {
    const py = pythonExe()
    const script = join(aiDir(), 'workers', 'transcribe.py')
    if (!existsSync(py))
      throw new AiError(
        'The speech recognition environment is not installed.',
        `Missing ${py}. Create it with: py -3.12 -m venv ai\\venv && ai\\venv\\Scripts\\pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12`
      )

    const args = [
      '-u', script,
      '--audio', opts.audioPath,
      '--out', opts.outPath,
      '--model', this.model,
      '--cpu-model', this.cpuModel,
      '--models-dir', modelsDir()
    ]
    if (opts.language) args.push('--language', opts.language)

    return new Promise((resolve, reject) => {
      const p = spawn(py, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
      let buf = ''
      let stderr = ''
      let workerError: { message: string; details: string } | null = null
      let finished = false

      p.stdout.on('data', (d) => {
        buf += d
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let msg: any
          try { msg = JSON.parse(line) } catch { continue }
          if (msg.type === 'status') opts.onStatus(msg.message)
          else if (msg.type === 'progress') opts.onProgress(msg.done, msg.total)
          else if (msg.type === 'error') workerError = { message: msg.message, details: msg.details }
          else if (msg.type === 'done') finished = true
        }
      })
      p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
      opts.signal?.addEventListener('abort', () => p.kill())
      p.on('error', (e) => reject(new AiError('Could not start the speech recognition worker.', String(e))))
      p.on('close', (code) => {
        if (opts.signal?.aborted) return reject(new Error('CANCELLED'))
        if (code === 0 && finished) return resolve(JSON.parse(readFileSync(opts.outPath, 'utf-8')) as Transcript)
        const e = workerError as { message: string; details: string } | null
        reject(new AiError('Speech recognition failed.', e ? `${e.message}\n${e.details}` : stderr || `exit code ${code}`))
      })
    })
  }
}

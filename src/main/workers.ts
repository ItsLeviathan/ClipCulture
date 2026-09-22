import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { aiDir, modelsDir, pythonExe } from './paths'
import { AiError } from './ai/types'

export const llmModelPath = (): string => join(modelsDir(), 'llm', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf')
export const faceModelPath = (): string => join(modelsDir(), 'vision', 'yunet.onnx')

interface RunOpts {
  onStatus?: (m: string) => void
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  failMessage: string
}

/** Runs one of ai/workers/*.py speaking the JSON-lines protocol. Resolves when the worker reports "done". */
export function runWorker(script: string, args: string[], opts: RunOpts): Promise<void> {
  const py = pythonExe()
  if (!existsSync(py))
    return Promise.reject(new AiError('The local AI environment is not installed.', `Missing ${py}`))
  const scriptPath = join(aiDir(), 'workers', script)

  return new Promise((resolve, reject) => {
    const p = spawn(py, ['-u', scriptPath, ...args], {
      windowsHide: true,
      cwd: join(aiDir(), 'workers'),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' }
    })
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
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.type === 'status') opts.onStatus?.(msg.message)
        else if (msg.type === 'progress') opts.onProgress?.(msg.done, msg.total)
        else if (msg.type === 'error') workerError = { message: msg.message, details: msg.details }
        else if (msg.type === 'done') finished = true
      }
    })
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
    opts.signal?.addEventListener('abort', () => p.kill())
    p.on('error', (e) => reject(new AiError(opts.failMessage, String(e))))
    p.on('close', (code) => {
      if (opts.signal?.aborted) return reject(new Error('CANCELLED'))
      if (code === 0 && finished) return resolve()
      const e = workerError as { message: string; details: string } | null
      reject(new AiError(opts.failMessage, e ? `${e.message}\n${e.details}` : stderr || `exit code ${code}`))
    })
  })
}

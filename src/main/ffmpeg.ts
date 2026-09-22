import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { statSync } from 'fs'
import { basename } from 'path'
import type { SourceInfo, HardwareInfo } from '../shared/types'

const execFileP = promisify(execFile)

// Packaged builds unpack binaries out of the asar archive.
const unpacked = (p: string): string => p.replace('app.asar', 'app.asar.unpacked')

export const ffmpegPath = unpacked(require('ffmpeg-static') as string)
export const ffprobePath = unpacked((require('ffprobe-static') as { path: string }).path)

function parseFps(rate: string | undefined): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  return d ? n / d : n
}

export async function probeVideo(path: string): Promise<SourceInfo> {
  let stdout: string
  try {
    ;({ stdout } = await execFileP(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { maxBuffer: 32 * 1024 * 1024 }
    ))
  } catch (e) {
    throw new Error(`UNREADABLE_VIDEO: ${(e as Error).message}`)
  }
  const data = JSON.parse(stdout)
  const streams: any[] = data.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  if (!v) throw new Error('UNREADABLE_VIDEO: no video stream found')

  // Account for rotation metadata (phone footage).
  const rot = Math.abs(
    Number(v.tags?.rotate ?? v.side_data_list?.find((d: any) => d.rotation != null)?.rotation ?? 0)
  )
  const swap = rot === 90 || rot === 270
  const width = swap ? v.height : v.width
  const height = swap ? v.width : v.height

  return {
    path,
    fileName: basename(path),
    fileSize: statSync(path).size,
    duration: Number(data.format?.duration ?? v.duration ?? 0),
    width,
    height,
    fps: Math.round(parseFps(v.avg_frame_rate || v.r_frame_rate) * 100) / 100,
    videoCodec: v.codec_name,
    orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square',
    audioStreams: streams
      .filter((s) => s.codec_type === 'audio')
      .map((s) => ({
        codec: s.codec_name,
        sampleRate: Number(s.sample_rate ?? 0),
        channels: Number(s.channels ?? 0),
        language: s.tags?.language
      }))
  }
}

/** Extracts a single JPEG frame. Runs ffmpeg as a child process; never blocks the UI. */
export function makeThumbnail(src: string, out: string, atSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      ffmpegPath,
      ['-y', '-ss', String(atSeconds), '-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out],
      { windowsHide: true }
    )
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-500)))))
  })
}

/**
 * Extracts the first audio stream as 16 kHz mono WAV (what Whisper expects).
 * Reports seconds processed via ffmpeg's -progress stream. Returns a cancel function via the signal.
 */
export function extractAudio(
  src: string,
  out: string,
  onProgress: (seconds: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      ffmpegPath,
      ['-y', '-i', src, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', out],
      { windowsHide: true }
    )
    let err = ''
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) {
        const m = l.match(/^out_time_(?:us|ms)=(\d+)/)
        if (m) onProgress(Number(m[1]) / 1e6)
      }
    })
    p.stderr.on('data', (d) => (err += d))
    signal?.addEventListener('abort', () => p.kill())
    p.on('error', reject)
    p.on('close', (code) => {
      if (signal?.aborted) reject(new Error('CANCELLED'))
      else if (code === 0) resolve()
      else reject(new Error(`Audio extraction failed: ${err.slice(-600)}`))
    })
  })
}

function runFfmpegWithProgress(
  args: string[],
  onSeconds: (s: number) => void,
  signal?: AbortSignal,
  cwd?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, [...args, '-progress', 'pipe:1', '-nostats'], { windowsHide: true, cwd })
    let err = ''
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) {
        const m = l.match(/^out_time_us=(\d+)/)
        if (m) onSeconds(Number(m[1]) / 1e6)
      }
    })
    p.stderr.on('data', (d) => (err = (err + d).slice(-3000)))
    signal?.addEventListener('abort', () => p.kill())
    p.on('error', reject)
    p.on('close', (code) => {
      if (signal?.aborted) reject(new Error('CANCELLED'))
      else if (code === 0) resolve()
      else reject(new Error(err))
    })
  })
}

export { runFfmpegWithProgress }

/**
 * Low-resolution H.264 copy used for smooth preview, seeking and face analysis.
 * Uses NVENC when available and falls back to x264, so it works on any PC.
 */
export async function makeProxy(
  src: string,
  out: string,
  hasAudio: boolean,
  onSeconds: (s: number) => void,
  signal?: AbortSignal
): Promise<'nvenc' | 'x264'> {
  const common = ['-y', '-i', src, '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : []), '-vf', 'scale=-2:720:flags=fast_bilinear,format=yuv420p']
  const tail = [...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']), '-movflags', '+faststart', out]
  try {
    await runFfmpegWithProgress([...common, '-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '30', '-g', '15', '-bf', '0', ...tail], onSeconds, signal)
    return 'nvenc'
  } catch (e) {
    if (e instanceof Error && e.message === 'CANCELLED') throw e
    await runFfmpegWithProgress([...common, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-g', '15', ...tail], onSeconds, signal)
    return 'x264'
  }
}

export async function probeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await execFileP(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
    return Number(stdout.trim()) || 0
  } catch {
    return 0
  }
}

export async function detectHardware(): Promise<HardwareInfo> {
  const [{ stdout: ver }, { stdout: enc }] = await Promise.all([
    execFileP(ffmpegPath, ['-version']),
    execFileP(ffmpegPath, ['-hide_banner', '-encoders'])
  ])
  let gpu: string | null = null
  try {
    const { stdout } = await execFileP('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
      timeout: 4000,
      windowsHide: true
    })
    gpu = stdout.trim().split('\n')[0] || null
  } catch {
    /* no NVIDIA GPU or driver: CPU fallback */
  }
  const nvencListed = /h264_nvenc/.test(enc)
  return {
    gpu,
    cuda: gpu !== null,
    // Listed encoder + an NVIDIA GPU present. Real capability is verified at render time (Phase 10/11).
    nvenc: nvencListed && gpu !== null,
    ffmpegVersion: ver.split('\n')[0].replace('ffmpeg version ', '').trim()
  }
}

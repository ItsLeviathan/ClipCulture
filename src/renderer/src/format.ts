export function formatDuration(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return `${h ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB'
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const min = Math.floor(d / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} hr ago`
  return `${Math.floor(h / 24)} d ago`
}

/** Rough guide for the "estimated processing requirements" line. Refined once real timings exist (Phase 11). */
export function estimateProcessing(durationSec: number, hasGpu: boolean): string {
  const min = durationSec / 60
  const perMin = hasGpu ? 0.15 : 0.6
  const est = Math.max(1, Math.round(min * perMin))
  return `~${est} min to analyze on ${hasGpu ? 'your GPU' : 'CPU'} · needs ~${formatSize(durationSec * 2.5e6)} temporary disk space`
}

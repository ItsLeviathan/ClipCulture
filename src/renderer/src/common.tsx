import type { ReactElement } from 'react'
import type { SourceInfo } from '@shared/types'
import { formatDuration, formatSize } from './format'

export function friendlyError(e: unknown): { message: string; details: string } {
  const details = e instanceof Error ? e.message : String(e)
  if (details.includes('UNREADABLE_VIDEO'))
    return { message: "We couldn't read this video. The file may be corrupted or use an unsupported codec.", details }
  return { message: 'Something went wrong while importing this video.', details }
}

export function ErrorBox({ message, details }: { message: string; details: string }): ReactElement {
  return (
    <div className="error">
      <div>{message}</div>
      <details>
        <summary>Technical details</summary>
        <pre>{details}</pre>
      </details>
    </div>
  )
}

export function SourceDetails({ source, thumbnail }: { source: SourceInfo; thumbnail: string | null }): ReactElement {
  const a = source.audioStreams[0]
  const fact = (label: string, value: string): ReactElement => (
    <div className="fact"><span>{label}</span><b>{value}</b></div>
  )
  return (
    <div className="source">
      {thumbnail && <img className="source-thumb" src={thumbnail} alt="" />}
      <div>
        <div className="pname" style={{ fontSize: 17 }}>{source.fileName}</div>
        <div className="facts">
          {fact('Duration', formatDuration(source.duration))}
          {fact('Resolution', `${source.width}×${source.height}`)}
          {fact('Frame rate', `${source.fps} fps`)}
          {fact('Video codec', source.videoCodec.toUpperCase())}
          {fact('Audio', a ? `${a.codec.toUpperCase()} · ${a.channels} ch` : 'None')}
          {fact('File size', formatSize(source.fileSize))}
        </div>
        {source.orientation !== 'landscape' && <p className="warn small">This video isn't landscape, so reframing will behave differently.</p>}
        {!a && <p className="warn small">No audio track found — speech-based highlight detection needs audio.</p>}
        {source.duration > 4200 && <p className="warn small">Longer than ~1 hour: processing will take longer than usual.</p>}
      </div>
    </div>
  )
}

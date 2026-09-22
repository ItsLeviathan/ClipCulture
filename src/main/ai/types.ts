import type { Transcript } from '../../shared/types'

export interface TranscribeOptions {
  audioPath: string
  outPath: string
  language?: string
  onStatus: (message: string) => void
  onProgress: (doneSeconds: number, totalSeconds: number) => void
  signal?: AbortSignal
}

/**
 * Swappable speech-to-text backend. Later phases add HighlightProvider,
 * VisionProvider and MetadataProvider alongside this one.
 */
export interface TranscriptionProvider {
  readonly id: string
  transcribe(opts: TranscribeOptions): Promise<Transcript>
}

export class AiError extends Error {
  constructor(
    message: string,
    public details = ''
  ) {
    super(message)
  }
}

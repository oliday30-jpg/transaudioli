export interface TranscriptionProvider {
  name: string
  transcribe(audio: Buffer, signal: AbortSignal, vocabulary?: string): Promise<string>
}

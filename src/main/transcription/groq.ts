import type { TranscriptionProvider } from './types'

export function createGroqProvider(apiKey: string | undefined): TranscriptionProvider {
  return {
    name: 'groq',
    async transcribe(audio: Buffer, signal: AbortSignal, vocabulary?: string): Promise<string> {
      if (!apiKey) {
        throw new Error('GROQ_API_KEY manquant — voir .env.example')
      }

      const form = new FormData()
      form.append('file', new Blob([Uint8Array.from(audio)], { type: 'audio/webm' }), 'dictee.webm')
      form.append('model', 'whisper-large-v3-turbo')
      form.append('language', 'fr')
      if (vocabulary) form.append('prompt', vocabulary)

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal
      })

      if (!response.ok) {
        throw new Error(`groq ${response.status}: ${await response.text()}`)
      }

      const data = (await response.json()) as { text: string }
      return data.text
    }
  }
}

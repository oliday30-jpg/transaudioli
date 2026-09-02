import type { TranscriptionProvider } from './types'

interface DeepgramResponse {
  results: {
    channels: { alternatives: { transcript: string }[] }[]
  }
}

export function createDeepgramProvider(apiKey: string | undefined): TranscriptionProvider {
  return {
    name: 'deepgram',
    async transcribe(audio: Buffer, signal: AbortSignal, vocabulary?: string): Promise<string> {
      if (!apiKey) {
        throw new Error('DEEPGRAM_API_KEY manquant — voir .env.example')
      }

      const params = new URLSearchParams({ model: 'nova-3', language: 'fr', smart_format: 'true' })
      if (vocabulary) {
        for (const term of vocabulary.split(',').map((t) => t.trim()).filter(Boolean)) {
          params.append('keyterm', term)
        }
      }

      const response = await fetch(
        `https://api.deepgram.com/v1/listen?${params.toString()}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'audio/webm'
          },
          body: Uint8Array.from(audio),
          signal
        }
      )

      if (!response.ok) {
        throw new Error(`deepgram ${response.status}: ${await response.text()}`)
      }

      const data = (await response.json()) as DeepgramResponse
      return data.results.channels[0]?.alternatives[0]?.transcript ?? ''
    }
  }
}

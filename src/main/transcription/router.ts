import type { TranscriptionProvider } from './types'

const PROVIDER_TIMEOUT_MS = 6000

export interface TranscriptionResult {
  text: string
  provider: string
}

export interface Router {
  transcribe(audio: Buffer, vocabulary?: string): Promise<TranscriptionResult>
}

export function createRouter(providers: TranscriptionProvider[]): Router {
  return {
    async transcribe(audio: Buffer, vocabulary?: string): Promise<TranscriptionResult> {
      let lastError: unknown
      for (const provider of providers) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
        try {
          const text = await provider.transcribe(audio, controller.signal, vocabulary)
          return { text, provider: provider.name }
        } catch (error) {
          console.warn(`${provider.name} indisponible, suivant…`, error)
          lastError = error
        } finally {
          clearTimeout(timer)
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Aucun fournisseur disponible')
    }
  }
}

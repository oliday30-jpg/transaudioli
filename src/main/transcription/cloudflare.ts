import { truncateVocabularyToLimit } from './prompt-limit'
import type { TranscriptionProvider } from './types'

// whisper-large-v3-turbo est le même modèle que celui utilisé par Groq — même
// limite de prompt de contexte supposée (~224 tokens), d'où la même marge de
// sécurité pour éviter un rejet silencieux de la requête.
const PROMPT_LIMIT = 896

interface CloudflareResponse {
  success: boolean
  result?: { text: string }
  errors?: Array<{ message: string }>
}

export interface CloudflareCredentials {
  accountId: string | undefined
  apiToken: string | undefined
}

export function createCloudflareProvider(credentials: CloudflareCredentials): TranscriptionProvider {
  return {
    name: 'cloudflare',
    async transcribe(audio: Buffer, signal: AbortSignal, vocabulary?: string): Promise<string> {
      const { accountId, apiToken } = credentials
      if (!accountId || !apiToken) {
        throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN manquant — voir .env.example')
      }

      const body: Record<string, unknown> = {
        audio: audio.toString('base64'),
        language: 'fr'
      }
      if (vocabulary) body.initial_prompt = truncateVocabularyToLimit(vocabulary, PROMPT_LIMIT)

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/openai/whisper-large-v3-turbo`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal
        }
      )

      if (!response.ok) {
        throw new Error(`cloudflare ${response.status}: ${await response.text()}`)
      }

      const data = (await response.json()) as CloudflareResponse
      if (!data.success || !data.result) {
        throw new Error(`cloudflare : ${data.errors?.map((e) => e.message).join(', ') ?? 'échec inconnu'}`)
      }

      return data.result.text
    }
  }
}

import type { TranscriptionProvider } from './types'

const BASE_URL = 'https://generativelanguage.googleapis.com'

interface GeminiFileResponse {
  file: { uri: string; mimeType: string; state?: string }
}

interface GeminiInteractionResponse {
  status?: string
  steps?: Array<{
    content?: Array<{ type?: string; text?: string }>
  }>
}

async function uploadAudio(
  audio: Buffer,
  apiKey: string,
  signal: AbortSignal
): Promise<{ uri: string; mimeType: string }> {
  const mimeType = 'audio/webm'

  const startResponse = await fetch(`${BASE_URL}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(audio.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: 'dictee' } }),
    signal
  })

  if (!startResponse.ok) {
    throw new Error(`gemini upload-start ${startResponse.status}: ${await startResponse.text()}`)
  }

  const uploadUrl = startResponse.headers.get('x-goog-upload-url')
  if (!uploadUrl) {
    throw new Error("gemini : URL d'upload manquante dans la réponse")
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(audio.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: Uint8Array.from(audio),
    signal
  })

  if (!uploadResponse.ok) {
    throw new Error(`gemini upload ${uploadResponse.status}: ${await uploadResponse.text()}`)
  }

  const data = (await uploadResponse.json()) as GeminiFileResponse
  return { uri: data.file.uri, mimeType: data.file.mimeType }
}

function extractTranscriptText(data: GeminiInteractionResponse): string {
  const parts: string[] = []
  for (const step of data.steps ?? []) {
    for (const content of step.content ?? []) {
      if (content.type === 'text' && content.text) parts.push(content.text)
    }
  }
  return parts.join(' ').trim()
}

export function createGeminiProvider(apiKey: string | undefined): TranscriptionProvider {
  return {
    name: 'gemini',
    async transcribe(audio: Buffer, signal: AbortSignal, vocabulary?: string): Promise<string> {
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY manquant — voir .env.example')
      }

      const { uri, mimeType } = await uploadAudio(audio, apiKey, signal)

      const transcriptionConfig: Record<string, unknown> = { language_codes: ['fr-FR'] }
      if (vocabulary) {
        const terms = vocabulary
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 1000)
        if (terms.length > 0) transcriptionConfig.custom_vocabulary = terms
      }

      const response = await fetch(`${BASE_URL}/v1beta/interactions`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gemini-3.5-transcribe',
          input: [{ type: 'audio', uri, mime_type: mimeType }],
          generation_config: { transcription_config: transcriptionConfig }
        }),
        signal
      })

      if (!response.ok) {
        throw new Error(`gemini ${response.status}: ${await response.text()}`)
      }

      const data = (await response.json()) as GeminiInteractionResponse
      if (data.status && data.status !== 'completed') {
        throw new Error(`gemini : statut inattendu "${data.status}"`)
      }

      return extractTranscriptText(data)
    }
  }
}

import type { TranscriptionProvider } from './types'

// Le champ "prompt" de l'API Groq est plafonné à 896 caractères — un
// vocabulaire plus long fait échouer la requête (400), ce qui bascule
// silencieusement sur le fournisseur suivant à chaque dictée.
const GROQ_PROMPT_LIMIT = 896

function truncateVocabularyForGroq(vocabulary: string): string {
  if (vocabulary.length <= GROQ_PROMPT_LIMIT) return vocabulary

  const terms = vocabulary.split(',').map((t) => t.trim())
  const kept: string[] = []
  let length = 0
  for (const term of terms) {
    const addedLength = kept.length === 0 ? term.length : term.length + 2
    if (length + addedLength > GROQ_PROMPT_LIMIT) break
    kept.push(term)
    length += addedLength
  }
  return kept.join(', ')
}

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
      if (vocabulary) form.append('prompt', truncateVocabularyForGroq(vocabulary))

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

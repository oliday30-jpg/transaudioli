// Transcription avec diarisation (qui parle) pour le mode Réunion — distinct
// du routeur de dictée classique, qui renvoie un texte brut sans locuteurs.
// Utilise Deepgram spécifiquement : c'est le seul des 3 fournisseurs à
// diariser, et sans la limite de taille de fichier de Whisper (25 Mo) qui
// nous forçait à découper agressivement.

export interface DiarizedSegment {
  speaker: number
  text: string
  start: number
  end: number
}

interface DeepgramUtterancesResponse {
  results: {
    utterances?: {
      speaker: number
      transcript: string
      start: number
      end: number
    }[]
  }
}

export async function transcribeMeetingChunk(
  audio: Buffer,
  apiKey: string,
  language: string = 'fr',
  signal?: AbortSignal
): Promise<DiarizedSegment[]> {
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY manquant — requis pour le mode Réunion (diarisation)')
  }

  const params = new URLSearchParams({
    model: 'nova-3',
    language,
    smart_format: 'true',
    diarize: 'true',
    utterances: 'true'
  })

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'audio/webm'
    },
    body: Uint8Array.from(audio),
    signal
  })

  if (!response.ok) {
    throw new Error(`deepgram ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as DeepgramUtterancesResponse
  return (data.results.utterances ?? []).map((u) => ({
    speaker: u.speaker,
    text: u.transcript,
    start: u.start,
    end: u.end
  }))
}

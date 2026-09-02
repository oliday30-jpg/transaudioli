// Enregistreur de réunion : mixe micro + audio système dans un seul flux, et
// découpe en segments transcriptibles indépendamment (une réunion de 45 min
// dépasserait les limites de taille des API si on l'envoyait d'un bloc).
//
// Chaque segment chevauche le suivant de quelques centaines de ms — le nouvel
// enregistreur démarre avant que l'ancien s'arrête — pour qu'un mot prononcé
// pile à la jointure ne soit jamais perdu (validé par test : sans ça, un
// segment sur trois environ perd son tout début).

const DEFAULT_CHUNK_DURATION_MS = 3 * 60 * 1000
const DEFAULT_OVERLAP_MS = 800

export interface MeetingRecorderOptions {
  chunkDurationMs?: number
  overlapMs?: number
  onChunkReady: (blob: Blob) => void
  onError?: (error: Error) => void
}

export interface MeetingRecorderHandle {
  stop: () => Promise<void>
}

function startSegment(
  stream: MediaStream,
  onChunkReady: (blob: Blob) => void,
  onError: (error: Error) => void
): MediaRecorder {
  const parts: Blob[] = []
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  recorder.ondataavailable = (event) => parts.push(event.data)
  recorder.onstop = () => onChunkReady(new Blob(parts, { type: 'audio/webm' }))
  recorder.onerror = (event) => onError(new Error(`MediaRecorder: ${(event as ErrorEvent).message}`))
  recorder.start()
  return recorder
}

export async function startMeetingRecording(
  options: MeetingRecorderOptions
): Promise<MeetingRecorderHandle> {
  const chunkDurationMs = options.chunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS
  const overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS
  const onError = options.onError ?? (() => {})

  const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  // Route via session.defaultSession.setDisplayMediaRequestHandler côté main
  // (enregistré au démarrage de l'app) — fournit directement la source et
  // l'audio système, sans afficher de sélecteur d'écran à l'utilisateur.
  const systemStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  const systemAudioOnly = new MediaStream(systemStream.getAudioTracks())

  const audioContext = new AudioContext()
  const destination = audioContext.createMediaStreamDestination()
  audioContext.createMediaStreamSource(micStream).connect(destination)
  audioContext.createMediaStreamSource(systemAudioOnly).connect(destination)

  const tracksToStop = [...micStream.getTracks(), ...systemStream.getTracks()]

  let currentRecorder = startSegment(destination.stream, options.onChunkReady, onError)

  const chunkTimer = setInterval(() => {
    const previousRecorder = currentRecorder
    currentRecorder = startSegment(destination.stream, options.onChunkReady, onError)
    setTimeout(() => previousRecorder.stop(), overlapMs)
  }, chunkDurationMs)

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        clearInterval(chunkTimer)
        const recorderToStop = currentRecorder
        const originalOnStop = recorderToStop.onstop as () => void
        recorderToStop.onstop = () => {
          originalOnStop.call(recorderToStop)
          tracksToStop.forEach((track) => track.stop())
          audioContext.close()
          resolve()
        }
        recorderToStop.stop()
      })
  }
}

// Enregistreur de réunion : mixe micro + audio système dans un seul flux, et
// découpe en segments transcriptibles indépendamment (une réunion de 45 min
// dépasserait les limites de taille des API si on l'envoyait d'un bloc).
//
// Chaque segment chevauche le suivant de quelques centaines de ms — le nouvel
// enregistreur démarre avant que l'ancien s'arrête — pour qu'un mot prononcé
// pile à la jointure ne soit jamais perdu (validé par test : sans ça, un
// segment sur trois environ perd son tout début).
//
// Ces segments de transcription sont chacun un fichier WebM indépendant et
// complet (nouvel objet MediaRecorder à chaque tranche) — parfait pour les
// envoyer un par un à la transcription, mais les recoller bout à bout ne
// produit PAS un flux WebM valide pour une écoute complète : seul le premier
// segment reste lisible, le reste est ignoré par tout lecteur standard (bug
// réel découvert sur une réunion de 107 min, où Deepgram ne retrouvait que
// les 3 premières minutes dans le fichier "complet" sauvegardé). L'audio
// destiné à l'écoute/la sauvegarde est donc enregistré séparément par un
// second MediaRecorder, démarré une seule fois et jamais interrompu avant la
// fin de la réunion — ses morceaux périodiques appartiennent au même flux
// continu et peuvent être recollés sans corrompre le conteneur.

const DEFAULT_CHUNK_DURATION_MS = 3 * 60 * 1000
const DEFAULT_OVERLAP_MS = 800
const FULL_RECORDING_TIMESLICE_MS = 5000

export interface MeetingRecorderOptions {
  chunkDurationMs?: number
  overlapMs?: number
  onChunkReady: (blob: Blob) => void
  onError?: (error: Error) => void
}

export interface MeetingRecorderHandle {
  // Résout avec l'enregistrement complet et continu de la réunion (flux WebM
  // valide, contrairement aux segments de transcription pris isolément).
  stop: () => Promise<Blob>
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

  const fullParts: Blob[] = []
  const fullRecorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' })
  fullRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) fullParts.push(event.data)
  }
  fullRecorder.onerror = (event) => onError(new Error(`MediaRecorder (complet): ${(event as ErrorEvent).message}`))
  fullRecorder.start(FULL_RECORDING_TIMESLICE_MS)

  let currentRecorder = startSegment(destination.stream, options.onChunkReady, onError)

  const chunkTimer = setInterval(() => {
    const previousRecorder = currentRecorder
    currentRecorder = startSegment(destination.stream, options.onChunkReady, onError)
    setTimeout(() => previousRecorder.stop(), overlapMs)
  }, chunkDurationMs)

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        clearInterval(chunkTimer)
        const recorderToStop = currentRecorder
        const originalOnStop = recorderToStop.onstop as () => void
        recorderToStop.onstop = () => {
          originalOnStop.call(recorderToStop)
          fullRecorder.onstop = () => {
            tracksToStop.forEach((track) => track.stop())
            audioContext.close()
            resolve(new Blob(fullParts, { type: 'audio/webm' }))
          }
          fullRecorder.stop()
        }
        recorderToStop.stop()
      })
  }
}

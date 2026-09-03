import { startMeetingRecording, type MeetingRecorderHandle } from './meeting-recorder'

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const dotEl = document.querySelector<HTMLSpanElement>('#dot')!
const shortcutRowsEl = document.querySelector<HTMLDivElement>('#shortcut-rows')!
const vocabularyListsEl = document.querySelector<HTMLDivElement>('#vocabulary-lists')!
const historyBodyEl = document.querySelector<HTMLDivElement>('#history-body')!
const historyTitleEl = document.querySelector<HTMLSpanElement>('#history-title')!
const silenceDurationEl = document.querySelector<HTMLInputElement>('#silence-duration')!
const meetingRetentionEl = document.querySelector<HTMLInputElement>('#meeting-retention')!
const apiKeyRowsEl = document.querySelector<HTMLDivElement>('#api-key-rows')!
const levelFillEl = document.querySelector<HTMLDivElement>('#level-fill')!
const microphoneSelectEl = document.querySelector<HTMLSelectElement>('#microphone-select')!
const providerOrderRowsEl = document.querySelector<HTMLDivElement>('#provider-order-rows')!
const meetingLanguageEl = document.querySelector<HTMLSelectElement>('#meeting-language')!

function formatAccelerator(accelerator: string): string {
  return accelerator.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl')
}

const MODE_LABELS: Record<string, string> = {
  raw: 'brut',
  clean: 'nettoyé',
  rewrite: 'réécrit',
  cancel: 'annuler',
  meeting: 'réunion (démarrer/arrêter)',
  lock: 'verrouiller / déverrouiller'
}

// ---------------------------------------------------------------------------
// Barre de titre & fenêtre
// ---------------------------------------------------------------------------

document.querySelector('#minimize')!.addEventListener('click', () => window.api.windowMinimize())
document.querySelector('#close')!.addEventListener('click', () => window.api.windowClose())

// ---------------------------------------------------------------------------
// Verrouillage global — pause rapide qui rend la dictée et le mode réunion
// inertes (protection contre un raccourci ou un clic accidentel pendant un
// appel sensible). L'état vient toujours du main process, jamais décidé ici.
// ---------------------------------------------------------------------------

const lockToggleBtn = document.querySelector<HTMLButtonElement>('#lock-toggle')!
let isLocked = false

function applyLockState(locked: boolean): void {
  isLocked = locked
  lockToggleBtn.textContent = locked ? '🔒' : '🔓'
  lockToggleBtn.title = locked
    ? 'Verrouillé — cliquer pour déverrouiller'
    : 'Verrouiller (empêche toute dictée/réunion accidentelle)'
  document.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) => (b.disabled = locked))
  if (locked) {
    statusEl.textContent = '🔒 Verrouillé'
  } else if (statusEl.textContent === '🔒 Verrouillé') {
    statusEl.textContent = 'Prêt.'
  }
}

lockToggleBtn.addEventListener('click', () => window.api.toggleLock())
window.api.onLockChanged(applyLockState)

// ---------------------------------------------------------------------------
// Boutons de dictée manuelle (équivalents cliquables des raccourcis)
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('.modes button').forEach((button) => {
  button.addEventListener('click', () => window.api.manualToggle(button.dataset.mode!))
})

// ---------------------------------------------------------------------------
// Sections repliables
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('.section-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const section = document.getElementById(button.dataset.toggle!)!
    const wasOpen = section.classList.contains('open')
    section.classList.toggle('open')
    if (!wasOpen && button.dataset.toggle === 'section-history') loadHistory()
    if (!wasOpen && button.dataset.toggle === 'section-usage') loadUsage()
    if (!wasOpen && button.dataset.toggle === 'section-meeting-list') loadMeetingList()
  })
})

document.querySelector('#voice-commands-more')!.addEventListener('click', (event) => {
  event.preventDefault()
  document.getElementById('section-settings')!.classList.add('open')
  document.getElementById('voice-commands-section')!.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

// ---------------------------------------------------------------------------
// Enregistrement audio (micro, bips, détection de silence)
// ---------------------------------------------------------------------------

let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let audioContext: AudioContext | null = null
let silenceCheckInterval: ReturnType<typeof setInterval> | null = null
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let hasSpoken = false
let recordingStartedAt = 0

// Seuils de détection de silence — écarts d'amplitude sur un signal 0-255
// centré à 128 (silence pur = ~0). À ajuster si l'auto-stop est trop
// nerveux ou trop lent selon le micro utilisé.
const SPEECH_THRESHOLD = 18
const SILENCE_THRESHOLD = 12
let silenceDurationMs = 1800 // remplacé par la valeur des réglages au chargement
let selectedMicrophoneId = '' // '' = micro par défaut du système

function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext()
  return audioContext
}

function beep(frequency: number, durationMs: number): void {
  const ctx = getAudioContext()
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.frequency.value = frequency
  gain.gain.value = 0.2
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start()
  oscillator.stop(ctx.currentTime + durationMs / 1000)
}

function stopSilenceWatch(): void {
  if (silenceCheckInterval) clearInterval(silenceCheckInterval)
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceCheckInterval = null
  silenceTimer = null
}

function watchSilence(currentStream: MediaStream, onSilence: () => void): void {
  const ctx = getAudioContext()
  const source = ctx.createMediaStreamSource(currentStream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  const data = new Uint8Array(analyser.frequencyBinCount)
  hasSpoken = false

  silenceCheckInterval = setInterval(() => {
    analyser.getByteTimeDomainData(data)
    let maxDeviation = 0
    for (const value of data) {
      maxDeviation = Math.max(maxDeviation, Math.abs(value - 128))
    }

    levelFillEl.style.width = `${Math.min(100, (maxDeviation / 128) * 100 * 1.6)}%`

    if (maxDeviation > SPEECH_THRESHOLD) {
      hasSpoken = true
      if (silenceTimer) {
        clearTimeout(silenceTimer)
        silenceTimer = null
      }
    } else if (
      hasSpoken &&
      silenceDurationMs > 0 &&
      maxDeviation < SILENCE_THRESHOLD &&
      !silenceTimer
    ) {
      silenceTimer = setTimeout(onSilence, silenceDurationMs)
    }
  }, 150)
}

async function startRecording(): Promise<void> {
  statusEl.textContent = '● Enregistrement…'
  dotEl.classList.add('recording')
  beep(880, 150)
  recordingStartedAt = Date.now()

  stream = await navigator.mediaDevices.getUserMedia({
    audio: selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : true
  })
  chunks = []
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  recorder.ondataavailable = (event) => chunks.push(event.data)
  recorder.start()

  watchSilence(stream, () => {
    window.api.notifyAutoStop()
    stopRecording().catch((error) => {
      statusEl.textContent = `Erreur : ${error.message}`
    })
  })
}

async function stopRecording(): Promise<void> {
  if (!recorder) return
  stopSilenceWatch()
  dotEl.classList.remove('recording')
  levelFillEl.style.width = '0%'
  beep(440, 150)

  const finished = new Promise<void>((resolve) => {
    recorder!.onstop = () => resolve()
  })
  recorder.stop()
  await finished

  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  recorder = null

  const blob = new Blob(chunks, { type: 'audio/webm' })
  const buffer = await blob.arrayBuffer()
  const durationMs = Date.now() - recordingStartedAt
  window.api.sendAudio(buffer, durationMs)
  statusEl.textContent = 'Transcription en cours…'
}

function cancelRecording(): void {
  stopSilenceWatch()
  dotEl.classList.remove('recording')
  levelFillEl.style.width = '0%'
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null
    recorder.stop()
  }
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  recorder = null
  chunks = []
  statusEl.textContent = 'Annulé — prêt pour une nouvelle dictée.'
}

window.api.onStart(() => {
  startRecording().catch((error) => {
    statusEl.textContent = `Erreur micro : ${error.message}`
  })
})

window.api.onStop(() => {
  stopRecording().catch((error) => {
    statusEl.textContent = `Erreur : ${error.message}`
  })
})

window.api.onCancel(() => {
  cancelRecording()
})

window.api.onTranscribed(({ text, provider, mode, template }) => {
  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text
  const via = provider === 'groq' ? '' : ` (via ${provider})`
  const modeLabel = template ? `${MODE_LABELS[mode] ?? mode} · ${template}` : (MODE_LABELS[mode] ?? mode)
  statusEl.textContent = `Copié ✅ [${modeLabel}]${via} — "${preview}"`
})

window.api.onTranscriptionError((message) => {
  statusEl.textContent = `Erreur transcription : ${message}`
})

// ---------------------------------------------------------------------------
// Réglages : raccourcis modifiables + vocabulaire
// ---------------------------------------------------------------------------

function eventToAccelerator(event: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null

  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')

  const specialMap: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc'
  }
  const mainKey = specialMap[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key)
  parts.push(mainKey)
  return parts.join('+')
}

function startCapture(key: string, button: HTMLButtonElement): void {
  const kbdEl = shortcutRowsEl.querySelector<HTMLSpanElement>(`.kbd[data-key="${key}"]`)!
  const original = kbdEl.textContent!
  kbdEl.textContent = 'Appuie sur une touche…'
  button.disabled = true

  const onKeydown = (event: KeyboardEvent): void => {
    event.preventDefault()
    const accelerator = eventToAccelerator(event)
    if (!accelerator) return // touche modificatrice seule : on attend la vraie touche

    window.removeEventListener('keydown', onKeydown, true)
    window.api.updateShortcut(key, accelerator).then((ok) => {
      kbdEl.textContent = ok ? formatAccelerator(accelerator) : `${original} (déjà pris)`
      button.disabled = false
    })
  }

  window.addEventListener('keydown', onKeydown, true)
}

async function renderMicrophoneOptions(storedMicrophoneId: string): Promise<void> {
  let devices = await navigator.mediaDevices.enumerateDevices()
  let mics = devices.filter((d) => d.kind === 'audioinput')

  // Sans autorisation micro préalable, les labels sont vides ("Microphone 1").
  // On déclenche une demande d'autorisation courte pour les récupérer.
  if (mics.length > 0 && mics.every((m) => !m.label)) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
      probe.getTracks().forEach((track) => track.stop())
      devices = await navigator.mediaDevices.enumerateDevices()
      mics = devices.filter((d) => d.kind === 'audioinput')
    } catch {
      // Autorisation refusée : on garde les labels génériques, pas bloquant.
    }
  }

  selectedMicrophoneId = storedMicrophoneId
  microphoneSelectEl.innerHTML =
    '<option value="">Micro par défaut du système</option>' +
    mics
      .map(
        (mic, index) =>
          `<option value="${mic.deviceId}">${escapeHtml(mic.label || `Microphone ${index + 1}`)}</option>`
      )
      .join('')
  microphoneSelectEl.value = storedMicrophoneId
}

microphoneSelectEl.addEventListener('change', () => {
  selectedMicrophoneId = microphoneSelectEl.value
  window.api.updateMicrophone(selectedMicrophoneId)
})

meetingLanguageEl.addEventListener('change', () => {
  window.api.updateMeetingLanguage(meetingLanguageEl.value as 'fr' | 'en')
})

meetingRetentionEl.addEventListener('change', () => {
  const days = Math.max(0, Math.floor(Number(meetingRetentionEl.value) || 0))
  meetingRetentionEl.value = String(days)
  window.api.updateMeetingRetention(days)
})

const PROVIDER_LABELS: Record<string, string> = {
  groq: 'Groq',
  deepgram: 'Deepgram',
  whisper: 'Whisper (OpenAI)'
}

function renderProviderOrder(order: string[]): void {
  providerOrderRowsEl.innerHTML = order
    .map(
      (provider, index) => `
      <div class="provider-order-row" data-provider="${provider}">
        <div><span class="rank">${index + 1}</span>${PROVIDER_LABELS[provider] ?? provider}</div>
        <div class="order-buttons">
          <button data-move="up" ${index === 0 ? 'disabled' : ''} title="Monter">↑</button>
          <button data-move="down" ${index === order.length - 1 ? 'disabled' : ''} title="Descendre">↓</button>
        </div>
      </div>`
    )
    .join('')

  providerOrderRowsEl.querySelectorAll<HTMLButtonElement>('button[data-move]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest<HTMLDivElement>('.provider-order-row')!
      const provider = row.dataset.provider!
      const currentIndex = order.indexOf(provider)
      const targetIndex = button.dataset.move === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= order.length) return

      const newOrder = [...order]
      ;[newOrder[currentIndex], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[currentIndex]]
      window.api.updateProviderOrder(newOrder)
      renderProviderOrder(newOrder)
    })
  })
}

async function renderSettings(): Promise<void> {
  const {
    shortcuts,
    silenceDurationMs: storedSilenceMs,
    projectPath,
    microphoneId,
    providerOrder,
    meetingLanguage,
    meetingRetentionDays,
    locked,
    shortcutsRegistered
  } = await window.api.getSettings()
  applyLockState(locked)
  await renderVocabularyLists()
  meetingLanguageEl.value = meetingLanguage
  meetingRetentionEl.value = String(meetingRetentionDays)

  silenceDurationMs = storedSilenceMs
  silenceDurationEl.value = String(storedSilenceMs / 1000)

  renderMicrophoneOptions(microphoneId)
  renderProviderOrder(providerOrder)

  const projectPathDisplay = document.querySelector<HTMLSpanElement>('#project-path-display')!
  const clearProjectBtn = document.querySelector<HTMLButtonElement>('#clear-project')!
  projectPathDisplay.textContent = projectPath || 'Aucun'
  projectPathDisplay.title = projectPath
  clearProjectBtn.style.display = projectPath ? 'inline' : 'none'

  document.querySelector('#clean-hint')!.textContent = formatAccelerator(shortcuts.clean)
  document.querySelector('#rewrite-hint')!.textContent = formatAccelerator(shortcuts.rewrite)
  document.querySelector('#meeting-shortcut-hint')!.textContent = formatAccelerator(shortcuts.meeting)

  shortcutRowsEl.innerHTML = ''
  for (const key of ['raw', 'clean', 'rewrite', 'cancel', 'meeting', 'lock']) {
    const conflict = !shortcutsRegistered[key]
    const row = document.createElement('div')
    row.className = 'shortcut-row'
    row.innerHTML = `
      <div class="label">${MODE_LABELS[key]}${conflict ? ' <span style="color:#b3401e">(conflit)</span>' : ''}</div>
      <div class="keys">
        <span class="kbd" data-key="${key}">${formatAccelerator(shortcuts[key])}</span>
        <button class="modify-link" data-key="${key}">Modifier</button>
      </div>
    `
    shortcutRowsEl.appendChild(row)
  }

  shortcutRowsEl.querySelectorAll<HTMLButtonElement>('.modify-link').forEach((button) => {
    button.addEventListener('click', () => startCapture(button.dataset.key!, button))
  })

  const overallWarning = Object.values(shortcutsRegistered).some((ok) => !ok)
  if (overallWarning) {
    statusEl.textContent = '⚠️ Un ou plusieurs raccourcis sont pris par une autre application — voir Réglages.'
    statusEl.style.color = '#b3401e'
  }
}

interface VocabularyList {
  id: string
  name: string
  terms: string
  enabled: boolean
}

async function renderVocabularyLists(): Promise<void> {
  const lists = await window.api.listVocabulary()

  vocabularyListsEl.innerHTML = lists
    .map(
      (list: VocabularyList) => `
      <div class="vocab-list-card" data-id="${list.id}">
        <div class="vocab-list-header">
          <input type="checkbox" class="vocab-list-enabled" ${list.enabled ? 'checked' : ''} title="Active" />
          <input type="text" class="vocab-list-name" value="${escapeHtml(list.name)}" />
          <button class="vocab-list-delete" title="Supprimer">✕</button>
        </div>
        <textarea class="vocab-list-terms" ${list.enabled ? '' : 'disabled'} placeholder="Termes séparés par des virgules…">${escapeHtml(list.terms)}</textarea>
      </div>`
    )
    .join('')

  vocabularyListsEl.querySelectorAll<HTMLDivElement>('.vocab-list-card').forEach((card) => {
    const id = card.dataset.id!
    const enabledEl = card.querySelector<HTMLInputElement>('.vocab-list-enabled')!
    const nameEl = card.querySelector<HTMLInputElement>('.vocab-list-name')!
    const termsEl = card.querySelector<HTMLTextAreaElement>('.vocab-list-terms')!

    enabledEl.addEventListener('change', () => {
      termsEl.disabled = !enabledEl.checked
      window.api.updateVocabularyList(id, { enabled: enabledEl.checked })
    })
    nameEl.addEventListener('change', () => {
      window.api.updateVocabularyList(id, { name: nameEl.value.trim() || 'Sans nom' })
    })
    termsEl.addEventListener('change', () => {
      window.api.updateVocabularyList(id, { terms: termsEl.value })
    })
    card.querySelector('.vocab-list-delete')!.addEventListener('click', async () => {
      await window.api.removeVocabularyList(id)
      await renderVocabularyLists()
    })
  })
}

document.querySelector('#add-vocabulary-list')!.addEventListener('click', async () => {
  await window.api.addVocabularyList('Nouvelle liste', '')
  await renderVocabularyLists()
})

document.querySelector('#choose-project')!.addEventListener('click', async () => {
  const chosen = await window.api.chooseProjectFolder()
  if (chosen) await renderSettings()
})

document.querySelector('#clear-project')!.addEventListener('click', async () => {
  await window.api.clearProjectFolder()
  await renderSettings()
})

// ---------------------------------------------------------------------------
// Clés API
// ---------------------------------------------------------------------------

const API_PROVIDERS = [
  { key: 'groq', label: 'Groq', url: 'https://console.groq.com/keys' },
  { key: 'deepgram', label: 'Deepgram', url: 'https://console.deepgram.com' },
  { key: 'openai', label: 'OpenAI', url: 'https://platform.openai.com/api-keys' }
] as const

async function renderApiKeys(): Promise<void> {
  const status = await window.api.getApiKeyStatus()

  const encryptionHint = status.encrypted
    ? '<p class="field-hint">🔒 Clés chiffrées sur ce PC (liées à ta session Windows).</p>'
    : '<p class="field-hint" style="color: var(--danger)">⚠️ Chiffrement indisponible sur ce système — clés stockées en clair.</p>'

  apiKeyRowsEl.innerHTML =
    encryptionHint +
    API_PROVIDERS.map(({ key, label, url }) => {
    const configured = status[key]
    const placeholder = configured ? 'Clé enregistrée — laisse vide pour ne pas la changer' : 'Colle ta clé ici'
    return `
      <div class="api-key-row">
        <div class="row-top">
          <strong>${label}</strong>
          <a href="${url}" target="_blank" rel="noopener">créer une clé ↗</a>
        </div>
        <input type="password" id="key-${key}" placeholder="${placeholder}" autocomplete="off" />
        <span class="key-status ${configured ? 'ok' : 'missing'}">${configured ? '✓ configurée' : 'non configurée'}</span>
      </div>`
  }).join('')
}

document.querySelector('#save-api-keys')!.addEventListener('click', async () => {
  const keys: Partial<Record<(typeof API_PROVIDERS)[number]['key'], string>> = {}
  for (const { key } of API_PROVIDERS) {
    const input = document.querySelector<HTMLInputElement>(`#key-${key}`)!
    if (input.value.trim()) keys[key] = input.value.trim()
  }

  if (Object.keys(keys).length === 0) return

  try {
    await window.api.updateApiKeys(keys)
    statusEl.textContent = 'Clés API chiffrées et enregistrées ✅ — effectives immédiatement.'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    statusEl.textContent = `Erreur lors de l'enregistrement des clés : ${message}`
  }
  await renderApiKeys()
})

silenceDurationEl.addEventListener('change', () => {
  const seconds = Math.max(0, Number(silenceDurationEl.value) || 0)
  silenceDurationMs = seconds * 1000
  silenceDurationEl.value = String(seconds)
  window.api.updateSilenceDuration(silenceDurationMs)
})

// ---------------------------------------------------------------------------
// Démarrage automatique
// ---------------------------------------------------------------------------

const autolaunchEl = document.querySelector<HTMLInputElement>('#autolaunch')!

window.api.getAutoLaunch().then((enabled) => {
  autolaunchEl.checked = enabled
})

autolaunchEl.addEventListener('change', () => {
  window.api.setAutoLaunch(autolaunchEl.checked)
})

// ---------------------------------------------------------------------------
// Mises à jour automatiques
// ---------------------------------------------------------------------------

const appVersionEl = document.querySelector<HTMLSpanElement>('#app-version')!
const updateStatusEl = document.querySelector<HTMLParagraphElement>('#update-status')!
const installUpdateBtn = document.querySelector<HTMLButtonElement>('#install-update')!
const checkUpdatesBtn = document.querySelector<HTMLButtonElement>('#check-updates')!

window.api.getAppVersion().then((version) => {
  appVersionEl.textContent = `Version ${version}`
})

checkUpdatesBtn.addEventListener('click', () => {
  updateStatusEl.textContent = 'Vérification…'
  window.api.checkForUpdates()
})

installUpdateBtn.addEventListener('click', () => {
  window.api.installUpdate()
})

window.api.onUpdateStatus((status) => {
  switch (status.state) {
    case 'checking':
      updateStatusEl.textContent = 'Vérification…'
      break
    case 'up-to-date':
      updateStatusEl.textContent = 'À jour ✅'
      break
    case 'available':
      updateStatusEl.textContent = `Version ${status.version} disponible — téléchargement…`
      break
    case 'downloading':
      updateStatusEl.textContent = `Téléchargement… ${status.percent}%`
      break
    case 'downloaded':
      updateStatusEl.textContent = `Version ${status.version} prête à installer.`
      installUpdateBtn.style.display = 'inline-block'
      break
    case 'error':
      updateStatusEl.textContent = `Erreur : ${status.message}`
      break
  }
})

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

interface HistoryEntry {
  text: string
  provider: string
  mode: string
  timestamp: number
}

let currentHistory: HistoryEntry[] = []
const historySearchEl = document.querySelector<HTMLInputElement>('#history-search')!

function renderHistoryList(entries: HistoryEntry[]): void {
  historyTitleEl.textContent = `🕓 Historique (${currentHistory.length})`

  if (currentHistory.length === 0) {
    historyBodyEl.innerHTML = '<div class="empty">Aucune dictée pour l\'instant.</div>'
    return
  }

  if (entries.length === 0) {
    historyBodyEl.innerHTML = '<div class="empty">Aucun résultat pour cette recherche.</div>'
    return
  }

  historyBodyEl.innerHTML = entries
    .map(
      (entry) => `
      <div class="history-item" data-timestamp="${entry.timestamp}">
        <div class="meta">
          <span>${new Date(entry.timestamp).toLocaleString('fr-FR')}</span>
          <span>· ${MODE_LABELS[entry.mode] ?? entry.mode}</span>
          <span class="provider-badge${entry.provider === 'groq' ? '' : ' fallback'}">${entry.provider}</span>
          <button class="history-delete" data-timestamp="${entry.timestamp}" title="Supprimer">✕</button>
        </div>
        <div>${escapeHtml(entry.text)}</div>
      </div>`
    )
    .join('')

  historyBodyEl.querySelectorAll<HTMLDivElement>('.history-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.history-delete')) return
      const timestamp = Number(item.dataset.timestamp)
      const entry = currentHistory.find((e) => e.timestamp === timestamp)
      if (!entry) return
      window.api.copyText(entry.text)
      statusEl.textContent = "Copié depuis l'historique ✅"
    })
  })

  historyBodyEl.querySelectorAll<HTMLButtonElement>('.history-delete').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation()
      const timestamp = Number(button.dataset.timestamp)
      await window.api.deleteHistoryEntry(timestamp)
      currentHistory = currentHistory.filter((e) => e.timestamp !== timestamp)
      renderHistoryList(filterHistory(historySearchEl.value))
    })
  })
}

function filterHistory(query: string): HistoryEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return currentHistory
  return currentHistory.filter((entry) => entry.text.toLowerCase().includes(q))
}

async function loadHistory(): Promise<void> {
  currentHistory = await window.api.getHistory()
  historySearchEl.value = ''
  renderHistoryList(currentHistory)
}

historySearchEl.addEventListener('input', () => {
  renderHistoryList(filterHistory(historySearchEl.value))
})

document.querySelector('#clear-history')!.addEventListener('click', async () => {
  await window.api.clearHistory()
  currentHistory = []
  renderHistoryList([])
})

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const usageBodyEl = document.querySelector<HTMLDivElement>('#usage-body')!

async function loadUsage(): Promise<void> {
  const { seconds, costRates } = await window.api.getUsage()
  const providers = Object.keys(seconds)

  if (providers.length === 0) {
    usageBodyEl.innerHTML = '<div class="empty">Aucune dictée pour l\'instant.</div>'
    return
  }

  usageBodyEl.innerHTML = providers
    .map((provider) => {
      const minutes = seconds[provider] / 60
      const rate = costRates[provider]
      const estimate = rate ? ` ≈ ${(minutes * rate).toFixed(2)}$` : ''
      return `
        <div class="usage-row">
          <span class="usage-label">${provider}</span>
          <span class="usage-minutes">${minutes.toFixed(1)} min${estimate}</span>
          <span class="usage-rate">
            $/min <input type="number" step="0.001" min="0" data-provider="${provider}" value="${rate ?? ''}" placeholder="0" />
          </span>
        </div>`
    })
    .join('')

  usageBodyEl.querySelectorAll<HTMLInputElement>('input[data-provider]').forEach((input) => {
    input.addEventListener('change', async () => {
      const provider = input.dataset.provider!
      const rate = Math.max(0, Number(input.value) || 0)
      await window.api.setCostRate(provider, rate)
      await loadUsage()
    })
  })
}

// ---------------------------------------------------------------------------
// Réunion
// ---------------------------------------------------------------------------

interface MeetingSegment {
  speaker: number
  text: string
}

const MEETING_CHUNK_DURATION_MS = 3 * 60 * 1000

let meetingHandle: MeetingRecorderHandle | null = null
let meetingSegments: MeetingSegment[] = []
let meetingStartedAt = 0
let meetingTimerInterval: ReturnType<typeof setInterval> | null = null
let pendingMeetingChunks = 0
// Conservés pour recoller un fichier audio complet à la fin — permet
// d'écouter la réunion en parallèle du transcript (identifier les
// intervenants plus facilement). Les morceaux se chevauchent légèrement
// (voir meeting-recorder.ts) donc le fichier recollé a de très courts
// passages en double aux jointures, acceptable pour de l'écoute.
let recordedChunkBlobs: Blob[] = []

const meetingToggleBtn = document.querySelector<HTMLButtonElement>('#meeting-toggle')!
const meetingTimerEl = document.querySelector<HTMLSpanElement>('#meeting-timer')!
const meetingLiveEl = document.querySelector<HTMLDivElement>('#meeting-live')!
const meetingResultEl = document.querySelector<HTMLDivElement>('#meeting-result')!

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const AUDIO_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  aac: 'audio/aac'
}

// Récupère l'audio via IPC (pas de lien file:// direct : ne se charge pas
// pareil selon dev — page servie en http:// — ou version empaquetée — page
// servie en file://) et le transforme en blob: URL pour l'élément <audio>.
async function loadMeetingAudio(audioPath: string, audioEl: HTMLAudioElement): Promise<void> {
  const buffer = await window.api.getMeetingAudio(audioPath)
  const extension = audioPath.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = AUDIO_MIME_TYPES_BY_EXTENSION[extension] ?? 'audio/webm'
  audioEl.src = URL.createObjectURL(new Blob([buffer], { type: mimeType }))

  // Les .webm issus de MediaRecorder (réunions enregistrées en direct) n'ont
  // pas de durée dans leurs métadonnées — Chromium affiche "Infinity" tant
  // qu'on n'a pas cherché une fois vers la fin, ce qui force son recalcul.
  // Contournement standard, inoffensif sur un fichier qui a déjà une durée
  // correcte (import audio).
  audioEl.addEventListener(
    'durationchange',
    function fixInfiniteDuration() {
      if (audioEl.duration !== Infinity) return
      audioEl.removeEventListener('durationchange', fixInfiniteDuration)
      audioEl.currentTime = 1e101
      audioEl.addEventListener(
        'timeupdate',
        function resetToStart() {
          audioEl.removeEventListener('timeupdate', resetToStart)
          audioEl.currentTime = 0
        },
        { once: true }
      )
    },
    { once: false }
  )
}

// Rendu minimal du Markdown produit par le résumé (## titres, listes à
// puces, paragraphes) — pas besoin d'une librairie pour un format aussi
// prévisible, vu qu'on contrôle le prompt qui le génère.
function renderMarkdownLite(markdown: string): string {
  const withInline: (text: string) => string = escapeHtml
  const htmlLines = markdown.split('\n').map((line) => {
    if (line.startsWith('## ')) return `<h4>${withInline(line.slice(3))}</h4>`
    if (line.startsWith('- ')) return `<li>${withInline(line.slice(2))}</li>`
    if (!line.trim()) return ''
    return `<p>${withInline(line)}</p>`
  })
  return htmlLines.join('\n').replace(/(<li>.*?<\/li>\n?)+/gs, (match) => `<ul>${match}</ul>`)
}

async function startMeeting(): Promise<void> {
  meetingSegments = []
  pendingMeetingChunks = 0
  recordedChunkBlobs = []
  meetingLiveEl.innerHTML = ''
  meetingResultEl.style.display = 'none'
  meetingResultEl.innerHTML = ''
  meetingStartedAt = Date.now()
  meetingTimerInterval = setInterval(() => {
    meetingTimerEl.textContent = formatElapsed(Date.now() - meetingStartedAt)
  }, 1000)

  meetingHandle = await startMeetingRecording({
    chunkDurationMs: MEETING_CHUNK_DURATION_MS,
    onChunkReady: async (blob) => {
      pendingMeetingChunks++
      recordedChunkBlobs.push(blob)
      const buffer = await blob.arrayBuffer()
      window.api.sendMeetingChunk(buffer)
    },
    onError: (error) => {
      meetingLiveEl.insertAdjacentHTML(
        'beforeend',
        `<div class="meeting-error">Erreur : ${escapeHtml(error.message)}</div>`
      )
    }
  })

  meetingToggleBtn.textContent = 'Terminer la réunion'
  window.api.showToast('🎙️ Réunion démarrée')
}

window.api.onMeetingChunkTranscribed((segments) => {
  pendingMeetingChunks--
  for (const seg of segments) {
    meetingSegments.push({ speaker: seg.speaker, text: seg.text })
    const div = document.createElement('div')
    div.className = 'meeting-utterance'
    div.innerHTML = `<span class="speaker-label">Intervenant ${seg.speaker}</span>${escapeHtml(seg.text)}`
    meetingLiveEl.appendChild(div)
  }
  meetingLiveEl.scrollTop = meetingLiveEl.scrollHeight
})

window.api.onMeetingChunkError((message) => {
  pendingMeetingChunks--
  meetingLiveEl.insertAdjacentHTML(
    'beforeend',
    `<div class="meeting-error">Segment perdu : ${escapeHtml(message)}</div>`
  )
})

async function stopMeeting(): Promise<void> {
  if (!meetingHandle) return
  meetingToggleBtn.disabled = true
  meetingToggleBtn.textContent = 'Finalisation…'

  await meetingHandle.stop()
  meetingHandle = null
  if (meetingTimerInterval) clearInterval(meetingTimerInterval)

  while (pendingMeetingChunks > 0) {
    await new Promise((r) => setTimeout(r, 300))
  }

  const fullTranscript = meetingSegments.map((s) => `Intervenant ${s.speaker} : ${s.text}`).join('\n')

  meetingResultEl.style.display = 'block'
  meetingResultEl.innerHTML = '<p class="empty">Génération du résumé…</p>'

  const summary = await window.api.summarizeMeeting(fullTranscript)
  const durationMs = Date.now() - meetingStartedAt
  const audioBuffer =
    recordedChunkBlobs.length > 0 ? await new Blob(recordedChunkBlobs, { type: 'audio/webm' }).arrayBuffer() : undefined
  const { filePath: savedPath, title: savedTitle } = await window.api.saveMeeting({
    transcript: fullTranscript,
    summary,
    durationMs,
    audioBuffer
  })
  recordedChunkBlobs = []

  meetingResultEl.innerHTML = `
    <div class="meeting-summary">${renderMarkdownLite(summary)}</div>
    <p class="field-hint">Enregistré : ${escapeHtml(savedPath)}</p>
    <button class="modify-link" id="meeting-export-now">⬇ Exporter en PDF</button>
    <button class="modify-link" id="meeting-export-email-now">✉️ Envoyer par email</button>
  `

  meetingToggleBtn.disabled = false
  meetingToggleBtn.textContent = 'Démarrer la réunion'
  meetingTimerEl.textContent = ''
  window.api.showToast('⏹️ Réunion terminée — résumé enregistré')

  document.querySelector('#meeting-export-now')!.addEventListener('click', async () => {
    const savedPdfPath = await window.api.exportMeetingPdf(savedPath, savedTitle)
    if (savedPdfPath) statusEl.textContent = `PDF exporté : ${savedPdfPath} ✅`
  })

  document.querySelector('#meeting-export-email-now')!.addEventListener('click', async () => {
    await window.api.exportMeetingEmail(savedPath, savedTitle)
    statusEl.textContent = 'Client mail ouvert avec le résumé ✅'
  })

  if (document.getElementById('section-meeting-list')?.classList.contains('open')) {
    loadMeetingList()
  }
}

meetingToggleBtn.addEventListener('click', () => {
  if (meetingHandle) {
    // Arrêter une réunion en cours reste toujours possible, même verrouillé
    // — comme "annuler" pour la dictée, ça ne peut jamais faire de mal.
    stopMeeting().catch((error) => {
      meetingResultEl.style.display = 'block'
      meetingResultEl.innerHTML = `<p style="color: var(--danger)">Erreur : ${escapeHtml(error.message)}</p>`
    })
  } else if (!isLocked) {
    startMeeting().catch((error) => {
      meetingLiveEl.innerHTML = `<p style="color: var(--danger)">Erreur : ${escapeHtml(error.message)}</p>`
    })
  }
})

// Le raccourci clavier réutilise exactement le même chemin que le bouton —
// pas de logique dupliquée, juste un déclenchement différent.
window.api.onMeetingToggleShortcut(() => {
  if (!meetingToggleBtn.disabled) meetingToggleBtn.click()
})

// ---------------------------------------------------------------------------
// Réunions enregistrées (Phase F : liste/recherche des réunions sauvegardées)
// ---------------------------------------------------------------------------

interface MeetingIndexEntry {
  id: number
  title: string
  date: number
  durationMs: number
  filePath: string
  imported?: boolean
  audioPath?: string
}

let currentMeetings: MeetingIndexEntry[] = []
const meetingListTitleEl = document.querySelector<HTMLSpanElement>('#meeting-list-title')!
const meetingListBodyEl = document.querySelector<HTMLDivElement>('#meeting-list-body')!
const meetingListSearchEl = document.querySelector<HTMLInputElement>('#meeting-list-search')!

function renderMeetingList(entries: MeetingIndexEntry[]): void {
  meetingListTitleEl.textContent = `🗂️ Réunions enregistrées (${currentMeetings.length})`

  if (currentMeetings.length === 0) {
    meetingListBodyEl.innerHTML = '<div class="empty">Aucune réunion enregistrée pour l\'instant.</div>'
    return
  }

  if (entries.length === 0) {
    meetingListBodyEl.innerHTML = '<div class="empty">Aucun résultat pour cette recherche.</div>'
    return
  }

  meetingListBodyEl.innerHTML = entries
    .map(
      (entry) => `
      <div class="history-item meeting-list-item" data-id="${entry.id}">
        <div class="meta">
          <span>${new Date(entry.date).toLocaleString('fr-FR')}</span>
          ${entry.imported ? '<span class="imported-badge">📥 Importé</span>' : `<span>· ${formatElapsed(entry.durationMs)}</span>`}
        </div>
        <div class="meeting-list-title-row">
          <input type="text" class="title meeting-title-input" value="${escapeHtml(entry.title)}" />
          <button class="meeting-export-btn" data-id="${entry.id}" title="Exporter en PDF (compatible Notability)">⬇ PDF</button>
          <button class="meeting-export-email-btn" data-id="${entry.id}" title="Envoyer le résumé par email">✉️</button>
          <button class="history-delete" data-id="${entry.id}" title="Supprimer">✕</button>
        </div>
        <div class="meeting-list-body" style="display: none"></div>
      </div>`
    )
    .join('')

  meetingListBodyEl.querySelectorAll<HTMLDivElement>('.meeting-list-item').forEach((item) => {
    const titleRow = item.querySelector<HTMLDivElement>('.meeting-list-title-row')!
    const body = item.querySelector<HTMLDivElement>('.meeting-list-body')!
    const id = Number(item.dataset.id)
    const entry = currentMeetings.find((m) => m.id === id)
    if (!entry) return
    const filePath = entry.filePath
    const audioPath = entry.audioPath

    // Pas de stopPropagation ici : le champ occupe presque toute la largeur
    // de la ligne, donc bloquer la propagation empêcherait aussi le clic
    // normal pour déplier la carte. Laisser le clic remonter fait juste
    // déplier/replier en plus d'ouvrir le champ pour édition — anodin,
    // le champ reste visible et éditable que la carte soit ouverte ou non.
    const titleInput = item.querySelector<HTMLInputElement>('.meeting-title-input')!
    titleInput.addEventListener('change', () => {
      const title = titleInput.value.trim() || 'Sans titre'
      titleInput.value = title
      window.api.updateMeetingTitle(id, title)
      entry.title = title
    })

    // Contenu complet du fichier, tel que lu depuis le disque — conservé ici
    // pour pouvoir y appliquer un renommage d'intervenant sans recharger.
    let rawContent = ''

    // Retire la ligne de titre "# Réunion — …" et la ligne vide qui suit,
    // déjà affichées via entry.title/date dans l'en-tête de la carte.
    const displayContent = (): string => rawContent.split('\n').slice(2).join('\n')

    function renderEditMode(): void {
      const content = displayContent()
      body.innerHTML = `
        <textarea class="meeting-edit-textarea">${escapeHtml(content)}</textarea>
        <div class="meeting-edit-actions">
          <button class="modify-link meeting-edit-cancel">Annuler</button>
          <button class="save-btn meeting-edit-save">Enregistrer</button>
        </div>`

      body.querySelector('.meeting-edit-cancel')?.addEventListener('click', renderBody)
      body.querySelector('.meeting-edit-save')?.addEventListener('click', async () => {
        const textarea = body.querySelector<HTMLTextAreaElement>('.meeting-edit-textarea')!
        // Conserve la ligne de titre "# Réunion — …" et la ligne vide qui la
        // suit, jamais montrées à l'édition, puis recolle le reste modifié.
        const titleLines = rawContent.split('\n').slice(0, 2).join('\n')
        rawContent = `${titleLines}\n${textarea.value}`
        await window.api.updateMeetingContent(filePath, rawContent)
        renderBody()
        statusEl.textContent = 'Réunion modifiée ✅'
      })
    }

    function renderBody(): void {
      const content = displayContent()
      const speakerNumbers = [
        ...new Set([...content.matchAll(/Intervenant (\d+) :/g)].map((m) => Number(m[1])))
      ].sort((a, b) => a - b)

      const renameForm =
        speakerNumbers.length === 0
          ? ''
          : `<div class="speaker-rename">
              <p class="field-hint">Renommer les intervenants :</p>
              ${speakerNumbers
                .map(
                  (n) => `
                <div class="speaker-rename-row">
                  <span>Intervenant ${n} →</span>
                  <input type="text" class="speaker-rename-input" data-speaker="${n}" placeholder="Nom" />
                </div>`
                )
                .join('')}
              <button class="modify-link speaker-rename-apply">Appliquer</button>
            </div>`

      const termCorrectionForm = `
        <div class="speaker-rename">
          <p class="field-hint">Corriger un terme mal reconnu partout dans cette réunion :</p>
          <div class="speaker-rename-row">
            <input type="text" class="term-correct-from" placeholder="Terme mal reconnu (ex. QuantiDAR)" />
            <span>→</span>
            <input type="text" class="term-correct-to" placeholder="Terme correct (ex. QuantStudio)" />
          </div>
          <button class="modify-link term-correct-apply">Remplacer partout</button>
        </div>`

      const audioPlayer = audioPath
        ? '<audio controls class="meeting-audio-player"></audio>'
        : ''

      body.innerHTML = `
        <div class="meeting-body-toolbar">
          <button class="modify-link meeting-resummarize">🔁 Régénérer le résumé</button>
          <button class="modify-link meeting-edit-toggle">✏️ Modifier</button>
        </div>
        ${audioPlayer}
        ${renameForm}${termCorrectionForm}<div class="meeting-summary">${renderMarkdownLite(content)}</div>`

      if (audioPath) {
        const audioEl = body.querySelector<HTMLAudioElement>('.meeting-audio-player')!
        loadMeetingAudio(audioPath, audioEl).catch((error) => {
          console.warn('Audio de réunion indisponible :', error)
        })
      }

      body.querySelector('.meeting-edit-toggle')?.addEventListener('click', renderEditMode)

      body.querySelector('.meeting-resummarize')?.addEventListener('click', async (event) => {
        const button = event.currentTarget as HTMLButtonElement
        const originalLabel = button.textContent
        button.disabled = true
        button.textContent = 'Résumé en cours…'
        try {
          await window.api.resummarizeMeeting(id)
          rawContent = await window.api.openMeeting(filePath)
          renderBody()
          statusEl.textContent = 'Résumé régénéré ✅'
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          statusEl.textContent = `Erreur lors de la régénération : ${message}`
          button.disabled = false
          button.textContent = originalLabel
        }
      })

      body.querySelector('.speaker-rename-apply')?.addEventListener('click', async () => {
        let updated = rawContent
        body.querySelectorAll<HTMLInputElement>('.speaker-rename-input').forEach((input) => {
          const name = input.value.trim()
          if (!name) return
          updated = updated.split(`Intervenant ${input.dataset.speaker} :`).join(`${name} :`)
        })
        if (updated === rawContent) return

        rawContent = updated
        await window.api.updateMeetingContent(filePath, rawContent)
        renderBody()
        statusEl.textContent = 'Intervenants renommés ✅'
      })

      body.querySelector('.term-correct-apply')?.addEventListener('click', async () => {
        const fromEl = body.querySelector<HTMLInputElement>('.term-correct-from')!
        const toEl = body.querySelector<HTMLInputElement>('.term-correct-to')!
        const from = fromEl.value.trim()
        const to = toEl.value.trim()
        if (!from || !to) return

        // Insensible à la casse (l'ASR n'est pas toujours cohérent sur la
        // casse d'une même erreur d'un passage à l'autre), mais remplace
        // toujours par la casse exacte tapée comme terme correct.
        const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
        const occurrences = (rawContent.match(pattern) ?? []).length
        if (occurrences === 0) {
          statusEl.textContent = `« ${from} » introuvable dans cette réunion.`
          return
        }

        rawContent = rawContent.replace(pattern, to)
        await window.api.updateMeetingContent(filePath, rawContent)
        renderBody()
        statusEl.textContent = `${occurrences} occurrence(s) de « ${from} » remplacée(s) par « ${to} » ✅`
      })
    }

    titleRow.addEventListener('click', async (event) => {
      if ((event.target as HTMLElement).closest('.history-delete, .meeting-export-btn, .meeting-export-email-btn')) return
      if (body.style.display !== 'none') {
        body.style.display = 'none'
        return
      }
      body.style.display = 'block'
      if (rawContent) return

      body.innerHTML = '<p class="empty">Chargement…</p>'
      try {
        rawContent = await window.api.openMeeting(filePath)
        renderBody()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        body.innerHTML = `<p style="color: var(--danger)">Impossible d'ouvrir ce fichier : ${escapeHtml(message)}</p>`
      }
    })
  })

  meetingListBodyEl.querySelectorAll<HTMLButtonElement>('.history-delete').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation()
      const id = Number(button.dataset.id)
      await window.api.deleteMeeting(id)
      currentMeetings = currentMeetings.filter((m) => m.id !== id)
      refreshMeetingListView()
    })
  })

  meetingListBodyEl.querySelectorAll<HTMLButtonElement>('.meeting-export-btn').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation()
      const id = Number(button.dataset.id)
      const entry = currentMeetings.find((m) => m.id === id)
      if (!entry) return
      const originalLabel = button.textContent
      button.textContent = '…'
      const savedPath = await window.api.exportMeetingPdf(entry.filePath, entry.title)
      button.textContent = originalLabel
      if (savedPath) statusEl.textContent = `PDF exporté : ${savedPath} ✅`
    })
  })

  meetingListBodyEl.querySelectorAll<HTMLButtonElement>('.meeting-export-email-btn').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation()
      const id = Number(button.dataset.id)
      const entry = currentMeetings.find((m) => m.id === id)
      if (!entry) return
      await window.api.exportMeetingEmail(entry.filePath, entry.title)
      statusEl.textContent = 'Client mail ouvert avec le résumé ✅'
    })
  })
}

// Recherche plein texte (titre + résumé + transcript), déléguée au main
// process qui lit les fichiers sur disque — voir meeting:search. Un léger
// débounce évite de relire tous les fichiers à chaque frappe.
async function refreshMeetingListView(): Promise<void> {
  const query = meetingListSearchEl.value
  const results = query.trim() ? await window.api.searchMeetings(query) : currentMeetings
  renderMeetingList(results)
}

async function loadMeetingList(): Promise<void> {
  currentMeetings = await window.api.listMeetings()
  meetingListSearchEl.value = ''
  renderMeetingList(currentMeetings)
}

let meetingSearchDebounce: ReturnType<typeof setTimeout> | null = null
meetingListSearchEl.addEventListener('input', () => {
  if (meetingSearchDebounce) clearTimeout(meetingSearchDebounce)
  meetingSearchDebounce = setTimeout(refreshMeetingListView, 250)
})

// ---------------------------------------------------------------------------
// Import d'un transcript externe (ex. copié depuis Notability sur iPad)
// ---------------------------------------------------------------------------

const meetingImportToggleEl = document.querySelector<HTMLButtonElement>('#meeting-import-toggle')!
const meetingImportPanelEl = document.querySelector<HTMLDivElement>('#meeting-import-panel')!
const meetingImportTextEl = document.querySelector<HTMLTextAreaElement>('#meeting-import-text')!
const meetingImportSubmitEl = document.querySelector<HTMLButtonElement>('#meeting-import-submit')!

meetingImportToggleEl.addEventListener('click', () => {
  const isOpen = meetingImportPanelEl.style.display !== 'none'
  meetingImportPanelEl.style.display = isOpen ? 'none' : 'block'
})

document.querySelector('#meeting-import-file')!.addEventListener('click', async () => {
  const content = await window.api.pickMeetingTextFile()
  if (content) meetingImportTextEl.value = content
})

meetingImportSubmitEl.addEventListener('click', async () => {
  const transcript = meetingImportTextEl.value.trim()
  if (!transcript) return

  meetingImportSubmitEl.disabled = true
  meetingImportSubmitEl.textContent = 'Résumé en cours…'
  try {
    await window.api.importMeetingTranscript(transcript)
    meetingImportTextEl.value = ''
    meetingImportPanelEl.style.display = 'none'
    statusEl.textContent = 'Transcript importé et résumé ✅'
    await loadMeetingList()
    document.getElementById('section-meeting-list')!.classList.add('open')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    statusEl.textContent = `Erreur d'import : ${message}`
  } finally {
    meetingImportSubmitEl.disabled = false
    meetingImportSubmitEl.textContent = 'Résumer et enregistrer'
  }
})

const meetingImportAudioEl = document.querySelector<HTMLButtonElement>('#meeting-import-audio')!
meetingImportAudioEl.addEventListener('click', async () => {
  const originalLabel = meetingImportAudioEl.textContent
  meetingImportAudioEl.disabled = true
  meetingImportAudioEl.textContent = 'Transcription en cours… (peut prendre un moment)'
  try {
    const result = await window.api.importMeetingAudio()
    if (result) {
      meetingImportPanelEl.style.display = 'none'
      statusEl.textContent = 'Fichier audio importé et résumé ✅'
      await loadMeetingList()
      document.getElementById('section-meeting-list')!.classList.add('open')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    statusEl.textContent = `Erreur d'import audio : ${message}`
  } finally {
    meetingImportAudioEl.disabled = false
    meetingImportAudioEl.textContent = originalLabel
  }
})

renderSettings()
renderApiKeys()

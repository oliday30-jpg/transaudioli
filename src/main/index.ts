import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  safeStorage,
  session,
  shell,
  type Tray
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFile, mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { processTranscript } from './cleanup'
import { clearEnvKeys, loadEnv } from './env'
import { markdownLiteToHtml } from './markdown'
import { summarizeMeeting } from './meeting-summary'
import { getProjectVocabulary } from './project-vocab'
import { hasEncryptedKeys, loadEncryptedKeys, saveEncryptedKeys } from './secureKeys'
import { showToast } from './toast'
import {
  addHistoryEntry,
  addVocabularyList,
  addMeetingEntry,
  addUsageSeconds,
  clearHistory,
  getCostRates,
  getEffectiveListVocabulary,
  getHistory,
  getMeetingLanguage,
  getMeetingRetentionDays,
  getMeetings,
  getMicrophoneId,
  getProjectPath,
  getProviderOrder,
  getShortcuts,
  getSilenceDuration,
  getUsageSeconds,
  getVocabularyLists,
  removeHistoryEntry,
  removeMeetingEntry,
  updateMeetingTitle,
  removeVocabularyList,
  setCostRate,
  setMeetingLanguage,
  setMeetingRetentionDays,
  setMicrophoneId,
  type MeetingIndexEntry,
  setProjectPath,
  setProviderOrder,
  setShortcut,
  setSilenceDuration,
  updateVocabularyList,
  type MeetingLanguage,
  type ShortcutKey,
  type VocabularyList
} from './settings'
import { createTray } from './tray'
import { createDeepgramProvider } from './transcription/deepgram'
import { createGroqProvider } from './transcription/groq'
import { guessAudioMimeType, transcribeMeetingChunk } from './transcription/meeting-transcribe'
import { createRouter } from './transcription/router'
import type { TranscriptionProvider } from './transcription/types'
import { createWhisperProvider } from './transcription/whisper'

// En dev, l'icône vit dans le dossier du projet. Une fois empaquetée, seul
// out/ est inclus dans l'app — l'icône est copiée à part (extraResources)
// et accessible via process.resourcesPath, pas app.getAppPath().
const ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, 'icon.ico')
  : join(app.getAppPath(), 'build', 'icon.ico')

loadEnv([app.getPath('userData'), app.getAppPath()])

app.setName('TransAudiOli')

// Reconstruit à chaque changement de clé API pour prendre effet
// immédiatement, sans redémarrer l'app.
let router: ReturnType<typeof createRouter>

function buildRouter(): void {
  const availableProviders: Record<string, TranscriptionProvider> = {
    groq: createGroqProvider(process.env.GROQ_API_KEY),
    deepgram: createDeepgramProvider(process.env.DEEPGRAM_API_KEY),
    whisper: createWhisperProvider(process.env.OPENAI_API_KEY)
  }

  const orderedProviders = getProviderOrder()
    .map((name) => availableProviders[name])
    .filter((provider): provider is TranscriptionProvider => Boolean(provider))

  router = createRouter(
    orderedProviders.length > 0 ? orderedProviders : Object.values(availableProviders)
  )
}

buildRouter()

const API_KEY_NAMES = ['GROQ_API_KEY', 'DEEPGRAM_API_KEY', 'OPENAI_API_KEY']

// Migration ponctuelle : les clés qui existaient encore en clair dans
// userData/.env (ancien mécanisme) sont chiffrées une fois puis effacées de
// ce fichier, pour ne jamais laisser deux copies du même secret sur le
// disque. Ensuite, les clés chiffrées (si présentes) prennent le dessus sur
// tout ce que loadEnv() avait chargé en clair.
function migrateAndLoadEncryptedKeys(userDataDir: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('Chiffrement des clés indisponible sur ce système — clés laissées en clair.')
    return
  }

  if (!hasEncryptedKeys(userDataDir)) {
    const plaintextKeys: Record<string, string> = {}
    for (const name of API_KEY_NAMES) {
      if (process.env[name]) plaintextKeys[name] = process.env[name]!
    }
    if (Object.keys(plaintextKeys).length > 0) {
      saveEncryptedKeys(userDataDir, plaintextKeys)
      clearEnvKeys(userDataDir, API_KEY_NAMES)
    }
  }

  Object.assign(process.env, loadEncryptedKeys(userDataDir))
}

const MODE_LABELS: Record<string, string> = { raw: 'brut', clean: 'nettoyé', rewrite: 'réécrit' }

// N'affiche que si la fenêtre est cachée dans le tray — sinon le statut de
// l'app suffit déjà et un toast en plus ferait doublon. Pas de texte dicté
// dedans : discret, et évite d'exposer un contenu potentiellement sensible.
function notify(text: string): void {
  if (mainWindow?.isVisible()) return
  showToast(text)
}

function getEffectiveVocabulary(): string {
  const base = getEffectiveListVocabulary()
  const projectVocab = getProjectVocabulary(getProjectPath())
  return projectVocab ? `${base}, ${projectVocab}` : base
}

type Mode = 'raw' | 'clean' | 'rewrite'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isRecording = false
let activeMode: Mode | null = null
let isQuitting = false
// Volontairement non persisté : un verrouillage est censé être une pause
// ponctuelle, pas un état qui doit survivre à un redémarrage de l'app.
let isLocked = false

const registeredAccelerators: Record<ShortcutKey, string> = {
  raw: '',
  clean: '',
  rewrite: '',
  cancel: '',
  meeting: '',
  lock: ''
}
const shortcutsRegistered: Record<ShortcutKey, boolean> = {
  raw: false,
  clean: false,
  rewrite: false,
  cancel: false,
  meeting: false,
  lock: false
}

// Mise à jour automatique via un dépôt GitHub privé (releases publiées par
// `npm run dist:publish`). Le dépôt étant privé, la vérification a besoin de
// GH_TOKEN dans l'environnement — chargé comme les autres clés via le
// stockage chiffré (secureKeys.ts), voir migrateAndLoadEncryptedKeys().
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'up-to-date' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

function sendUpdateStatus(status: UpdateStatus): void {
  mainWindow?.webContents.send('update:status', status)
}

autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }))
autoUpdater.on('update-available', (info) => {
  sendUpdateStatus({ state: 'available', version: info.version })
  notify(`⬇️ Mise à jour ${info.version} disponible, téléchargement en cours…`)
})
autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'up-to-date' }))
autoUpdater.on('download-progress', (progress) =>
  sendUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) })
)
autoUpdater.on('update-downloaded', (info) => {
  sendUpdateStatus({ state: 'downloaded', version: info.version })
  notify(`✅ Mise à jour ${info.version} prête — redémarre l'app pour l'installer`)
})
autoUpdater.on('error', (error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.warn('Vérification des mises à jour échouée :', message)
  sendUpdateStatus({ state: 'error', message })
})

function checkForUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdates().catch((error) => {
    console.warn('Vérification des mises à jour échouée :', error)
  })
}

function createWindow(startHidden: boolean): void {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 380,
    minHeight: 480,
    show: false,
    frame: false,
    backgroundColor: '#f3f6f2',
    icon: nativeImage.createFromPath(ICON_PATH),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  // Fermer la fenêtre (bouton ✕ ou Alt+F4) la réduit dans la barre système au
  // lieu de quitter l'app — sinon Ctrl+R deviendrait inutile après un clic
  // malheureux sur ✕. Seul "Quitter" depuis le menu du tray ferme pour de bon.
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
  })

  // Les liens (ex. "créer ta clé Groq") s'ouvrent dans le navigateur système,
  // jamais dans la fenêtre de l'app elle-même.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Les trois raccourcis de dictée pilotent le même enregistreur : le premier
// appui (sur n'importe lequel des trois) démarre et fixe le mode ; tant que
// l'enregistrement est en cours, n'importe quel appui parmi les trois l'arrête.
function handleShortcut(mode: Mode): void {
  if (!mainWindow) return
  if (isLocked) {
    notify('🔒 Verrouillé — déverrouille pour dicter')
    return
  }
  if (!isRecording) {
    isRecording = true
    activeMode = mode
    mainWindow.webContents.send('audio:start')
  } else {
    isRecording = false
    mainWindow.webContents.send('audio:stop')
  }
}

function cancelRecording(): void {
  if (!mainWindow || !isRecording) return
  isRecording = false
  activeMode = null
  mainWindow.webContents.send('audio:cancel')
}

// Le raccourci Réunion ne pilote pas isRecording (réservé à la dictée) :
// il se contente de relayer un toggle au renderer, qui gère lui-même son
// propre état de démarrage/arrêt (mêmes fonctions que le bouton cliquable).
function toggleMeetingShortcut(): void {
  if (isLocked) {
    notify('🔒 Verrouillé — déverrouille pour démarrer une réunion')
    return
  }
  mainWindow?.webContents.send('meeting:toggle-shortcut')
}

// Verrouillage global : pause volontaire et rapide qui rend tous les
// raccourcis (dictée + réunion) inertes, pour ne rien déclencher par erreur
// pendant un appel sensible. Cancel reste toujours actif — annuler un
// enregistrement en cours ne peut jamais faire de mal, inutile de le bloquer.
function toggleLock(): void {
  isLocked = !isLocked
  mainWindow?.webContents.send('lock:changed', isLocked)
  notify(isLocked ? '🔒 TransAudiOli verrouillé' : '🔓 TransAudiOli déverrouillé')
}

function handlerFor(key: ShortcutKey): () => void {
  if (key === 'cancel') return cancelRecording
  if (key === 'meeting') return toggleMeetingShortcut
  if (key === 'lock') return toggleLock
  return () => handleShortcut(key)
}

// N'écrase l'ancien raccourci que si le nouveau s'enregistre avec succès —
// sinon on garde l'ancien plutôt que de se retrouver sans rien.
function registerShortcut(key: ShortcutKey, accelerator: string): boolean {
  const previous = registeredAccelerators[key]
  if (accelerator === previous && shortcutsRegistered[key]) return true

  const ok = globalShortcut.register(accelerator, handlerFor(key))
  if (!ok) return false

  if (previous) globalShortcut.unregister(previous)
  registeredAccelerators[key] = accelerator
  shortcutsRegistered[key] = true
  return true
}

// La détection de silence côté renderer peut arrêter l'enregistrement toute
// seule ; elle prévient le main process pour resynchroniser isRecording,
// sinon le prochain raccourci croirait devoir démarrer un second enregistrement.
ipcMain.on('recording:sync-stopped', () => {
  isRecording = false
})

// Le renderer sait, lui, si le démarrage/arrêt de réunion vient d'un clic
// (fenêtre déjà visible, pas besoin de notification) ou du raccourci clavier
// (fenêtre potentiellement cachée) — il déclenche cette notification dans les
// deux cas, notify() se charge de ne l'afficher que si la fenêtre est cachée.
ipcMain.on('toast:show', (_event, text: string) => notify(text))

ipcMain.on('recording:manual-toggle', (_event, mode: Mode) => {
  handleShortcut(mode)
})

ipcMain.on('audio:complete', async (_event, buffer: ArrayBuffer, durationMs: number) => {
  const mode = activeMode ?? 'clean'
  activeMode = null

  try {
    const result = await router.transcribe(Buffer.from(buffer), getEffectiveVocabulary())
    const { text: processed, template } =
      mode === 'raw'
        ? { text: result.text, template: undefined }
        : await processTranscript(result.text, mode, process.env.GROQ_API_KEY)

    clipboard.writeText(processed)
    mainWindow?.webContents.send('transcription:done', {
      text: processed,
      provider: result.provider,
      mode,
      template
    })

    const modeLabel = template ? `${MODE_LABELS[mode] ?? mode} · ${template}` : (MODE_LABELS[mode] ?? mode)
    notify(`Copié ✅ — ${modeLabel}`)

    addUsageSeconds(result.provider, (durationMs ?? 0) / 1000)

    const timestamp = Date.now()
    addHistoryEntry({ text: processed, provider: result.provider, mode, timestamp })
    const templateSuffix = template ? `, ${template}` : ''
    const line = `[${new Date(timestamp).toLocaleString('fr-FR')}] (${result.provider}, ${mode}${templateSuffix}) ${processed}\n`
    await appendFile(join(app.getPath('userData'), 'historique.txt'), line, 'utf-8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainWindow?.webContents.send('transcription:error', message)
    notify('⚠️ Erreur de transcription')
  }
})

ipcMain.handle('settings:get', () => ({
  shortcuts: getShortcuts(),
  vocabularyLists: getVocabularyLists(),
  silenceDurationMs: getSilenceDuration(),
  projectPath: getProjectPath(),
  microphoneId: getMicrophoneId(),
  providerOrder: getProviderOrder(),
  meetingLanguage: getMeetingLanguage(),
  meetingRetentionDays: getMeetingRetentionDays(),
  locked: isLocked,
  shortcutsRegistered
}))

ipcMain.on('lock:toggle', () => toggleLock())

ipcMain.handle('settings:update-meeting-language', (_event, language: MeetingLanguage) => {
  setMeetingLanguage(language)
})

ipcMain.handle('settings:update-provider-order', (_event, order: string[]) => {
  setProviderOrder(order)
  buildRouter()
})

ipcMain.handle('settings:update-microphone', (_event, deviceId: string) => {
  setMicrophoneId(deviceId)
})

ipcMain.handle('settings:update-shortcut', (_event, key: ShortcutKey, accelerator: string) => {
  const ok = registerShortcut(key, accelerator)
  if (ok) setShortcut(key, accelerator)
  return ok
})

ipcMain.handle('vocabulary:list', () => getVocabularyLists())

ipcMain.handle('vocabulary:add', (_event, { name, terms }: { name: string; terms: string }) =>
  addVocabularyList(name, terms)
)

ipcMain.handle(
  'vocabulary:update',
  (_event, { id, updates }: { id: string; updates: Partial<Pick<VocabularyList, 'name' | 'terms' | 'enabled'>> }) => {
    updateVocabularyList(id, updates)
  }
)

ipcMain.handle('vocabulary:remove', (_event, id: string) => {
  removeVocabularyList(id)
})

ipcMain.handle('settings:update-silence-duration', (_event, ms: number) => {
  setSilenceDuration(ms)
})

ipcMain.handle('settings:get-api-key-status', () => ({
  groq: Boolean(process.env.GROQ_API_KEY),
  deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
  openai: Boolean(process.env.OPENAI_API_KEY),
  encrypted: safeStorage.isEncryptionAvailable()
}))

ipcMain.handle(
  'settings:update-api-keys',
  (_event, keys: { groq?: string; deepgram?: string; openai?: string }) => {
    const updates: Record<string, string> = {}
    if (keys.groq) {
      updates.GROQ_API_KEY = keys.groq
      process.env.GROQ_API_KEY = keys.groq
    }
    if (keys.deepgram) {
      updates.DEEPGRAM_API_KEY = keys.deepgram
      process.env.DEEPGRAM_API_KEY = keys.deepgram
    }
    if (keys.openai) {
      updates.OPENAI_API_KEY = keys.openai
      process.env.OPENAI_API_KEY = keys.openai
    }

    if (Object.keys(updates).length > 0) {
      saveEncryptedKeys(app.getPath('userData'), updates)
      buildRouter()
    }
  }
)

ipcMain.handle('settings:choose-project-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null

  setProjectPath(result.filePaths[0])
  return result.filePaths[0]
})

ipcMain.handle('settings:clear-project-folder', () => {
  setProjectPath('')
})

ipcMain.handle('usage:get', () => ({
  seconds: getUsageSeconds(),
  costRates: getCostRates()
}))

ipcMain.handle('usage:set-cost-rate', (_event, provider: string, ratePerMinute: number) => {
  setCostRate(provider, ratePerMinute)
})

ipcMain.on('meeting:chunk', async (event, buffer: ArrayBuffer) => {
  try {
    const segments = await transcribeMeetingChunk(
      Buffer.from(buffer),
      process.env.DEEPGRAM_API_KEY ?? '',
      getMeetingLanguage(),
      getEffectiveListVocabulary()
    )
    event.sender.send('meeting:chunk-transcribed', segments)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    event.sender.send('meeting:chunk-error', message)
  }
})

ipcMain.handle('meeting:summarize', (_event, transcript: string) =>
  summarizeMeeting(transcript, process.env.GROQ_API_KEY, getMeetingLanguage())
)

// Titre auto : première phrase du résumé généré (## Résumé / ## Summary),
// tronquée — évite de demander un titre à l'utilisateur à chaud pendant que
// la réunion vient de se terminer.
function deriveMeetingTitle(summary: string, date: Date): string {
  const lines = summary.split('\n')
  const headingIndex = lines.findIndex((l) => l.trim() === '## Résumé' || l.trim() === '## Summary')
  if (headingIndex !== -1) {
    const paragraph = lines
      .slice(headingIndex + 1)
      .find((l) => l.trim().length > 0)
      ?.trim()
    if (paragraph) {
      return paragraph.length > 70 ? `${paragraph.slice(0, 70)}…` : paragraph
    }
  }
  return `Réunion du ${date.toLocaleString('fr-FR')}`
}

async function persistMeeting(
  transcript: string,
  summary: string,
  durationMs: number,
  imported: boolean
): Promise<{ filePath: string; id: number; title: string }> {
  const dir = join(app.getPath('userData'), 'reunions')
  await mkdir(dir, { recursive: true })
  const id = Date.now()
  const date = new Date(id)
  const filePath = join(dir, `reunion-${id}.md`)
  const heading = imported ? 'Réunion importée' : 'Réunion'
  const content = `# ${heading} — ${date.toLocaleString('fr-FR')}\n\n${summary}\n\n---\n\n## Transcript complet\n\n${transcript}\n`
  await writeFile(filePath, content, 'utf-8')

  const title = deriveMeetingTitle(summary, date)
  addMeetingEntry({ id, title, date: id, durationMs, filePath, imported })

  return { filePath, id, title }
}

ipcMain.handle(
  'meeting:save',
  (_event, { transcript, summary, durationMs }: { transcript: string; summary: string; durationMs: number }) =>
    persistMeeting(transcript, summary, durationMs, false)
)

// Import : permet de coller/charger un transcript obtenu ailleurs (par ex.
// exporté de la fonction de retranscription de Notability sur iPad) pour lui
// appliquer notre résumé IA et le retrouver au même endroit que les réunions
// enregistrées directement dans l'app. Pas de diarisation ici puisqu'on ne
// repart pas de l'audio — juste le texte fourni.
ipcMain.handle('meeting:import', async (_event, { transcript }: { transcript: string }) => {
  const summary = await summarizeMeeting(transcript, process.env.GROQ_API_KEY, getMeetingLanguage())
  return persistMeeting(transcript, summary, 0, true)
})

ipcMain.handle('meeting:pick-text-file', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Texte', extensions: ['txt', 'md'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return readFile(result.filePaths[0], 'utf-8')
})

// Import d'un fichier audio existant (ex. piste audio exportée d'une note
// Notability) : diarisé et résumé comme une vraie réunion, en un seul appel
// — pas de découpage en morceaux comme pour l'enregistrement en direct,
// Deepgram gère de gros fichiers en une fois contrairement à Whisper (25 Mo
// max). Un enregistrement extrêmement long pourrait tout de même dépasser
// ses limites ; l'erreur remonte alors telle quelle au renderer.
ipcMain.handle('meeting:import-audio', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['m4a', 'mp3', 'wav', 'webm', 'ogg', 'mp4', 'aac'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  const audio = await readFile(filePath)
  const mimeType = guessAudioMimeType(filePath)
  const language = getMeetingLanguage()

  const segments = await transcribeMeetingChunk(
    audio,
    process.env.DEEPGRAM_API_KEY ?? '',
    language,
    getEffectiveListVocabulary(),
    mimeType
  )
  const transcript = segments.map((s) => `Intervenant ${s.speaker} : ${s.text}`).join('\n')
  const summary = await summarizeMeeting(transcript, process.env.GROQ_API_KEY, language)
  return persistMeeting(transcript, summary, 0, true)
})

ipcMain.handle('meeting:list', () => getMeetings())

ipcMain.handle('meeting:open', async (_event, filePath: string) => {
  return readFile(filePath, 'utf-8')
})

// Recherche plein texte : au-delà du titre, regarde aussi dans le résumé et
// le transcript complet de chaque réunion. Fait sur disque à chaque appel
// plutôt que mis en cache — un usage personnel avec quelques dizaines de
// réunions reste largement assez rapide pour ça, pas besoin d'index dédié.
ipcMain.handle('meeting:search', async (_event, query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return getMeetings()

  const matches: MeetingIndexEntry[] = []
  for (const entry of getMeetings()) {
    if (entry.title.toLowerCase().includes(q)) {
      matches.push(entry)
      continue
    }
    try {
      const content = await readFile(entry.filePath, 'utf-8')
      if (content.toLowerCase().includes(q)) matches.push(entry)
    } catch {
      // Fichier manquant/déplacé — ignoré pour la recherche, il reste
      // visible normalement dans la liste complète.
    }
  }
  return matches
})

// Réécrit le contenu d'une réunion déjà sauvegardée — utilisé pour renommer
// les intervenants a posteriori (« Intervenant 0 » -> un vrai nom) : le
// renderer recalcule le texte remplacé et fournit directement le contenu
// final, le fichier est simplement remplacé tel quel.
ipcMain.handle('meeting:update-content', async (_event, { filePath, content }: { filePath: string; content: string }) => {
  await writeFile(filePath, content, 'utf-8')
})

// Titre libre : contrairement au reste (renommage d'intervenants, correction
// de termes), c'est le seul champ que l'utilisateur tape entièrement
// lui-même plutôt qu'une modification du contenu existant — pratique pour y
// mettre client / sujet, la date étant déjà affichée à côté dans la liste.
ipcMain.handle('meeting:update-title', (_event, { id, title }: { id: number; title: string }) => {
  updateMeetingTitle(id, title)
})

// Regénère uniquement le résumé (garde le transcript déjà transcrit) — sert
// à réessayer après un échec (clé API, panne réseau) sans tout retranscrire,
// ou simplement pour relancer avec un contenu de transcript modifié à la main.
// Ne touche jamais au titre : une fois retitré à la main, ça reste tel quel.
ipcMain.handle('meeting:resummarize', async (_event, id: number) => {
  const entry = getMeetings().find((m) => m.id === id)
  if (!entry) return null

  const raw = await readFile(entry.filePath, 'utf-8')
  const marker = '## Transcript complet\n\n'
  const markerIndex = raw.indexOf(marker)
  const transcript = markerIndex !== -1 ? raw.slice(markerIndex + marker.length) : ''
  const headingLine = raw.split('\n')[0]

  const summary = await summarizeMeeting(transcript, process.env.GROQ_API_KEY, getMeetingLanguage())
  const newContent = `${headingLine}\n\n${summary}\n\n---\n\n${marker}${transcript}`
  await writeFile(entry.filePath, newContent, 'utf-8')

  return { summary }
})

ipcMain.handle(
  'meeting:export-pdf',
  async (_event, { filePath, title }: { filePath: string; title: string }) => {
    if (!mainWindow) return null

    const raw = await readFile(filePath, 'utf-8')
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; color: #1d2420; padding: 10px 26px 30px; }
  h1 { color: #c4602a; font-size: 19px; margin-bottom: 2px; }
  h2 { color: #c4602a; font-size: 14px; margin-top: 20px; margin-bottom: 6px; }
  p { font-size: 12px; line-height: 1.55; margin: 4px 0; }
  ul { font-size: 12px; line-height: 1.55; padding-left: 20px; margin: 4px 0; }
  hr { border: none; border-top: 1px solid #e3e8e1; margin: 22px 0; }
</style></head><body>${markdownLiteToHtml(raw)}</body></html>`

    const exportWindow = new BrowserWindow({ show: false })
    try {
      await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdfBuffer = await exportWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
      })

      const safeName = title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'reunion'
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter la réunion en PDF',
        defaultPath: join(app.getPath('documents'), `${safeName}.pdf`),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return null

      await writeFile(result.filePath, pdfBuffer)
      return result.filePath
    } finally {
      exportWindow.destroy()
    }
  }
)

async function deleteMeetingById(id: number): Promise<void> {
  const entry = getMeetings().find((m) => m.id === id)
  removeMeetingEntry(id)
  if (entry) {
    try {
      await unlink(entry.filePath)
    } catch {
      // Le fichier a peut-être déjà été déplacé/supprimé manuellement — on
      // retire quand même l'entrée de l'index.
    }
  }
}

ipcMain.handle('meeting:delete', (_event, id: number) => deleteMeetingById(id))

// Purge automatique : supprime les réunions plus vieilles que le délai de
// rétention configuré (0 = désactivé). Lancée une fois au démarrage — une
// app personnelle redémarre assez souvent pour que ce soit suffisant, pas
// besoin d'un minuteur qui tourne en continu.
async function purgeExpiredMeetings(): Promise<void> {
  const retentionDays = getMeetingRetentionDays()
  if (!retentionDays || retentionDays <= 0) return

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const expired = getMeetings().filter((m) => m.date < cutoff)
  for (const entry of expired) {
    await deleteMeetingById(entry.id)
  }
}

ipcMain.handle('settings:update-meeting-retention', (_event, days: number) => {
  setMeetingRetentionDays(Math.max(0, Math.floor(days)))
})

ipcMain.handle('history:get', () => getHistory())

ipcMain.handle('history:delete', (_event, timestamp: number) => {
  removeHistoryEntry(timestamp)
})

ipcMain.handle('history:clear', () => {
  clearHistory()
})

ipcMain.on('clipboard:write', (_event, text: string) => {
  clipboard.writeText(text)
})

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:close', () => mainWindow?.close())

ipcMain.handle('autolaunch:get', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('autolaunch:set', (_event, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: enabled })
})

ipcMain.handle('app:get-version', () => app.getVersion())

ipcMain.handle('app:check-for-updates', () => {
  if (!app.isPackaged) {
    sendUpdateStatus({ state: 'error', message: 'Indisponible en mode développement (npm run dev).' })
    return
  }
  checkForUpdates()
})

ipcMain.handle('app:install-update', () => {
  isQuitting = true
  autoUpdater.quitAndInstall()
})

app.whenReady().then(() => {
  migrateAndLoadEncryptedKeys(app.getPath('userData'))
  buildRouter()
  purgeExpiredMeetings()

  const startHidden = app.getLoginItemSettings().wasOpenedAtLogin
  createWindow(startHidden)
  tray = createTray(mainWindow!, ICON_PATH)
  checkForUpdates()

  // Nécessaire pour le mode Réunion (à venir) : fournit automatiquement une
  // source d'écran + l'audio système à getDisplayMedia() côté renderer, sans
  // jamais afficher le sélecteur natif d'Electron.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' })
    })
  })

  const shortcuts = getShortcuts()
  for (const key of Object.keys(shortcuts) as ShortcutKey[]) {
    const ok = registerShortcut(key, shortcuts[key])
    if (!ok) {
      console.error(`Raccourci ${shortcuts[key]} (${key}) déjà pris par une autre application.`)
    }
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => globalShortcut.unregisterAll())

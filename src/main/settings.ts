import { randomUUID } from 'crypto'
import Store from 'electron-store'

export interface HistoryEntry {
  text: string
  provider: string
  mode: string
  timestamp: number
}

export type ShortcutKey = 'raw' | 'clean' | 'rewrite' | 'cancel' | 'meeting' | 'lock'

export type MeetingLanguage = 'fr' | 'en'

export interface MeetingIndexEntry {
  id: number
  title: string
  date: number
  durationMs: number
  filePath: string
  imported?: boolean
}

export interface VocabularyList {
  id: string
  name: string
  terms: string
  enabled: boolean
}

interface Settings {
  shortcutRaw: string
  shortcutClean: string
  shortcutRewrite: string
  cancelShortcut: string
  shortcutMeeting: string
  shortcutLock: string
  providerOrder: string[]
  vocabularyLists: VocabularyList[]
  silenceDurationMs: number
  projectPath: string
  microphoneId: string
  usageSeconds: Record<string, number>
  costRates: Record<string, number>
  history: HistoryEntry[]
  meetingLanguage: MeetingLanguage
  meetings: MeetingIndexEntry[]
  meetingRetentionDays: number
}

const SHORTCUT_KEY_MAP: Record<ShortcutKey, keyof Settings> = {
  raw: 'shortcutRaw',
  clean: 'shortcutClean',
  rewrite: 'shortcutRewrite',
  cancel: 'cancelShortcut',
  meeting: 'shortcutMeeting',
  lock: 'shortcutLock'
}

const DEFAULT_VOCABULARY =
  'TypeScript, JavaScript, Electron, npm, Claude Code, VS Code, Groq, Deepgram, Whisper, IPC, preload, renderer, refactoriser, débugger, commit, endpoint, API'

const DEFAULT_VOCABULARY_LISTS: VocabularyList[] = [
  { id: 'vscode', name: 'VS Code', terms: DEFAULT_VOCABULARY, enabled: true }
]

const MAX_HISTORY = 50

const store = new Store<Settings>({
  defaults: {
    shortcutRaw: 'CommandOrControl+R',
    shortcutClean: 'CommandOrControl+Alt+D',
    shortcutRewrite: 'CommandOrControl+Alt+E',
    cancelShortcut: 'CommandOrControl+Shift+R',
    shortcutMeeting: 'CommandOrControl+Alt+M',
    shortcutLock: 'CommandOrControl+Alt+L',
    providerOrder: ['groq', 'deepgram', 'whisper'],
    vocabularyLists: DEFAULT_VOCABULARY_LISTS,
    silenceDurationMs: 1800,
    projectPath: '',
    microphoneId: '',
    usageSeconds: {},
    costRates: {},
    history: [],
    meetingLanguage: 'en',
    meetings: [],
    meetingRetentionDays: 90
  }
})

// Migration ponctuelle depuis l'ancien champ "vocabulary" (une seule chaîne)
// vers des listes nommées indépendantes — la valeur existante devient la
// première liste ("VS Code") plutôt que d'être perdue.
;(function migrateLegacyVocabulary(): void {
  const legacy = store.get('vocabulary' as keyof Settings) as unknown as string | undefined
  if (legacy && !store.has('vocabularyLists')) {
    store.set('vocabularyLists', [{ id: randomUUID(), name: 'VS Code', terms: legacy, enabled: true }])
  }
  store.delete('vocabulary' as keyof Settings)
})()

export function getShortcuts(): Record<ShortcutKey, string> {
  return {
    raw: store.get('shortcutRaw'),
    clean: store.get('shortcutClean'),
    rewrite: store.get('shortcutRewrite'),
    cancel: store.get('cancelShortcut'),
    meeting: store.get('shortcutMeeting'),
    lock: store.get('shortcutLock')
  }
}

export function setShortcut(key: ShortcutKey, accelerator: string): void {
  store.set(SHORTCUT_KEY_MAP[key], accelerator)
}

export function getProviderOrder(): string[] {
  return store.get('providerOrder')
}

export function setProviderOrder(order: string[]): void {
  store.set('providerOrder', order)
}

export function getVocabularyLists(): VocabularyList[] {
  return store.get('vocabularyLists')
}

export function addVocabularyList(name: string, terms: string): VocabularyList {
  const list: VocabularyList = { id: randomUUID(), name, terms, enabled: true }
  store.set('vocabularyLists', [...store.get('vocabularyLists'), list])
  return list
}

export function updateVocabularyList(
  id: string,
  updates: Partial<Pick<VocabularyList, 'name' | 'terms' | 'enabled'>>
): void {
  const lists = store.get('vocabularyLists')
  store.set(
    'vocabularyLists',
    lists.map((list) => (list.id === id ? { ...list, ...updates } : list))
  )
}

export function removeVocabularyList(id: string): void {
  const lists = store.get('vocabularyLists')
  store.set(
    'vocabularyLists',
    lists.filter((list) => list.id !== id)
  )
}

// Concatène les termes de toutes les listes actives — c'est ce qui est
// effectivement transmis aux fournisseurs de transcription comme indice.
export function getEffectiveListVocabulary(): string {
  return store
    .get('vocabularyLists')
    .filter((list) => list.enabled)
    .map((list) => list.terms.trim())
    .filter(Boolean)
    .join(', ')
}

export function getSilenceDuration(): number {
  return store.get('silenceDurationMs')
}

export function setSilenceDuration(ms: number): void {
  store.set('silenceDurationMs', ms)
}

export function getProjectPath(): string {
  return store.get('projectPath')
}

export function setProjectPath(projectPath: string): void {
  store.set('projectPath', projectPath)
}

export function getMicrophoneId(): string {
  return store.get('microphoneId')
}

export function setMicrophoneId(deviceId: string): void {
  store.set('microphoneId', deviceId)
}

export function getUsageSeconds(): Record<string, number> {
  return store.get('usageSeconds')
}

export function addUsageSeconds(provider: string, seconds: number): void {
  const usage = store.get('usageSeconds')
  usage[provider] = (usage[provider] ?? 0) + seconds
  store.set('usageSeconds', usage)
}

export function getCostRates(): Record<string, number> {
  return store.get('costRates')
}

export function setCostRate(provider: string, ratePerMinute: number): void {
  const rates = store.get('costRates')
  rates[provider] = ratePerMinute
  store.set('costRates', rates)
}

export function getHistory(): HistoryEntry[] {
  return store.get('history')
}

export function addHistoryEntry(entry: HistoryEntry): void {
  const history = store.get('history')
  store.set('history', [entry, ...history].slice(0, MAX_HISTORY))
}

export function removeHistoryEntry(timestamp: number): void {
  const history = store.get('history')
  store.set(
    'history',
    history.filter((entry) => entry.timestamp !== timestamp)
  )
}

export function clearHistory(): void {
  store.set('history', [])
}

export function getMeetingLanguage(): MeetingLanguage {
  return store.get('meetingLanguage')
}

export function setMeetingLanguage(language: MeetingLanguage): void {
  store.set('meetingLanguage', language)
}

export function getMeetings(): MeetingIndexEntry[] {
  return store.get('meetings')
}

export function addMeetingEntry(entry: MeetingIndexEntry): void {
  const meetings = store.get('meetings')
  store.set('meetings', [entry, ...meetings])
}

export function removeMeetingEntry(id: number): void {
  const meetings = store.get('meetings')
  store.set(
    'meetings',
    meetings.filter((entry) => entry.id !== id)
  )
}

export function getMeetingRetentionDays(): number {
  return store.get('meetingRetentionDays')
}

export function setMeetingRetentionDays(days: number): void {
  store.set('meetingRetentionDays', days)
}

import { contextBridge, ipcRenderer } from 'electron'

interface HistoryEntry {
  text: string
  provider: string
  mode: string
  timestamp: number
}

type MeetingLanguage = 'fr' | 'en'

type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'up-to-date' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

interface SettingsSnapshot {
  shortcuts: Record<string, string>
  vocabulary: string
  silenceDurationMs: number
  projectPath: string
  microphoneId: string
  providerOrder: string[]
  meetingLanguage: MeetingLanguage
  meetingRetentionDays: number
  locked: boolean
  shortcutsRegistered: Record<string, boolean>
}

interface MeetingIndexEntry {
  id: number
  title: string
  date: number
  durationMs: number
  filePath: string
  imported?: boolean
}

interface UsageSnapshot {
  seconds: Record<string, number>
  costRates: Record<string, number>
}

interface DiarizedSegment {
  speaker: number
  text: string
  start: number
  end: number
}

const api = {
  onStart: (callback: () => void): void => {
    ipcRenderer.on('audio:start', callback)
  },
  onStop: (callback: () => void): void => {
    ipcRenderer.on('audio:stop', callback)
  },
  onCancel: (callback: () => void): void => {
    ipcRenderer.on('audio:cancel', callback)
  },
  toggleLock: (): void => ipcRenderer.send('lock:toggle'),
  onLockChanged: (callback: (locked: boolean) => void): void => {
    ipcRenderer.on('lock:changed', (_event, locked: boolean) => callback(locked))
  },
  onMeetingToggleShortcut: (callback: () => void): void => {
    ipcRenderer.on('meeting:toggle-shortcut', callback)
  },
  notifyAutoStop: (): void => {
    ipcRenderer.send('recording:sync-stopped')
  },
  manualToggle: (mode: string): void => {
    ipcRenderer.send('recording:manual-toggle', mode)
  },
  sendAudio: (buffer: ArrayBuffer, durationMs: number): void => {
    ipcRenderer.send('audio:complete', buffer, durationMs)
  },
  onTranscribed: (
    callback: (result: { text: string; provider: string; mode: string; template?: string }) => void
  ): void => {
    ipcRenderer.on(
      'transcription:done',
      (_event, result: { text: string; provider: string; mode: string; template?: string }) =>
        callback(result)
    )
  },
  onTranscriptionError: (callback: (message: string) => void): void => {
    ipcRenderer.on('transcription:error', (_event, message: string) => callback(message))
  },
  getSettings: (): Promise<SettingsSnapshot> => ipcRenderer.invoke('settings:get'),
  updateShortcut: (key: string, accelerator: string): Promise<boolean> =>
    ipcRenderer.invoke('settings:update-shortcut', key, accelerator),
  updateVocabulary: (text: string): Promise<void> =>
    ipcRenderer.invoke('settings:update-vocabulary', text),
  updateSilenceDuration: (ms: number): Promise<void> =>
    ipcRenderer.invoke('settings:update-silence-duration', ms),
  getApiKeyStatus: (): Promise<{ groq: boolean; deepgram: boolean; openai: boolean; encrypted: boolean }> =>
    ipcRenderer.invoke('settings:get-api-key-status'),
  updateApiKeys: (keys: { groq?: string; deepgram?: string; openai?: string }): Promise<void> =>
    ipcRenderer.invoke('settings:update-api-keys', keys),
  chooseProjectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('settings:choose-project-folder'),
  clearProjectFolder: (): Promise<void> => ipcRenderer.invoke('settings:clear-project-folder'),
  updateMicrophone: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke('settings:update-microphone', deviceId),
  updateProviderOrder: (order: string[]): Promise<void> =>
    ipcRenderer.invoke('settings:update-provider-order', order),
  getUsage: (): Promise<UsageSnapshot> => ipcRenderer.invoke('usage:get'),
  setCostRate: (provider: string, ratePerMinute: number): Promise<void> =>
    ipcRenderer.invoke('usage:set-cost-rate', provider, ratePerMinute),
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:get'),
  deleteHistoryEntry: (timestamp: number): Promise<void> =>
    ipcRenderer.invoke('history:delete', timestamp),
  clearHistory: (): Promise<void> => ipcRenderer.invoke('history:clear'),
  sendMeetingChunk: (buffer: ArrayBuffer): void => ipcRenderer.send('meeting:chunk', buffer),
  onMeetingChunkTranscribed: (callback: (segments: DiarizedSegment[]) => void): void => {
    ipcRenderer.on('meeting:chunk-transcribed', (_event, segments: DiarizedSegment[]) => callback(segments))
  },
  onMeetingChunkError: (callback: (message: string) => void): void => {
    ipcRenderer.on('meeting:chunk-error', (_event, message: string) => callback(message))
  },
  summarizeMeeting: (transcript: string): Promise<string> =>
    ipcRenderer.invoke('meeting:summarize', transcript),
  saveMeeting: (data: {
    transcript: string
    summary: string
    durationMs: number
  }): Promise<{ filePath: string; id: number; title: string }> =>
    ipcRenderer.invoke('meeting:save', data),
  updateMeetingLanguage: (language: MeetingLanguage): Promise<void> =>
    ipcRenderer.invoke('settings:update-meeting-language', language),
  updateMeetingRetention: (days: number): Promise<void> =>
    ipcRenderer.invoke('settings:update-meeting-retention', days),
  listMeetings: (): Promise<MeetingIndexEntry[]> => ipcRenderer.invoke('meeting:list'),
  searchMeetings: (query: string): Promise<MeetingIndexEntry[]> => ipcRenderer.invoke('meeting:search', query),
  openMeeting: (filePath: string): Promise<string> => ipcRenderer.invoke('meeting:open', filePath),
  updateMeetingContent: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('meeting:update-content', { filePath, content }),
  deleteMeeting: (id: number): Promise<void> => ipcRenderer.invoke('meeting:delete', id),
  exportMeetingPdf: (filePath: string, title: string): Promise<string | null> =>
    ipcRenderer.invoke('meeting:export-pdf', { filePath, title }),
  importMeetingTranscript: (transcript: string): Promise<{ filePath: string; id: number; title: string }> =>
    ipcRenderer.invoke('meeting:import', { transcript }),
  pickMeetingTextFile: (): Promise<string | null> => ipcRenderer.invoke('meeting:pick-text-file'),
  copyText: (text: string): void => ipcRenderer.send('clipboard:write', text),
  showToast: (text: string): void => ipcRenderer.send('toast:show', text),
  windowMinimize: (): void => ipcRenderer.send('window:minimize'),
  windowClose: (): void => ipcRenderer.send('window:close'),
  getAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke('autolaunch:get'),
  setAutoLaunch: (enabled: boolean): Promise<void> => ipcRenderer.invoke('autolaunch:set', enabled),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('app:check-for-updates'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('app:install-update'),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): void => {
    ipcRenderer.on('update:status', (_event, status: UpdateStatus) => callback(status))
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

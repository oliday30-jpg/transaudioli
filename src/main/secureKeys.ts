// Stockage chiffré des clés API, via safeStorage d'Electron (lié au compte
// Windows de l'utilisateur, DPAPI) plutôt qu'en clair dans un .env — c'est
// la seule donnée vraiment sensible à protéger au repos (le reste, historique
// et réunions, reste en clair pour rester consultable/recherchable).
import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const FILENAME = 'keys.enc.json'

function filePathFor(userDataDir: string): string {
  return join(userDataDir, FILENAME)
}

export function hasEncryptedKeys(userDataDir: string): boolean {
  return existsSync(filePathFor(userDataDir))
}

export function loadEncryptedKeys(userDataDir: string): Record<string, string> {
  const filePath = filePathFor(userDataDir)
  if (!existsSync(filePath) || !safeStorage.isEncryptionAvailable()) return {}

  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, string>
  const result: Record<string, string> = {}
  for (const [key, base64] of Object.entries(raw)) {
    try {
      result[key] = safeStorage.decryptString(Buffer.from(base64, 'base64'))
    } catch {
      // Illisible (ex. profil Windows différent depuis le chiffrement) —
      // ignorée plutôt que de planter le démarrage de l'app.
    }
  }
  return result
}

export function saveEncryptedKeys(userDataDir: string, updates: Record<string, string>): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Le chiffrement des clés n'est pas disponible sur ce système.")
  }
  const filePath = filePathFor(userDataDir)
  const existing: Record<string, string> = existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, 'utf-8'))
    : {}

  for (const [key, value] of Object.entries(updates)) {
    existing[key] = safeStorage.encryptString(value).toString('base64')
  }
  writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8')
}

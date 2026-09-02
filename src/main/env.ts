import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

// Petit parseur .env maison plutôt qu'une dépendance : le format est
// trivial (KEY=VALUE) et évite tout risque de version Node incompatible.
//
// Cherche dans plusieurs dossiers, dans l'ordre, et s'arrête au premier
// .env trouvé : userData (seul endroit valable une fois l'app empaquetée,
// puisque le dossier du projet n'existe plus chez l'utilisateur final) puis
// le dossier du projet (pratique en développement, npm run dev).
export function loadEnv(candidateDirs: string[]): void {
  for (const dir of candidateDirs) {
    const envPath = join(dir, '.env')
    if (!existsSync(envPath)) continue

    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/)
      if (match) process.env[match[1]] = match[2]
    }
    return
  }
}

// Écrit (ou met à jour) des variables dans le .env du dossier de données de
// l'app — c'est le seul .env qu'un écran de réglages peut modifier en toute
// sécurité (celui du projet n'existe pas chez un utilisateur final).
// Préserve les lignes existantes (commentaires compris), ne touche que les
// clés fournies dans `updates`.
export function writeEnvKeys(dir: string, updates: Record<string, string>): void {
  const envPath = join(dir, '.env')
  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf-8').split('\n') : []
  const keys = Object.keys(updates)
  const seen = new Set<string>()

  const updatedLines = lines.map((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=/)
    if (match && keys.includes(match[1])) {
      seen.add(match[1])
      return `${match[1]}=${updates[match[1]]}`
    }
    return line
  })

  for (const key of keys) {
    if (!seen.has(key)) updatedLines.push(`${key}=${updates[key]}`)
  }

  mkdirSync(dir, { recursive: true })
  writeFileSync(envPath, updatedLines.join('\n'), 'utf-8')
}

// Retire des clés d'un .env en clair — utilisé une fois pour la migration
// vers le stockage chiffré (secureKeys.ts) : les clés déjà présentes dans
// userData/.env sont chiffrées puis effacées d'ici pour ne pas laisser
// deux copies (une en clair, une chiffrée) du même secret sur le disque.
export function clearEnvKeys(dir: string, keys: string[]): void {
  const envPath = join(dir, '.env')
  if (!existsSync(envPath)) return

  const remaining = readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=/)
      return !(match && keys.includes(match[1]))
    })

  if (remaining.every((line) => !line.trim())) {
    unlinkSync(envPath)
  } else {
    writeFileSync(envPath, remaining.join('\n'), 'utf-8')
  }
}

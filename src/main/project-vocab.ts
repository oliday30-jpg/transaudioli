import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

// Lit le package.json d'un dossier de projet et renvoie ses dépendances comme
// vocabulaire additionnel — pour que le nom d'une lib comme "zustand" ou
// "drizzle-orm" soit reconnu même s'il n'est dans aucune liste générique.
export function getProjectVocabulary(projectPath: string): string {
  if (!projectPath) return ''

  try {
    const pkgPath = join(projectPath, 'package.json')
    if (!existsSync(pkgPath)) return ''

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson
    const deps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {})
    ]
    return deps.join(', ')
  } catch {
    return ''
  }
}

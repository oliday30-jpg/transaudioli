// Les modèles Whisper n'utilisent que les ~224 derniers tokens d'un prompt de
// contexte — au-delà, certaines API rejettent purement et simplement la
// requête (Groq : 400 si le prompt dépasse 896 caractères). Cette troncature
// garde des termes entiers plutôt que de couper au milieu d'un mot.
export function truncateVocabularyToLimit(vocabulary: string, limit: number): string {
  if (vocabulary.length <= limit) return vocabulary

  const terms = vocabulary.split(',').map((t) => t.trim())
  const kept: string[] = []
  let length = 0
  for (const term of terms) {
    const addedLength = kept.length === 0 ? term.length : term.length + 2
    if (length + addedLength > limit) break
    kept.push(term)
    length += addedLength
  }
  return kept.join(', ')
}

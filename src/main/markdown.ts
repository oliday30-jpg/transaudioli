// Petit convertisseur Markdown -> HTML pour le rendu PDF (résumés de
// réunion, manuel utilisateur). Le Markdown en jeu est toujours généré par
// nos propres prompts ou rédigé à la main : pas besoin d'une librairie pour
// un sous-ensemble aussi restreint (titres, listes, paragraphes, séparateur).

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function markdownLiteToHtml(markdown: string): string {
  const lines = markdown.split('\n').map((line) => {
    if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`
    if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`
    if (line.trim() === '---') return '<hr>'
    if (line.startsWith('- ')) return `<li>${escapeHtml(line.slice(2))}</li>`
    if (!line.trim()) return ''
    return `<p>${escapeHtml(line)}</p>`
  })
  return lines.join('\n').replace(/(<li>.*?<\/li>\n?)+/gs, (match) => `<ul>${match}</ul>`)
}

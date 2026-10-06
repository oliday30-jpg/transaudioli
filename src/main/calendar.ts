import { execFile } from 'child_process'

export interface CalendarEvent {
  subject: string
  start: number
  end: number
}

// Lit le calendrier Outlook classique via COM (local, sans connexion
// externe). Les réunions Teams planifiées depuis Outlook y figurent aussi, ce
// qui évite d'avoir à connecter Teams séparément. Renvoie [] hors Windows ou
// si Outlook n'est pas disponible — jamais d'erreur bloquante pour l'app.
export function findCalendarEvents(fromMs: number, toMs: number): Promise<CalendarEvent[]> {
  if (process.platform !== 'win32') return Promise.resolve([])

  const script = `
$ErrorActionPreference = 'Stop'
$lo = [DateTimeOffset]::FromUnixTimeMilliseconds(${Math.floor(fromMs)}).LocalDateTime
$hi = [DateTimeOffset]::FromUnixTimeMilliseconds(${Math.floor(toMs)}).LocalDateTime
$outlook = New-Object -ComObject Outlook.Application
$calendar = $outlook.GetNamespace('MAPI').GetDefaultFolder(9)
$items = $calendar.Items
$items.IncludeRecurrences = $true
$items.Sort('[Start]')
$filter = "[Start] <= '" + $hi.ToString('MM/dd/yyyy HH:mm') + "' AND [End] >= '" + $lo.ToString('MM/dd/yyyy HH:mm') + "'"
$found = @()
foreach ($item in $items.Restrict($filter)) {
  if (-not $item.Subject) { continue }
  $start = [DateTimeOffset]::new([datetime]::SpecifyKind($item.Start, 'Local')).ToUnixTimeMilliseconds()
  $end = [DateTimeOffset]::new([datetime]::SpecifyKind($item.End, 'Local')).ToUnixTimeMilliseconds()
  $found += [pscustomobject]@{ subject = [string]$item.Subject; start = $start; end = $end }
}
ConvertTo-Json -InputObject @($found) -Compress
`

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 20000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          console.warn('Lecture du calendrier Outlook impossible :', error.message)
          resolve([])
          return
        }
        try {
          const parsed = JSON.parse(stdout.trim() || '[]') as CalendarEvent[]
          resolve(Array.isArray(parsed) ? parsed.filter((e) => e.end > e.start) : [])
        } catch {
          resolve([])
        }
      }
    )
  })
}

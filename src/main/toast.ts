import { BrowserWindow, screen } from 'electron'

// Petite fenêtre "toast" maison, en bas à droite de l'écran — contrairement à
// une notification Windows native (taille imposée par l'OS, impossible à
// réduire), on dessine celle-ci nous-mêmes, donc on contrôle sa taille.
// Ne prend jamais le focus (focusable: false + showInactive), pour ne pas
// interrompre ce que l'utilisateur est en train de taper ailleurs.

const WIDTH = 280
const HEIGHT = 46
const MARGIN = 16
const VISIBLE_DURATION_MS = 2200

let toastWindow: BrowserWindow | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null

function ensureToastWindow(): BrowserWindow {
  if (toastWindow && !toastWindow.isDestroyed()) return toastWindow

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  toastWindow = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: screenWidth - WIDTH - MARGIN,
    y: screenHeight - HEIGHT - MARGIN,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false
  })

  return toastWindow
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildHtml(text: string): string {
  return `<html><body style="margin:0;background:transparent;overflow:hidden;">
    <div style="
      font-family:-apple-system,'Segoe UI',sans-serif;
      background:#fffdf9;
      border:1px solid #e6dfd0;
      border-left:4px solid #c4602a;
      border-radius:10px;
      padding:0 14px;
      font-size:12.5px;
      color:#201c15;
      box-shadow:0 4px 16px rgba(0,0,0,.18);
      display:flex;
      align-items:center;
      height:${HEIGHT}px;
      box-sizing:border-box;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    ">${escapeHtml(text)}</div>
  </body></html>`
}

export async function showToast(text: string): Promise<void> {
  const win = ensureToastWindow()
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(text))}`)
  win.showInactive()

  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => win?.hide(), VISIBLE_DURATION_MS)
}

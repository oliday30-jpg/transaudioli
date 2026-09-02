import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'

export function createTray(window: BrowserWindow, iconPath: string): Tray {
  const icon = nativeImage.createFromPath(iconPath)
  const tray = new Tray(icon)
  tray.setToolTip('TransAudiOli')

  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir', click: () => window.show() },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => window.show())

  return tray
}

import { app, shell, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { AppData } from '../shared/types'
import type { TimerAlarm } from '../shared/types'
import { loadData, scheduleSave, flushPendingSave } from './store'
import { getStatus, setApiKey } from './ai-config'
import { testConnection } from './ai'
import { destroyTray, initTray, refreshWidget } from './tray'

let alarmTimeout: NodeJS.Timeout | null = null
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 360,
    height: 560,
    minWidth: 320,
    minHeight: 480,
    maxWidth: 480,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Chromium throttles background timers to ~1/min; the countdown must stay smooth
      backgroundThrottling: false
    }
  })

  mainWindow = win

  if (loadData().settings.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'floating')
  }

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Reopen or refocus the app window — from the dock, or from the menu bar icon. */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.daily-tracker')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('data:load', () => loadData())
  ipcMain.handle('data:save', (_event, data: AppData) => {
    scheduleSave(data)
    // the menu bar reads the same in-memory document, so it must not wait for the debounce
    refreshWidget()
  })
  ipcMain.handle('window:set-always-on-top', (event, flag: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(flag, 'floating')
  })
  // AI key handling stays in main: the renderer only ever learns whether a key
  // is configured and its last 4 characters, never the key itself.
  ipcMain.handle('ai:status', () => getStatus())
  ipcMain.handle('ai:set-key', (_event, key: string | null) => setApiKey(key))
  ipcMain.handle('ai:test', (_event, candidateKey?: string) => testConnection(candidateKey))
  // The renderer's own timers are unreliable once the window is backgrounded,
  // so main owns the alarm. One pending alarm at a time; null cancels it.
  ipcMain.handle('timer:set-alarm', (_event, alarm: TimerAlarm | null) => {
    if (alarmTimeout) {
      clearTimeout(alarmTimeout)
      alarmTimeout = null
    }
    if (!alarm) return
    const delay = Math.max(0, alarm.at - Date.now())
    alarmTimeout = setTimeout(() => {
      alarmTimeout = null
      if (Notification.isSupported()) {
        new Notification({ title: alarm.title, body: alarm.body }).show()
      }
    }, delay)
  })

  createWindow()

  // Tray hover events (`mouse-enter`) are macOS-only, and so is this widget.
  if (process.platform === 'darwin') {
    initTray(showMainWindow)
  }

  app.on('activate', showMainWindow)
})

app.on('before-quit', () => {
  flushPendingSave()
})

app.on('will-quit', () => {
  destroyTray()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

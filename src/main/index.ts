import { app, shell, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { AppData } from '../shared/types'
import { nextTransition } from '../shared/agenda'
import { minutesNow, todayKey } from '../shared/time'
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

/**
 * Announce the day's next boundary, then re-arm for the one after it.
 *
 * Main owns this rather than the renderer for one blunt reason: closing the
 * window destroys the renderer, and a day that stops telling you what is next
 * the moment you close the window is not running the day. Main survives with
 * the tray, and `loadData()` is the same in-memory document the renderer edits.
 *
 * One pending timeout, recomputed from the schedule every time it fires or the
 * document changes — so a day edited underneath the alarm can never leave a
 * stale announcement armed.
 */
function armNextTransition(): void {
  if (alarmTimeout) {
    clearTimeout(alarmTimeout)
    alarmTimeout = null
  }

  const data = loadData()
  if (!data.settings.autopilot || data.dayPause !== null) return

  const now = new Date()
  const schedule = data.days[todayKey(now)]?.schedule
  if (!schedule) return

  const next = nextTransition(schedule, minutesNow(now))
  if (!next) return

  // atMinute can exceed 1440 for a block running past midnight; anchoring on
  // local midnight keeps that arithmetic honest across a DST boundary
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const delay = midnight.getTime() + next.atMinute * 60_000 - now.getTime()

  alarmTimeout = setTimeout(
    () => {
      alarmTimeout = null
      if (Notification.isSupported()) {
        const notification = new Notification({ title: next.title, body: next.body })
        // answering "did you finish?" needs the window, so make it one click away
        notification.on('click', showMainWindow)
        notification.show()
      }
      armNextTransition()
    },
    Math.max(0, delay)
  )
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
  // must match appId in electron-builder.yml
  electronApp.setAppUserModelId('com.ayman.daily-tracker')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('data:load', () => loadData())
  ipcMain.handle('data:save', (_event, data: AppData) => {
    scheduleSave(data)
    // the menu bar reads the same in-memory document, so it must not wait for the debounce
    refreshWidget()
    // the schedule may have just moved under the pending announcement
    armNextTransition()
  })
  ipcMain.handle('window:set-always-on-top', (event, flag: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(flag, 'floating')
  })
  // AI key handling stays in main: the renderer only ever learns whether a key
  // is configured and its last 4 characters, never the key itself.
  ipcMain.handle('ai:status', () => getStatus())
  ipcMain.handle('ai:set-key', (_event, key: string | null) => setApiKey(key))
  ipcMain.handle('ai:test', (_event, candidateKey?: string) => testConnection(candidateKey))
  armNextTransition()

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

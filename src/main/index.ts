import { app, shell, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { AppData } from '../shared/types'
import type { TimerAlarm } from '../shared/types'
import { loadData, scheduleSave, flushPendingSave } from './store'

let alarmTimeout: NodeJS.Timeout | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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

  if (loadData().settings.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, 'floating')
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  })
  ipcMain.handle('window:set-always-on-top', (event, flag: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(flag, 'floating')
  })
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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  flushPendingSave()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

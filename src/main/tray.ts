import { BrowserWindow, Menu, Rectangle, Tray, ipcMain, nativeImage, screen } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import trayIcon1x from '../../resources/trayTemplate.png?asset'
import trayIcon2x from '../../resources/trayTemplate@2x.png?asset'
import type { WidgetSummary } from '../shared/types'
import { buildWidgetSummary, trayTitle } from '../shared/widget'
import { loadData } from './store'

const WIDTH = 300
const DEFAULT_HEIGHT = 232
/** How long the pointer must be off both the icon and the panel before hiding. */
const HIDE_SAMPLES = 2
const CURSOR_POLL_MS = 120
const FAST_TICK_MS = 1000
const IDLE_TICK_MS = 15_000

let tray: Tray | null = null
let popover: BrowserWindow | null = null
let ready = false
let visible = false
let revision = 0
let panelHeight = DEFAULT_HEIGHT
let lastSummary: WidgetSummary | null = null
let lastTitle: string | null = null

let tick: NodeJS.Timeout | null = null
let tickMs = 0
let cursorPoll: NodeJS.Timeout | null = null
let outSamples = 0

function createPopover(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: DEFAULT_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // the card paints its own shadow; a native one would box the transparent padding
    hasShadow: false,
    // never steal focus from whatever the user is actually doing
    focusable: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/widget.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/widget.html'))
  }

  return win
}

/** Sit the panel directly under the icon, kept inside the screen it lives on. */
function position(): void {
  if (!tray || !popover) return
  const icon = tray.getBounds()
  const area = screen.getDisplayNearestPoint({ x: icon.x, y: icon.y }).workArea
  const x = Math.round(icon.x + icon.width / 2 - WIDTH / 2)
  popover.setBounds({
    x: Math.min(Math.max(x, area.x + 4), area.x + area.width - WIDTH - 4),
    // flush against the menu bar — the panel's own transparent padding makes the
    // visible gap, so the pointer can cross from icon to card without leaving
    y: icon.y + icon.height,
    width: WIDTH,
    height: panelHeight
  })
}

function contains(point: { x: number; y: number }, rect: Rectangle, pad = 2): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.width + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.height + pad
  )
}

/**
 * Hover-out is decided by polling the cursor rather than by DOM mouseleave: a
 * non-focusable panel does not reliably deliver those, and this also covers the
 * pointer leaving via the gap between the icon and the card.
 */
function watchCursor(): void {
  if (cursorPoll) return
  outSamples = 0
  cursorPoll = setInterval(() => {
    if (!tray || !popover || !visible) return
    const point = screen.getCursorScreenPoint()
    const inside = contains(point, tray.getBounds()) || contains(point, popover.getBounds())
    outSamples = inside ? 0 : outSamples + 1
    if (outSamples >= HIDE_SAMPLES) hide()
  }, CURSOR_POLL_MS)
}

function stopWatchingCursor(): void {
  if (cursorPoll) {
    clearInterval(cursorPoll)
    cursorPoll = null
  }
  outSamples = 0
}

function show(): void {
  if (!popover || visible) return
  visible = true
  revision += 1
  refreshWidget()
  position()
  popover.showInactive()
  watchCursor()
  retick()
}

function hide(): void {
  if (!popover || !visible) return
  visible = false
  popover.hide()
  stopWatchingCursor()
  retick()
}

/** Poll every second only while it matters; otherwise just often enough to catch a block change. */
function retick(): void {
  const running = lastSummary?.timer != null && !lastSummary.timer.paused
  const want = visible || running ? FAST_TICK_MS : IDLE_TICK_MS
  if (tick && tickMs === want) return
  if (tick) clearInterval(tick)
  tickMs = want
  tick = setInterval(refreshWidget, want)
}

export function refreshWidget(): void {
  if (!tray || tray.isDestroyed()) return
  const summary = buildWidgetSummary(loadData(), new Date(), revision)
  lastSummary = summary

  const title = trayTitle(summary)
  if (title !== lastTitle) {
    lastTitle = title
    // monospaced digits keep the menu bar from reflowing on every tick
    tray.setTitle(title, { fontType: 'monospacedDigit' })
  }

  if (visible && ready && popover && !popover.isDestroyed()) {
    popover.webContents.send('widget:update', summary)
  }
  retick()
}

/** Supplied by index.ts, which owns the main window's lifecycle. */
let showMainWindow: () => void = () => {}

function openApp(): void {
  hide()
  showMainWindow()
}

export function initTray(onOpenApp: () => void): void {
  showMainWindow = onOpenApp
  const image = nativeImage.createFromPath(trayIcon1x)
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(trayIcon2x) })
  // template mode lets macOS invert the glyph for light and dark menu bars
  image.setTemplateImage(true)

  tray = new Tray(image)
  tray.setToolTip('Daily Tracker')
  tray.setIgnoreDoubleClickEvents(true)

  popover = createPopover()

  ipcMain.handle('widget:ready', () => {
    ready = true
    if (lastSummary && popover && !popover.isDestroyed()) {
      popover.webContents.send('widget:update', lastSummary)
    }
  })
  ipcMain.handle('widget:resize', (_event, height: number) => {
    const next = Math.round(Math.max(120, Math.min(520, height)))
    if (next === panelHeight) return
    panelHeight = next
    if (visible) position()
  })
  ipcMain.handle('widget:open-app', () => openApp())

  // hover shows the panel; a click is the deliberate "take me to the app" action
  tray.on('mouse-enter', () => show())
  tray.on('click', () => openApp())
  tray.on('right-click', () => {
    hide()
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Daily Tracker', click: () => openApp() },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' }
      ])
    )
  })

  refreshWidget()
}

export function destroyTray(): void {
  stopWatchingCursor()
  if (tick) {
    clearInterval(tick)
    tick = null
  }
  popover?.destroy()
  popover = null
  tray?.destroy()
  tray = null
}

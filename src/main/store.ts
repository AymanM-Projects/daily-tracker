import { app } from 'electron'
import { dirname, join } from 'path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import type { AppData } from '../shared/types'
import { defaultAppData } from '../shared/defaults'
import { CURRENT_VERSION, migrate } from '../shared/migrate'

const SAVE_DEBOUNCE_MS = 300

let cached: AppData | null = null
let pending: AppData | null = null
let timer: NodeJS.Timeout | null = null

function dataFilePath(): string {
  return join(app.getPath('userData'), 'daily-tracker-data.json')
}

/** Move the live file aside under a suffix, so nothing is ever silently discarded. */
function quarantine(file: string, suffix: string): void {
  if (existsSync(file)) {
    renameSync(file, file.replace(/\.json$/, `.${suffix}-${Date.now()}.json`))
  }
}

/** Write immediately rather than waiting on the renderer, so a migration survives a quit. */
function writeNow(file: string, data: AppData): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
}

export function loadData(): AppData {
  if (pending) return pending
  if (cached) return cached
  const file = dataFilePath()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    // unreadable or unparseable — keep the bytes, start fresh
    quarantine(file, 'corrupt')
    cached = defaultAppData()
    return cached
  }

  const version = (parsed?.version as number) ?? 1

  if (version > CURRENT_VERSION) {
    // written by a newer build; reading it could lose fields we don't understand
    quarantine(file, `newer-v${version}`)
    cached = defaultAppData()
    return cached
  }

  if (version < CURRENT_VERSION) {
    // copy, never rename — the live file must stay put while we upgrade it
    copyFileSync(file, file.replace(/\.json$/, `.pre-v${version}-${Date.now()}.json`))
    cached = migrate(parsed)
    writeNow(file, cached)
    return cached
  }

  cached = parsed as unknown as AppData
  return cached
}

export function scheduleSave(data: AppData): void {
  pending = data
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushPendingSave, SAVE_DEBOUNCE_MS)
}

export function flushPendingSave(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!pending) return
  writeNow(dataFilePath(), pending)
  cached = pending
  pending = null
}

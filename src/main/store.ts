import { app } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import type { AppData } from '../shared/types'
import { defaultAppData } from '../shared/defaults'

const SAVE_DEBOUNCE_MS = 300

let cached: AppData | null = null
let pending: AppData | null = null
let timer: NodeJS.Timeout | null = null

function dataFilePath(): string {
  return join(app.getPath('userData'), 'daily-tracker-data.json')
}

export function loadData(): AppData {
  if (pending) return pending
  if (cached) return cached
  const file = dataFilePath()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as AppData
    if (parsed?.version !== 1) throw new Error('unrecognized data version')
    cached = parsed
  } catch {
    // keep the bytes on parse failures, start fresh either way
    if (existsSync(file)) {
      renameSync(file, file.replace(/\.json$/, `.corrupt-${Date.now()}.json`))
    }
    cached = defaultAppData()
  }
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
  const file = dataFilePath()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(pending, null, 2), 'utf-8')
  renameSync(tmp, file)
  cached = pending
  pending = null
}

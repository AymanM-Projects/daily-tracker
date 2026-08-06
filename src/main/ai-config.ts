import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import type { AiStatus } from '../shared/types'

/**
 * The API key never goes in daily-tracker-data.json — that file is plaintext and
 * gets copied around by the migration backups. It lives here instead, encrypted
 * by the OS keychain via safeStorage, and is never handed back to the renderer.
 */
interface StoredConfig {
  encryptedKey: string // base64 of the safeStorage buffer
}

function configPath(): string {
  return join(app.getPath('userData'), 'ai-config.json')
}

function readStored(): StoredConfig | null {
  const file = configPath()
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as StoredConfig
    return typeof parsed?.encryptedKey === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** Main-process only. Never expose the return value over IPC. */
export function getApiKey(): string | null {
  const fromEnv = process.env.GEMINI_API_KEY?.trim()
  if (fromEnv) return fromEnv

  const stored = readStored()
  if (!stored) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored.encryptedKey, 'base64')) || null
  } catch {
    // key was encrypted under a different OS user/machine — treat as absent
    return null
  }
}

export function getStatus(): AiStatus {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const fromEnv = process.env.GEMINI_API_KEY?.trim()
  if (fromEnv) {
    return {
      configured: true,
      source: 'env',
      hint: fromEnv.slice(-4),
      encryptionAvailable
    }
  }
  const key = getApiKey()
  return {
    configured: key !== null,
    source: key !== null ? 'keychain' : 'none',
    hint: key ? key.slice(-4) : null,
    encryptionAvailable
  }
}

/** Pass null to forget the stored key. Returns the resulting status. */
export function setApiKey(key: string | null): AiStatus {
  const file = configPath()
  const trimmed = key?.trim() ?? ''

  if (!trimmed) {
    if (existsSync(file)) rmSync(file)
    return getStatus()
  }

  if (!safeStorage.isEncryptionAvailable()) {
    // refuse rather than silently writing a plaintext secret to disk
    return getStatus()
  }

  const encryptedKey = safeStorage.encryptString(trimmed).toString('base64')
  writeFileSync(file, JSON.stringify({ encryptedKey } satisfies StoredConfig), {
    encoding: 'utf-8',
    mode: 0o600
  })
  return getStatus()
}

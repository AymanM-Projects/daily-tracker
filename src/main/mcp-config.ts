import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { randomBytes, timingSafeEqual } from 'crypto'

/**
 * The MCP bearer token never goes in daily-tracker-data.json, for the same
 * reason `ai-config.ts`'s Gemini key doesn't: that file is plaintext and gets
 * copied around by migration backups. It lives here instead, encrypted by the
 * OS keychain via `safeStorage`, directly modeled on `ai-config.ts`'s pattern.
 *
 * One deliberate, explicit deviation from that file's rule that a secret never
 * crosses the IPC boundary: this token *must* cross it once, because the
 * human needs to copy it into an external tool's config. That only ever
 * happens through the narrow `mcp:reveal-token` IPC handler in `index.ts`,
 * fired on an explicit "Copy connection info" click — never loaded into
 * renderer state ambiently the way `AiStatus` is.
 */
interface StoredToken {
  encryptedToken: string // base64 of the safeStorage buffer
}

function configPath(): string {
  return join(app.getPath('userData'), 'mcp-config.json')
}

function readStored(): StoredToken | null {
  const file = configPath()
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as StoredToken
    return typeof parsed?.encryptedToken === 'string' ? parsed : null
  } catch {
    return null
  }
}

function persist(token: string): void {
  // refuse to write a plaintext secret to disk if the OS can't encrypt it —
  // the token just stays in-memory for this run instead (see getOrCreateToken)
  if (!safeStorage.isEncryptionAvailable()) return
  const encryptedToken = safeStorage.encryptString(token).toString('base64')
  writeFileSync(configPath(), JSON.stringify({ encryptedToken } satisfies StoredToken), {
    encoding: 'utf-8',
    mode: 0o600
  })
}

// Cached so a machine with no keychain access still gets one stable token for
// the life of the process (regenerating on every request would make every
// external client's saved token stop working on the next launch anyway).
let cached: string | null = null

/**
 * Main-process only. The only legitimate way this value leaves the process is
 * the `mcp:reveal-token` handler in `index.ts` — never call this from
 * anywhere that hands the return value back over IPC ambiently.
 */
export function getOrCreateToken(): string {
  if (cached) return cached

  const stored = readStored()
  if (stored) {
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(stored.encryptedToken, 'base64'))
      if (decrypted) {
        cached = decrypted
        return decrypted
      }
    } catch {
      // encrypted under a different OS user/machine — fall through and mint a new one
    }
  }

  const token = randomBytes(32).toString('hex')
  persist(token)
  cached = token
  return token
}

/** Mint a new token, discarding the old one. Nothing in the UI calls this yet. */
export function resetToken(): string {
  cached = null
  const file = configPath()
  if (existsSync(file)) rmSync(file)
  return getOrCreateToken()
}

/** Constant-time compare against the stored/generated token, so a wrong guess can't be timed. */
export function verifyToken(candidate: string): boolean {
  const expected = getOrCreateToken()
  const a = Buffer.from(candidate, 'utf-8')
  const b = Buffer.from(expected, 'utf-8')
  return a.length === b.length && timingSafeEqual(a, b)
}

import { app } from 'electron'
import type { UpdateCheckResult } from '../shared/types'
import { isNewerVersion } from '../shared/version'

const REPO = 'AymanM-Projects/daily-tracker'
const ENDPOINT = `https://api.github.com/repos/${REPO}/releases/latest`
const TIMEOUT_MS = 10_000

interface GithubRelease {
  tag_name: string
  html_url: string
}

type GetResult = { ok: true; data: GithubRelease } | { ok: false; error: string }

/** Same AbortController + timeout + status-specific-error shape as `ai.ts`'s `post()`. */
async function get(): Promise<GetResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    if (!res.ok) {
      // 404 is a real, currently-reachable case — this repo has zero
      // published releases today, not a hypothetical.
      const reason =
        res.status === 404
          ? 'No releases published yet.'
          : res.status === 403
            ? 'Rate limited — try again in a moment.'
            : `Request failed (${res.status}).`
      return { ok: false, error: reason }
    }
    return { ok: true, data: (await res.json()) as GithubRelease }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      error: aborted ? "Timed out — couldn't reach GitHub." : "Couldn't reach GitHub."
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Compares the running app against GitHub's latest published release.
 * Never throws across IPC — every failure path returns the `checked: false`
 * variant instead.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  const result = await get()
  if (!result.ok) return { checked: false, currentVersion, error: result.error }

  const latestVersion = result.data.tag_name
  return {
    checked: true,
    currentVersion,
    latestVersion,
    updateAvailable: isNewerVersion(currentVersion, latestVersion),
    releaseUrl: result.data.html_url
  }
}

/** A parsed `major.minor.patch` version, with no leading `v` and no build metadata. */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

/**
 * Strict `vX.Y.Z`. A leading `v`/`V` is the only slack allowed — that's what
 * GitHub tag names, `git describe`, and `npm version` all produce. Anything
 * else ("1.2", "1.2.3-beta", "not-a-version", "") returns null rather than
 * guessing at what the author meant.
 */
export function parseVersion(raw: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/i.exec(raw.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** Ordinary major → minor → patch comparison. Assumes both sides already parsed. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1
  return 0
}

/**
 * Whether `latestTag` is a newer release than `currentVersion`.
 *
 * Fails safe: if either side doesn't parse as a strict version, this returns
 * false rather than guessing. An update banner is a claim the app has to be
 * right about — staying quiet on a string it doesn't understand is better
 * than nagging based on a guess.
 */
export function isNewerVersion(currentVersion: string, latestTag: string): boolean {
  const current = parseVersion(currentVersion)
  const latest = parseVersion(latestTag)
  if (!current || !latest) return false
  return compareVersions(latest, current) === 1
}

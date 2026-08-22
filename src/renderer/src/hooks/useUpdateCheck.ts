import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateCheckResult } from '@shared/types'

export interface UpdateCheckState {
  result: UpdateCheckResult | null
  checking: boolean
  /** "seen" state for the tab-bar dot — set by the consumer, e.g. on visiting Settings. */
  dismissed: boolean
  /** Always re-fires, guard or not — this is what the button calls. */
  recheck: () => void
  dismiss: () => void
}

/**
 * The quiet launch check, shared with the Settings pane's "Check for
 * updates" button.
 *
 * IPC-only and touches no `AppData`, so it's called directly in `App()`
 * rather than nested inside `Themed`. A `useRef` guard fires the automatic
 * check at most once per mount — stricter than `DataContext`'s unguarded
 * `loadData()` effect, deliberately, since this hits a rate-limited external
 * API rather than a local disk read. `recheck()` bypasses the guard and
 * always re-fires.
 */
export function useUpdateCheck(): UpdateCheckState {
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const firedRef = useRef(false)

  const run = useCallback(() => {
    setChecking(true)
    void window.api
      .checkForUpdates()
      .then(setResult)
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true
    run()
  }, [run])

  const recheck = useCallback(() => run(), [run])
  const dismiss = useCallback(() => setDismissed(true), [])

  return { result, checking, dismissed, recheck, dismiss }
}

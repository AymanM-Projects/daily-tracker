import { useEffect } from 'react'
import type { ThemeChoice } from '@shared/types'

/**
 * Stamp the theme choice on `<html>`.
 *
 * The tokens do the rest: `[data-theme='light']` carries the light palette, and
 * `[data-theme='system']` picks it up through `prefers-color-scheme`. Writing
 * the attribute rather than toggling a class means an explicit choice always
 * beats the media query instead of racing it.
 *
 * Both documents call this — the app window and the popover are separate roots
 * with separate bundles, so neither inherits the other's attribute.
 */
export function useTheme(choice: ThemeChoice): void {
  useEffect(() => {
    document.documentElement.dataset.theme = choice
  }, [choice])
}

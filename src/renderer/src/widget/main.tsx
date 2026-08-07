// bundled locally — the CSP forbids fetching fonts, and the app must work offline
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
// no mono here: the popover aligns numerals with tabular-nums, not a mono face

import './widget.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Widget from './Widget'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Widget />
  </StrictMode>
)

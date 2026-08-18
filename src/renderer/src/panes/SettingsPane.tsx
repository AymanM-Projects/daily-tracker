import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AiStatus, McpStatus, ThemeChoice } from '@shared/types'
import { PRAYER_METHODS, prayerTimes } from '@shared/prayer'
import { formatClockMinutes, todayKey } from '@shared/time'
import { useData } from '../state/DataContext'
import RoutineSheet from '../components/RoutineSheet'
import { CheckIcon, MoonIcon, SparklesIcon, SunriseIcon, TrashIcon } from '../components/icons'

type TestState =
  { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok' } | { kind: 'error'; message: string }

type CopyState = { kind: 'idle' } | { kind: 'copied' } | { kind: 'error' }

function SettingsPane(): React.JSX.Element {
  const { settings, prayer, routines, dispatch } = useData()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [draftKey, setDraftKey] = useState('')
  const [reveal, setReveal] = useState(false)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [showRoutines, setShowRoutines] = useState(false)
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null)
  const [copyState, setCopyState] = useState<CopyState>({ kind: 'idle' })
  const activeRoutines = routines.filter((r) => r.active).length

  useEffect(() => {
    void window.api.aiStatus().then(setStatus)
  }, [])

  useEffect(() => {
    void window.api.mcpStatus().then(setMcpStatus)
  }, [])

  // The token is only ever fetched here, on an explicit click — never polled
  // or held in state ambiently, per the same rule ai-config.ts's key follows.
  const copyConnectionInfo = async (): Promise<void> => {
    if (!mcpStatus?.url) return
    const token = await window.api.mcpRevealToken()
    const text = `claude mcp add --transport http daily-tracker ${mcpStatus.url} --header "Authorization: Bearer ${token}"`
    try {
      await navigator.clipboard.writeText(text)
      setCopyState({ kind: 'copied' })
      setTimeout(() => setCopyState({ kind: 'idle' }), 2500)
    } catch {
      setCopyState({ kind: 'error' })
    }
  }

  const save = async (): Promise<void> => {
    const next = await window.api.aiSetKey(draftKey)
    setStatus(next)
    setDraftKey('')
    setTest({ kind: 'idle' })
  }

  const clear = async (): Promise<void> => {
    const next = await window.api.aiSetKey(null)
    setStatus(next)
    setDraftKey('')
    setTest({ kind: 'idle' })
  }

  const runTest = async (): Promise<void> => {
    setTest({ kind: 'testing' })
    // test the typed key if there is one, otherwise the stored one
    const result = await window.api.aiTest(draftKey.trim() || undefined)
    setTest(result.ok ? { kind: 'ok' } : { kind: 'error', message: result.error })
  }

  const envManaged = status?.source === 'env'
  const canSave = draftKey.trim().length > 0 && !envManaged

  return (
    <div className="pane">
      <h2 className="pane-title">AI</h2>

      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-label">Status</span>
          {status === null ? (
            <span className="chip">checking…</span>
          ) : status.configured ? (
            <span className="chip chip-auto">
              <CheckIcon size={9} />
              {status.source === 'env' ? 'env var' : `key ••••${status.hint}`}
            </span>
          ) : (
            <span className="chip">not connected</span>
          )}
        </div>

        {envManaged ? (
          <p className="hint">
            A key is coming from the GEMINI_API_KEY environment variable, so it takes priority over
            anything saved here.
          </p>
        ) : (
          <>
            <label className="setting-field">
              <span className="seg-label">Gemini API key</span>
              <input
                className="field"
                type={reveal ? 'text' : 'password'}
                value={draftKey}
                spellCheck={false}
                autoComplete="off"
                placeholder={status?.configured ? 'Replace saved key…' : 'Paste your key…'}
                onChange={(e) => {
                  setDraftKey(e.target.value)
                  setTest({ kind: 'idle' })
                }}
                aria-label="Gemini API key"
              />
            </label>

            <div className="setting-actions">
              <button className="btn-ghost" onClick={() => setReveal((r) => !r)}>
                {reveal ? 'Hide' : 'Show'}
              </button>
              <button
                className="btn-ghost"
                onClick={runTest}
                disabled={test.kind === 'testing' || (!draftKey.trim() && !status?.configured)}
              >
                {test.kind === 'testing' ? 'Testing…' : 'Test'}
              </button>
              <span className="grow" />
              {status?.configured && (
                <button className="icon-btn danger" onClick={clear} aria-label="Forget saved key">
                  <TrashIcon size={14} />
                </button>
              )}
              <motion.button
                className="btn-primary"
                onClick={save}
                disabled={!canSave}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              >
                Save
              </motion.button>
            </div>

            {test.kind === 'ok' && (
              <p className="hint hint-ok">
                <CheckIcon size={11} /> Connected — the model answered.
              </p>
            )}
            {test.kind === 'error' && <p className="hint hint-warn">{test.message}</p>}

            {status && !status.encryptionAvailable && (
              <p className="hint hint-warn">
                This system won&apos;t provide encrypted storage, so the key can&apos;t be saved
                safely. Use the GEMINI_API_KEY environment variable instead.
              </p>
            )}

            <p className="hint">
              Stored encrypted in your macOS Keychain, never in the tracker&apos;s data file. Get a
              free key at aistudio.google.com/apikey.
            </p>
          </>
        )}
      </div>

      <h2 className="pane-title">
        <SparklesIcon size={12} />
        What AI will do
      </h2>
      <div className="setting-card">
        <p className="hint">
          Nothing yet — this only stores the key. The review and suggestion features come next, and
          the app stays fully usable with no key at all.
        </p>
      </div>

      <h2 className="pane-title">Appearance</h2>
      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-label">Theme</span>
          <div className="seg seg-sm" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as ThemeChoice[]).map((t) => (
              <button
                key={t}
                className={settings.theme === t ? 'seg-btn active' : 'seg-btn'}
                onClick={() => dispatch({ type: 'updateSettings', patch: { theme: t } })}
                role="radio"
                aria-checked={settings.theme === t}
              >
                {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <h2 className="pane-title">Running the day</h2>
      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-label">
            Run my schedule
            <span className="setting-hint">
              Announce each block as it starts, time it, and ask what happened when it ends
            </span>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={settings.autopilot}
            aria-label="Run my schedule automatically"
            onClick={() =>
              dispatch({ type: 'updateSettings', patch: { autopilot: !settings.autopilot } })
            }
          >
            <span className="switch-track">
              <motion.span
                layout
                className="switch-thumb"
                transition={{ type: 'spring', stiffness: 600, damping: 32 }}
              />
            </span>
          </button>
        </div>
      </div>

      <h2 className="pane-title">
        <SunriseIcon size={12} />
        Routines
      </h2>
      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-label">
            Wake, lunch, dinner
            <span className="setting-hint">
              {activeRoutines === 0
                ? 'None yet — the day is scheduled straight through'
                : `${activeRoutines} worked into the day`}
            </span>
          </span>
          <button className="btn-ghost" onClick={() => setShowRoutines(true)}>
            <SunriseIcon size={13} />
            Manage
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showRoutines && <RoutineSheet onClose={() => setShowRoutines(false)} />}
      </AnimatePresence>

      <h2 className="pane-title">
        <MoonIcon size={12} />
        Prayer times
      </h2>
      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-label">Block time for prayers</span>
          <button
            className="switch"
            role="switch"
            aria-checked={prayer.enabled}
            onClick={() => dispatch({ type: 'updatePrayer', patch: { enabled: !prayer.enabled } })}
          >
            <span className="switch-track">
              <motion.span
                layout
                className="switch-thumb"
                transition={{ type: 'spring', stiffness: 600, damping: 32 }}
              />
            </span>
          </button>
        </div>

        {prayer.enabled && (
          <>
            <label className="setting-row">
              <span className="setting-label">Minutes per prayer</span>
              <input
                className="field field-time"
                type="number"
                min={5}
                max={60}
                step={5}
                value={prayer.blockMinutes}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10)
                  if (Number.isFinite(n) && n > 0) {
                    dispatch({ type: 'updatePrayer', patch: { blockMinutes: n } })
                  }
                }}
                aria-label="Minutes blocked per prayer"
              />
            </label>

            <p className="hint">Today in Richmond, VA — {PRAYER_METHODS.isna.label}</p>
            <ul className="prayer-list">
              {prayerTimes(todayKey(), prayer).map((t) => {
                const on = prayer.include.includes(t.name)
                return (
                  <li key={t.name}>
                    <button
                      className={on ? 'prayer-row on' : 'prayer-row'}
                      aria-pressed={on}
                      onClick={() =>
                        dispatch({
                          type: 'updatePrayer',
                          patch: {
                            include: on
                              ? prayer.include.filter((n) => n !== t.name)
                              : [...prayer.include, t.name]
                          }
                        })
                      }
                    >
                      <span className="prayer-name">{t.name}</span>
                      <span className="prayer-time">{formatClockMinutes(t.minutes)}</span>
                      {on && <CheckIcon size={11} />}
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="hint">
              Computed from your location, so they shift with the seasons. Tap one to stop blocking
              time for it.
            </p>
          </>
        )}
      </div>

      <h2 className="pane-title">App</h2>
      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-label">Keep window on top</span>
          <button
            className="switch"
            role="switch"
            aria-checked={settings.alwaysOnTop}
            onClick={() => {
              const next = !settings.alwaysOnTop
              dispatch({ type: 'updateSettings', patch: { alwaysOnTop: next } })
              void window.api.setAlwaysOnTop(next)
            }}
          >
            <span className="switch-track">
              <motion.span
                layout
                className="switch-thumb"
                transition={{ type: 'spring', stiffness: 600, damping: 32 }}
              />
            </span>
          </button>
        </div>
        <label className="setting-row">
          <span className="setting-label">Break length</span>
          <input
            className="field field-time"
            type="number"
            min={5}
            max={60}
            step={5}
            value={settings.breakMinutes}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              if (Number.isFinite(n) && n > 0) {
                dispatch({ type: 'updateSettings', patch: { breakMinutes: n } })
              }
            }}
            aria-label="Break length in minutes"
          />
        </label>
      </div>

      <h2 className="pane-title">
        <SparklesIcon size={12} />
        Claude access
      </h2>
      <div className="setting-card">
        <div className="setting-row">
          <span className="setting-label">Status</span>
          {mcpStatus === null ? (
            <span className="chip">checking…</span>
          ) : mcpStatus.running ? (
            <span className="chip chip-auto">
              <CheckIcon size={9} />
              running
            </span>
          ) : (
            <span className="chip">not running</span>
          )}
        </div>

        {mcpStatus?.url && (
          <div className="setting-row">
            <span className="setting-label">URL</span>
            <span className="mono">{mcpStatus.url}</span>
          </div>
        )}

        <div className="setting-actions">
          <span className="grow" />
          <motion.button
            className="btn-primary"
            onClick={copyConnectionInfo}
            disabled={!mcpStatus?.url}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            Copy connection info
          </motion.button>
        </div>

        {copyState.kind === 'copied' && (
          <p className="hint hint-ok">
            <CheckIcon size={11} /> Copied — paste into <code>claude mcp add</code> or your MCP
            client&apos;s config.
          </p>
        )}
        {copyState.kind === 'error' && (
          <p className="hint hint-warn">Couldn&apos;t copy to the clipboard.</p>
        )}

        <p className="hint">
          Lets an external Claude session (Claude Code, or Claude Desktop via{' '}
          <code>mcp-remote</code>) read your journal, backlog, projects, and activities, and suggest
          new to-dos, activities, or projects. It can never edit, finish, or delete anything that
          already exists. Bound to this machine only — the token above is the only thing that ever
          leaves it, and only when you copy it out.
        </p>
      </div>
    </div>
  )
}

export default SettingsPane

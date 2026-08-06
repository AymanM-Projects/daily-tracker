import { getApiKey } from './ai-config'

const MODEL = 'gemini-2.5-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
const TIMEOUT_MS = 20_000

/** Never throws across IPC — callers get an explicit error variant instead. */
export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function post(body: unknown, key: string): Promise<AiResult<unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!res.ok) {
      // surface the provider's own message, but never echo the key back
      const detail = await res.text().catch(() => '')
      const reason =
        res.status === 400 || res.status === 403
          ? 'That key was rejected.'
          : res.status === 429
            ? 'Rate limited — try again in a moment.'
            : `Request failed (${res.status}).`
      return { ok: false, error: reason + (detail ? ` ${detail.slice(0, 200)}` : '') }
    }
    return { ok: true, data: await res.json() }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      error: aborted ? "Timed out — couldn't reach the model." : "Couldn't reach the model."
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * The single provider seam. Swapping to another API means changing this file
 * and nothing else. Structured output is enforced with a response schema rather
 * than parsing prose out of a text reply.
 */
export async function complete(prompt: string, schema: object): Promise<AiResult<unknown>> {
  const key = getApiKey()
  if (!key) return { ok: false, error: 'No API key configured.' }

  const result = await post(
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    },
    key
  )
  if (!result.ok) return result

  const text = (result.data as { candidates?: { content?: { parts?: { text?: string }[] }[] } })
    ?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return { ok: false, error: 'The model returned an empty response.' }
  try {
    return { ok: true, data: JSON.parse(text) }
  } catch {
    return { ok: false, error: 'The model returned malformed JSON.' }
  }
}

/** Cheapest possible round trip, used by the Settings "Test" button. */
export async function testConnection(candidateKey?: string): Promise<AiResult<{ model: string }>> {
  const key = candidateKey?.trim() || getApiKey()
  if (!key) return { ok: false, error: 'No API key configured.' }

  const result = await post(
    {
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
      generationConfig: { maxOutputTokens: 500 }
    },
    key
  )
  return result.ok ? { ok: true, data: { model: MODEL } } : result
}

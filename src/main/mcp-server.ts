import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/server'
import {
  localhostHostValidation,
  localhostOriginValidation,
  NodeStreamableHTTPServerTransport
} from '@modelcontextprotocol/node'
import type { McpEntityCreated, McpStatus } from '../shared/types'
import { getOrCreateToken, verifyToken } from './mcp-config'
import { registerTools } from './mcp-tools'

/**
 * An embedded Streamable HTTP MCP server, so an external Claude session
 * (Claude Code natively, Claude Desktop via the `mcp-remote` stdio bridge —
 * see README) can read the day's journal/backlog/projects/activities and add
 * new suggestions, without the unsafe alternative of a second process reading
 * or writing daily-tracker-data.json directly. `store.ts` caches `AppData` in
 * memory and never re-reads the file, so an out-of-process writer would race
 * the app's own debounced save and very likely get silently clobbered — see
 * `DataContext.tsx`'s `externalEntityCreated` case for the other half of that
 * fix, which covers the same problem one layer up (in-memory, not on disk).
 *
 * Bound to 127.0.0.1 only — this is a single-user local desktop app, not a
 * service with real multi-tenant auth. `localhostHostValidation()` /
 * `localhostOriginValidation()` add DNS-rebinding protection on top of the
 * bind address itself, composed in front of the transport exactly as
 * `@modelcontextprotocol/node`'s own README recipe for a hand-wired
 * `node:http` server does.
 */
const HOST = '127.0.0.1'
const PORT = 8787

let httpServer: Server | null = null
let boundPort: number | null = null

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  if (!value?.startsWith('Bearer ')) return null
  return value.slice('Bearer '.length)
}

function rejectUnauthorized(res: ServerResponse): void {
  res.writeHead(401, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'unauthorized — missing or incorrect bearer token' }))
}

/**
 * Starts the embedded MCP server. Never throws on a bind failure: the
 * `http.Server` 'error' event is handled explicitly (an unhandled 'error' on
 * an EventEmitter throws and would crash the whole process), so a stale port
 * from a previous run just logs and leaves the rest of the app working
 * normally — `getMcpStatus()` reports `running: false` and Settings shows
 * that instead of a mystery crash.
 */
export function startMcpServer(notify: (event: McpEntityCreated) => void): void {
  // ensure a token exists before the first request rather than being minted
  // under load, and so Settings can reveal one immediately on request
  getOrCreateToken()

  const server = new McpServer({ name: 'daily-tracker', version: '1.0.0' })
  registerTools(server, notify)

  const validateHost = localhostHostValidation()
  const validateOrigin = localhostOriginValidation()

  httpServer = createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return

    const token = bearerToken(req)
    if (token === null || !verifyToken(token)) {
      rejectUnauthorized(res)
      return
    }

    // Stateless mode: a fresh transport per request, reconnected to the same
    // long-lived `server` instance. This is the documented recipe for a
    // hand-wired `node:http` server (@modelcontextprotocol/node's own README
    // example does the same) — no session id is generated or tracked, which
    // is the right trade for a single local client that may reconnect at any
    // time, not a multi-client service.
    void (async () => {
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      await server.connect(transport)
      await transport.handleRequest(req, res)
    })()
  })

  httpServer.on('error', (error) => {
    console.error('[mcp] server error — external Claude access is unavailable:', error)
    httpServer = null
    boundPort = null
  })

  httpServer.listen(PORT, HOST, () => {
    boundPort = PORT
    console.log(`[mcp] listening on http://${HOST}:${PORT}/mcp`)
  })
}

/** Called from `will-quit` alongside `destroyTray()`. Non-blocking — a quit must never wait on this. */
export function stopMcpServer(): void {
  httpServer?.close()
  httpServer = null
  boundPort = null
}

export function getMcpStatus(): McpStatus {
  return {
    running: boundPort !== null,
    port: boundPort,
    url: boundPort !== null ? `http://${HOST}:${boundPort}/mcp` : null
  }
}

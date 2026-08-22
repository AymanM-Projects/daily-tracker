import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AiStatus,
  AiTestResult,
  AppData,
  McpEntityCreated,
  McpStatus,
  UpdateCheckResult,
  WidgetSummary
} from '../shared/types'

export interface Api {
  loadData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
  setAlwaysOnTop(flag: boolean): Promise<void>
  aiStatus(): Promise<AiStatus>
  aiSetKey(key: string | null): Promise<AiStatus>
  aiTest(candidateKey?: string): Promise<AiTestResult>
  checkForUpdates(): Promise<UpdateCheckResult>
  /** Validated against hostname === 'github.com' in main before opening. */
  openReleasePage(url: string): Promise<void>
  /** Subscribe to menu bar popover updates; returns an unsubscribe function. */
  onWidgetUpdate(callback: (summary: WidgetSummary) => void): () => void
  widgetReady(): Promise<void>
  widgetResize(height: number): Promise<void>
  widgetOpenApp(): Promise<void>
  mcpStatus(): Promise<McpStatus>
  /** The bearer token, in the clear. Only call this from an explicit "Copy connection info" click. */
  mcpRevealToken(): Promise<string>
  /** Subscribe to MCP-originated creates; returns an unsubscribe function. */
  onMcpEntityCreated(callback: (event: McpEntityCreated) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}

import { ElectronAPI } from '@electron-toolkit/preload'
import type { AiStatus, AiTestResult, AppData, WidgetSummary } from '../shared/types'

export interface Api {
  loadData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
  setAlwaysOnTop(flag: boolean): Promise<void>
  aiStatus(): Promise<AiStatus>
  aiSetKey(key: string | null): Promise<AiStatus>
  aiTest(candidateKey?: string): Promise<AiTestResult>
  /** Subscribe to menu bar popover updates; returns an unsubscribe function. */
  onWidgetUpdate(callback: (summary: WidgetSummary) => void): () => void
  widgetReady(): Promise<void>
  widgetResize(height: number): Promise<void>
  widgetOpenApp(): Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}

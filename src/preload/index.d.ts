import { ElectronAPI } from '@electron-toolkit/preload'
import type { AiStatus, AiTestResult, AppData, TimerAlarm } from '../shared/types'

export interface Api {
  loadData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
  setAlwaysOnTop(flag: boolean): Promise<void>
  setTimerAlarm(alarm: TimerAlarm | null): Promise<void>
  aiStatus(): Promise<AiStatus>
  aiSetKey(key: string | null): Promise<AiStatus>
  aiTest(candidateKey?: string): Promise<AiTestResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}

import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppData, TimerAlarm } from '../shared/types'

export interface Api {
  loadData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
  setAlwaysOnTop(flag: boolean): Promise<void>
  setTimerAlarm(alarm: TimerAlarm | null): Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}

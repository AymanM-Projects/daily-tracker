import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AiStatus, AiTestResult, AppData, TimerAlarm } from '../shared/types'

const api = {
  loadData: (): Promise<AppData> => ipcRenderer.invoke('data:load'),
  saveData: (data: AppData): Promise<void> => ipcRenderer.invoke('data:save', data),
  setAlwaysOnTop: (flag: boolean): Promise<void> =>
    ipcRenderer.invoke('window:set-always-on-top', flag),
  setTimerAlarm: (alarm: TimerAlarm | null): Promise<void> =>
    ipcRenderer.invoke('timer:set-alarm', alarm),
  aiStatus: (): Promise<AiStatus> => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key: string | null): Promise<AiStatus> => ipcRenderer.invoke('ai:set-key', key),
  aiTest: (candidateKey?: string): Promise<AiTestResult> =>
    ipcRenderer.invoke('ai:test', candidateKey)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

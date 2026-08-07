import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AiStatus, AiTestResult, AppData, WidgetSummary } from '../shared/types'

const api = {
  loadData: (): Promise<AppData> => ipcRenderer.invoke('data:load'),
  saveData: (data: AppData): Promise<void> => ipcRenderer.invoke('data:save', data),
  setAlwaysOnTop: (flag: boolean): Promise<void> =>
    ipcRenderer.invoke('window:set-always-on-top', flag),
  aiStatus: (): Promise<AiStatus> => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key: string | null): Promise<AiStatus> => ipcRenderer.invoke('ai:set-key', key),
  aiTest: (candidateKey?: string): Promise<AiTestResult> =>
    ipcRenderer.invoke('ai:test', candidateKey),
  // menu bar popover — main pushes, the widget renderer only listens
  onWidgetUpdate: (callback: (summary: WidgetSummary) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, summary: WidgetSummary): void => callback(summary)
    ipcRenderer.on('widget:update', handler)
    return () => {
      ipcRenderer.removeListener('widget:update', handler)
    }
  },
  widgetReady: (): Promise<void> => ipcRenderer.invoke('widget:ready'),
  widgetResize: (height: number): Promise<void> => ipcRenderer.invoke('widget:resize', height),
  widgetOpenApp: (): Promise<void> => ipcRenderer.invoke('widget:open-app')
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

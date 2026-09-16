import { contextBridge, ipcRenderer } from 'electron';

function subscribe(channel: string, callback: (value: any) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: any) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('jovian', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  patch: (path: string, value: unknown) => ipcRenderer.invoke('config:patch', path, value),
  onConfig: (fn: any) => subscribe('config:changed', fn),
  onCommand: (fn: any) => subscribe('view:command', fn),
  getWindowState: () => ipcRenderer.invoke('window:state'),
  onWindowState: (fn: any) => subscribe('window:state-changed', fn),
  toggleFillScreen: () => ipcRenderer.invoke('window:fill-toggle'),
  exitFillScreen: () => ipcRenderer.invoke('window:fill-exit'),
  hideControls: (layer?: 'top' | 'bottom') => ipcRenderer.invoke('window:controls-hide', layer),
  restoreControls: () => ipcRenderer.invoke('window:controls-restore'),
  openSettings: () => ipcRenderer.send('window:settings'),
  closeSettings: () => ipcRenderer.send('window:settings-close'),
  minimizeSettings: () => ipcRenderer.send('window:settings-minimize'),
  quit: () => ipcRenderer.send('window:quit'),
  resetView: () => ipcRenderer.send('view:reset'),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: () => ipcRenderer.invoke('config:import'),
  setHitTest: (ignore: boolean) => ipcRenderer.send('window:ignore', ignore),
  setDragging: (dragging: boolean) => ipcRenderer.send('window:drag', dragging),
  moveStart: () => ipcRenderer.send('window:move-start'),
  moveEnd: () => ipcRenderer.send('window:move-end'),
  onCursor: (fn: any) => subscribe('pointer:position', fn),
  ready: () => ipcRenderer.send('view:ready'),
});

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('wifi', {
  meta: () => ipcRenderer.invoke('app:meta'),
  snapshot: (options) => ipcRenderer.invoke('net:snapshot', options || {}),
  scanWifi: () => ipcRenderer.invoke('wifi:scan'),
  wifiProfiles: () => ipcRenderer.invoke('wifi:profiles'),
  wifiProfileDetail: (payload) => ipcRenderer.invoke('wifi:profile-detail', payload || {}),
  wifiPassword: (payload) => ipcRenderer.invoke('wifi:password', payload || {}),
  wifiVerifyPassword: (payload) => ipcRenderer.invoke('wifi:verify-password', payload || {}),
  wifiConnect: (payload) => ipcRenderer.invoke('wifi:connect', payload || {}),
  wifiCapabilities: () => ipcRenderer.invoke('wifi:capabilities'),
  restartWlan: () => ipcRenderer.invoke('wifi:restart'),
  ping: (payload) => ipcRenderer.invoke('net:ping', payload || {}),
  onPingResult: (callback) => on('ping:result', callback),
  connectivity: (payload) => ipcRenderer.invoke('net:connectivity', payload || {}),
  dnsTest: (payload) => ipcRenderer.invoke('net:dns-test', payload || {}),
  tcpTest: (payload) => ipcRenderer.invoke('net:tcp-test', payload || {}),
  httpTest: (payload) => ipcRenderer.invoke('net:http-test', payload || {}),
  traceRoute: (payload) => ipcRenderer.invoke('net:trace', payload || {}),
  mtuTest: (payload) => ipcRenderer.invoke('net:mtu', payload || {}),
  stability: (payload) => ipcRenderer.invoke('net:stability', payload || {}),
  publicIp: () => ipcRenderer.invoke('net:public-ip'),
  events: () => ipcRenderer.invoke('net:events'),
  runDiagnostics: (payload) => ipcRenderer.invoke('diag:run', payload || {}),
  onDiagnostic: (callback) => on('diag:event', callback),
  startMonitor: (payload) => ipcRenderer.invoke('monitor:start', payload || {}),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  onMonitor: (callback) => on('monitor:sample', callback),
  speedTest: (payload) => ipcRenderer.invoke('speed:test', payload || {}),
  onSpeedProgress: (callback) => on('speed:progress', callback),
  repair: (payload) => ipcRenderer.invoke('repair:run', payload || {}),
  setPriority: (payload) => ipcRenderer.invoke('repair:set-priority', payload || {}),
  resetPriority: () => ipcRenderer.invoke('repair:reset-priority'),
  history: () => ipcRenderer.invoke('history:list'),
  historyItem: (id) => ipcRenderer.invoke('history:get', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  exportReport: (payload) => ipcRenderer.invoke('report:export', payload || {}),
  settings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('settings:update', payload || {}),
  setUiScale: (value) => ipcRenderer.invoke('app:set-ui-scale', value),
  relaunchAdmin: () => ipcRenderer.invoke('app:relaunch-admin'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openSettings: (page) => ipcRenderer.invoke('app:open-settings', page),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  showItem: (filePath) => ipcRenderer.invoke('app:show-item', filePath),
  copyText: (text) => ipcRenderer.invoke('app:copy', text),
  windowControl: (action) => ipcRenderer.invoke('app:window', action),
  onWindowState: (callback) => on('window:state', callback),
  onHistoryUpdated: (callback) => on('history:updated', callback),
  onToast: (callback) => on('app:toast', callback),
  version: '1.0.0',
});

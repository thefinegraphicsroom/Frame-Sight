// preload.js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Screen capture sources
  getSources:    ()       => ipcRenderer.invoke('get-sources'),

  // HTTP server
  startServer:   (name)   => ipcRenderer.invoke('start-server', name),

  // Live data relay
  updateData:    (data)   => ipcRenderer.invoke('update-data', data),

  // File system
  selectFolder:  ()       => ipcRenderer.invoke('select-folder'),
  saveProfile:   (data)   => ipcRenderer.invoke('save-profile', data),
  loadProfile:   ()       => ipcRenderer.invoke('load-profile'),

  // Network info
  getIP:         ()                   => ipcRenderer.invoke('get-ip'),
  getPort:       ()                   => ipcRenderer.invoke('get-port'),

  // Main-to-renderer events
  onServerUrl: (cb) => ipcRenderer.on('server-url', (_e, url, ip, port) => cb(url, ip, port)),

  // ── Python pytesseract OCR ──────────────────────────────────────────────
  // Check if the Python sidecar is ready (returns boolean)
  checkOcr: () => ipcRenderer.invoke('check-ocr'),

  // Send a base64-encoded PNG for OCR; returns { text } or throws
  ocrImage: (payload) => ipcRenderer.invoke('ocr-image', payload),

  // Listen for status updates: 'ready' | 'error'
  onOcrStatus: (cb) => ipcRenderer.on('ocr-status', (_e, status, detail) => cb(status, detail)),

  // Window controls
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),
});
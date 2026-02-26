// src/main/focus-preload.ts
// ──────────────────────────────────────────────────────────────
// Preload for the focus (floating detail) window.
// Exposes live screencast, bot identity, status/state, and log
// streams so the focus UI can show full context.
// ──────────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('focusApi', {
  // Live screencast frame
  onScreenshot: (cb: (dataUrl: string) => void) => {
    ipcRenderer.on('focus:screenshot', (_event, dataUrl: string) => cb(dataUrl));
  },

  // One-time bot identity + existing logs (sent right after window loads)
  onBotInfo: (cb: (info: { id: string; index: number; status: string; currentState: string; logs: unknown[] }) => void) => {
    ipcRenderer.on('focus:bot-info', (_event, info) => cb(info));
  },

  // Incremental log entry
  onBotLog: (cb: (entry: { timestamp: number; level: string; message: string }) => void) => {
    ipcRenderer.on('focus:bot-log', (_event, entry) => cb(entry));
  },

  // Status change (running/paused/done/dropped/error)
  onBotStatus: (cb: (status: string) => void) => {
    ipcRenderer.on('focus:bot-status', (_event, status: string) => cb(status));
  },

  // FSM state change
  onBotState: (cb: (state: string) => void) => {
    ipcRenderer.on('focus:bot-state', (_event, state: string) => cb(state));
  },

  // Commands back to main
  sendCommand: (cmd: string, payload?: unknown) => {
    ipcRenderer.send(cmd, payload);
  },
});

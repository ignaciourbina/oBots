// src/main/bot-view-preload.ts
// ──────────────────────────────────────────────────────────────
// Preload for per-bot BrowserView grid tiles.
// Each BrowserView gets its own renderer process (distributed
// across CPU cores by Chromium's process model).
// Exposes CDP screencast frames and bot identity/status/state.
// ──────────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer } from 'electron';

// Inline IPC channel strings (must match IpcChannel enum in types.ts)
const CH = {
  BOTVIEW_SCREENSHOT: 'botview:screenshot',
  BOTVIEW_INFO:       'botview:info',
  BOTVIEW_STATUS:     'botview:status',
  BOTVIEW_STATE:      'botview:state',
} as const;

contextBridge.exposeInMainWorld('botViewApi', {
  // Live CDP screencast frame
  onScreenshot: (cb: (dataUrl: string) => void) => {
    ipcRenderer.on(CH.BOTVIEW_SCREENSHOT, (_event, dataUrl: string) => cb(dataUrl));
  },

  // One-time bot identity (sent right after BrowserView loads)
  onBotInfo: (cb: (info: { id: string; index: number; status: string; currentState: string }) => void) => {
    ipcRenderer.on(CH.BOTVIEW_INFO, (_event, info) => cb(info));
  },

  // Status change (running/paused/done/dropped/error)
  onBotStatus: (cb: (status: string) => void) => {
    ipcRenderer.on(CH.BOTVIEW_STATUS, (_event, status: string) => cb(status));
  },

  // FSM state change
  onBotState: (cb: (state: string) => void) => {
    ipcRenderer.on(CH.BOTVIEW_STATE, (_event, state: string) => cb(state));
  },

  // Commands back to main
  sendCommand: (cmd: string, payload?: unknown) => {
    ipcRenderer.send(cmd, payload);
  },
});

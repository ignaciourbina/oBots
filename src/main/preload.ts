// src/main/preload.ts
// ──────────────────────────────────────────────────────────────
// Preload script — exposes a safe, typed API to the renderer
// process via contextBridge. No node access in renderer.
//
// IMPORTANT: Do NOT import from '../engine/types' here.
// Electron 28+ sandboxes the preload by default and
// require() only works for built-in electron modules.
// Inline the channel strings instead.
// ──────────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer } from 'electron';

// Inline IPC channel strings (must match IpcChannel enum in types.ts)
const CH = {
  GRID_LAYOUT:      'grid:layout',
  BOT_STATUS:       'bot:status',
  BOT_STATE_CHANGE: 'bot:state-change',
  BOT_LOG:          'bot:log',
  ALL_DONE:         'run:all-done',
  OPEN_DRAWER:      'open-drawer-for-bot',
} as const;

console.log('[preload] Preload script executing…');

try {
  contextBridge.exposeInMainWorld('otreeBots', {
    // ── Main → Renderer listeners ────────────────────────
    onGridLayout: (cb: (layout: unknown) => void) => {
      console.log('[preload] Registering onGridLayout listener');
      ipcRenderer.on(CH.GRID_LAYOUT, (_event, layout) => {
        console.log('[preload] Received grid:layout IPC');
        cb(layout);
      });
    },

    onBotStatus: (cb: (data: { id: string; status: string }) => void) => {
      ipcRenderer.on(CH.BOT_STATUS, (_event, data) => cb(data));
    },

    onBotStateChange: (cb: (data: { id: string; state: string }) => void) => {
      ipcRenderer.on(CH.BOT_STATE_CHANGE, (_event, data) => cb(data));
    },

    onBotLog: (cb: (data: { id: string; entry: unknown }) => void) => {
      ipcRenderer.on(CH.BOT_LOG, (_event, data) => cb(data));
    },

    onAllDone: (cb: () => void) => {
      ipcRenderer.on(CH.ALL_DONE, () => cb());
    },

    // Open drawer request forwarded from a BrowserView via main process
    onOpenDrawer: (cb: (data: { id: string; index: number }) => void) => {
      ipcRenderer.on(CH.OPEN_DRAWER, (_event, data) => cb(data));
    },

    // ── Renderer → Main commands ─────────────────────────
    sendCommand: (cmd: string, payload?: unknown) => {
      ipcRenderer.send(cmd, payload);
    },
  });
  console.log('[preload] contextBridge.exposeInMainWorld succeeded');
} catch (err) {
  console.error('[preload] FATAL: contextBridge failed:', err);
}

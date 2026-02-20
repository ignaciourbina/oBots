// src/main/overview-preload.ts
// Preload bridge for the dedicated Overview window.

import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '../engine/types';

contextBridge.exposeInMainWorld('overviewApi', {
  onSnapshot: (cb: (snapshot: unknown) => void) => {
    ipcRenderer.on(IpcChannel.OVERVIEW_SNAPSHOT, (_event, snapshot) => cb(snapshot));
  },
});

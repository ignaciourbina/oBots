// src/main/ipc-handlers.ts
// ──────────────────────────────────────────────────────────────
// IPC channel registrations — wires renderer commands to main
// process actions (start, stop, restart, pause, resume).
// ──────────────────────────────────────────────────────────────

import { ipcMain } from 'electron';
import { IpcChannel } from '../engine/types';
import { BotRunner } from './bot-runner';
import { createChildLogger } from './logger';
import { diagRenderer } from './screenshot-diag';
import type { UrlInjectionConfig } from '../engine/types';

const log = createChildLogger('ipc');

/** Strategy configuration payload sent from the renderer start form. */
export interface StrategyPayload {
  name: string;
  numberStrategy: string;
  numberFixedValue: number;
  textValue: string;
  selectStrategy: string;
  radioStrategy: string;
  checkboxStrategy: string;
  submitDelay: number;
  actionDelayMs: number;
  actionJitterMs: number;
  staleProbability: number;
  staleExtraDelayMs: number;
  dropProbability: number;
  customMessages?: string[];
  messageBankCategories?: string[];
}

/** Payload for the CMD_START IPC message from the renderer. */
export interface StartPayload {
  url: string;
  urlInjection?: UrlInjectionConfig;
  playerCount: number;
  dropoutRatePercent?: number;
  strategy?: StrategyPayload;
  repeatRounds?: number;
}

/** Callbacks for drawer and overview window IPC handlers. */
export interface UiHandlerDeps {
  onDrawerToggle: (open: boolean) => void;
  onOverviewToggle: (open: boolean) => void;
  openOverviewWindow: () => Promise<void>;
}

/**
 * Register all IPC handlers for renderer → main commands.
 */
export function registerIpcHandlers(
  runner: BotRunner,
  onStart: (payload: StartPayload) => Promise<void>,
  onRestart: () => Promise<void>,
  mainWindow: import('electron').BrowserWindow,
  uiDeps: UiHandlerDeps,
): void {
  // ── CMD_START ─────────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_START, (_event, payload: StartPayload) => {
    log.info('cmd:start received');
    void onStart(payload).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error('cmd:start failed: %s', message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannel.EVT_START_FAILED, { message });
      }
    });
  });

  // ── CMD_STOP ──────────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_STOP, async () => {
    log.info('cmd:stop received');
    await runner.stopAll();
  });

  // ── CMD_RESTART ───────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_RESTART, () => {
    log.info('cmd:restart received');
    void onRestart().catch((err) => {
      log.error('cmd:restart failed: %s', err instanceof Error ? err.message : String(err));
    });
  });

  // ── CMD_PAUSE ─────────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_PAUSE, (_event, payload: { id: string }) => {
    log.info('cmd:pause-bot received for %s', payload.id);
    runner.pauseBot(payload.id);
  });

  // ── CMD_RESUME ────────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_RESUME, (_event, payload: { id: string }) => {
    log.info('cmd:resume-bot received for %s', payload.id);
    runner.resumeBot(payload.id);
  });

  // ── CMD_FOCUS ──────────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_FOCUS, (_event, payload: { id: string }) => {
    log.info('cmd:focus-bot received for %s', payload.id);
    runner.openFocusWindow(payload.id);
  });
  // ── SCREENSHOT_DIAG (renderer → main forwarding) ─────────
  ipcMain.on(IpcChannel.SCREENSHOT_DIAG, (_event, payload: {
    botId: string;
    index: number;
    event: string;
    detail?: Record<string, unknown>;
  }) => {
    diagRenderer(payload.botId, payload.index, payload.event, payload.detail);
  });

  // ── CMD_OPEN_DRAWER ──────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_OPEN_DRAWER, (_event, payload: { id: string; index: number }) => {
    log.debug('cmd:open-drawer received for %s', payload.id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-drawer-for-bot', payload);
    }
  });

  // ── CMD_DRAWER_TOGGLE ────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_DRAWER_TOGGLE, (_event, payload: { open: boolean }) => {
    uiDeps.onDrawerToggle(payload.open);
  });

  // ── CMD_OPEN_OVERVIEW ────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_OPEN_OVERVIEW, () => {
    void uiDeps.openOverviewWindow().catch((err) => {
      log.error('Failed to open overview window: %s', err instanceof Error ? err.message : String(err));
    });
  });

  // ── CMD_OVERVIEW_TOGGLE ──────────────────────────────────
  ipcMain.on(IpcChannel.CMD_OVERVIEW_TOGGLE, (_event, payload: { open: boolean }) => {
    uiDeps.onOverviewToggle(payload.open);
  });
}

/**
 * Remove all IPC handlers (cleanup on quit).
 */
export function removeIpcHandlers(): void {
  ipcMain.removeAllListeners(IpcChannel.CMD_START);
  ipcMain.removeAllListeners(IpcChannel.CMD_STOP);
  ipcMain.removeAllListeners(IpcChannel.CMD_RESTART);
  ipcMain.removeAllListeners(IpcChannel.CMD_PAUSE);
  ipcMain.removeAllListeners(IpcChannel.CMD_RESUME);
  ipcMain.removeAllListeners(IpcChannel.CMD_FOCUS);
  ipcMain.removeAllListeners(IpcChannel.SCREENSHOT_DIAG);
  ipcMain.removeAllListeners(IpcChannel.CMD_OPEN_DRAWER);
  ipcMain.removeAllListeners(IpcChannel.CMD_DRAWER_TOGGLE);
  ipcMain.removeAllListeners(IpcChannel.CMD_OPEN_OVERVIEW);
  ipcMain.removeAllListeners(IpcChannel.CMD_OVERVIEW_TOGGLE);
}

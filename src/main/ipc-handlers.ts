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
}

export interface StartPayload {
  url: string;
  urlInjection?: UrlInjectionConfig;
  playerCount: number;
  strategy?: StrategyPayload;
  repeatRounds?: number;
}

/**
 * Register all IPC handlers for renderer → main commands.
 */
export function registerIpcHandlers(
  runner: BotRunner,
  onStart: (payload: StartPayload) => Promise<void>,
  onRestart: () => Promise<void>,
): void {
  // ── CMD_START ─────────────────────────────────────────
  ipcMain.on(IpcChannel.CMD_START, (_event, payload: StartPayload) => {
    log.info('cmd:start received');
    void onStart(payload).catch((err) => {
      log.error('cmd:start failed: %s', err instanceof Error ? err.message : String(err));
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
  });}

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
  ipcMain.removeAllListeners(IpcChannel.CMD_OPEN_DRAWER);
  ipcMain.removeAllListeners(IpcChannel.CMD_DRAWER_TOGGLE);
  ipcMain.removeAllListeners(IpcChannel.CMD_OVERVIEW_TOGGLE);
}

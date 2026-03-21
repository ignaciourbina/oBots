// src/main/bot-session.ts
// ──────────────────────────────────────────────────────────────
// Encapsulates per-bot lifecycle resources: FSM runner, grid
// screencast CDP session, and focus (zoom) window.
// SessionRegistry remains the sole source of truth for bot state.
// ──────────────────────────────────────────────────────────────

import type { CDPSession } from 'puppeteer';
import type { BrowserWindow } from 'electron';
import type { StateMachineRunner } from '../engine/state-machine';
import { stopScreencast } from './screencast';

/**
 * Per-bot lifecycle container managed by {@link BotRunner}.
 * Groups the FSM runner, grid-tile CDP screencast, and focus-window
 * resources that were previously tracked in three separate Maps.
 */
export class BotSession {
  /** FSM runner driving this bot's state machine. */
  runner: StateMachineRunner | null = null;

  private gridCdp: CDPSession | null = null;
  private gridActive = false;

  private focusWin: BrowserWindow | null = null;
  private focusCdp: CDPSession | null = null;

  constructor(readonly botId: string) {}

  // ── FSM ─────────────────────────────────────────────

  /** Pause this bot's FSM. */
  pauseFSM(): void {
    this.runner?.pause();
  }

  /** Resume this bot's paused FSM. */
  resumeFSM(): void {
    this.runner?.resume();
  }

  // ── Grid Screencast ─────────────────────────────────

  /** Register the CDP session used for grid-tile screencasting. */
  setGridScreencast(cdp: CDPSession): void {
    this.gridCdp = cdp;
    this.gridActive = true;
  }

  /** Whether the grid screencast is actively piping frames. */
  get isGridActive(): boolean {
    return this.gridActive;
  }

  /** Stop the grid screencast and release the CDP session. */
  stopGridScreencast(): void {
    if (this.gridCdp) {
      this.gridActive = false;
      void stopScreencast(this.gridCdp);
      this.gridCdp = null;
    }
  }

  // ── Focus Window ────────────────────────────────────

  /** Associate a focus (zoom) window and its CDP session. */
  setFocusSession(win: BrowserWindow, cdp: CDPSession): void {
    this.focusWin = win;
    this.focusCdp = cdp;
  }

  /** Get the focus window if it exists and isn't destroyed. */
  getFocusWindow(): BrowserWindow | null {
    if (this.focusWin && !this.focusWin.isDestroyed()) return this.focusWin;
    return null;
  }

  /** Send an IPC message to this bot's focus window (if open). */
  sendToFocus(channel: string, data: unknown): void {
    const win = this.getFocusWindow();
    if (win) {
      win.webContents.send(channel, data);
    }
  }

  /** Clear the focus session references (called on window close). */
  clearFocusSession(): void {
    this.focusWin = null;
    this.focusCdp = null;
  }

  // ── Lifecycle ───────────────────────────────────────

  /** Clean up all resources owned by this session. */
  cleanup(): void {
    this.stopGridScreencast();

    this.runner?.stop();

    if (this.focusCdp) {
      void stopScreencast(this.focusCdp);
    }
    const win = this.getFocusWindow();
    if (win) win.close();
    this.clearFocusSession();
  }
}

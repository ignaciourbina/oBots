// src/main/session-registry.ts
// ──────────────────────────────────────────────────────────────
// Central in-memory store for all bot instances.
// Single source of truth for bot state during a run.
// ──────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import {
  BotInstance,
  BotScript,
  BotStatus,
  LogEntry,
  SerializedBot,
} from '../engine/types';
import { createChildLogger } from './logger';

const log = createChildLogger('registry');
const CLOSE_STAGGER_MS = 35;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SessionRegistry {
  private bots: Map<string, BotInstance> = new Map();

  /**
   * Create a new bot instance and register it.
   */
  createBot(index: number, script: BotScript): BotInstance {
    const id = uuidv4();
    const now = Date.now();
    const bot: BotInstance = {
      id,
      index,
      createdAt: now,
      script,
      currentState: script.initialState,
      lastStateChangeAt: now,
      status: 'idle',
      browser: null,
      page: null,
      webviewId: `webview-${index}`,
      logs: [],
    };
    this.bots.set(id, bot);
    return bot;
  }

  /**
   * Retrieve a bot by id.
   */
  getBot(id: string): BotInstance | undefined {
    return this.bots.get(id);
  }

  /**
   * Get all registered bots.
   */
  getAllBots(): BotInstance[] {
    return Array.from(this.bots.values());
  }

  /**
   * Get bot count.
   */
  get size(): number {
    return this.bots.size;
  }

  /**
   * Update a bot's status.
   */
  updateStatus(id: string, status: BotStatus): void {
    const bot = this.bots.get(id);
    if (bot) {
      bot.status = status;
    }
  }

  /**
   * Update a bot's current FSM state.
   */
  updateCurrentState(id: string, state: string): void {
    const bot = this.bots.get(id);
    if (bot) {
      // Only refresh stale-watchdog timestamp when state truly changes.
      // Self-loops should still be considered stale after timeout.
      const changed = bot.currentState !== state;
      bot.currentState = state;
      if (changed) {
        bot.lastStateChangeAt = Date.now();
      }
    }
  }

  /**
   * Return running bots whose state has not changed within maxIdleMs.
   */
  getStaleRunningBots(maxIdleMs: number, nowMs: number = Date.now()): BotInstance[] {
    const stale: BotInstance[] = [];
    for (const bot of this.bots.values()) {
      if (bot.status !== 'running') {
        continue;
      }
      if ((nowMs - bot.lastStateChangeAt) >= maxIdleMs) {
        stale.push(bot);
      }
    }
    return stale;
  }

  /**
   * Return running bots that exceeded maximum runtime budget.
   */
  getOverdueRunningBots(maxRuntimeMs: number, nowMs: number = Date.now()): BotInstance[] {
    const overdue: BotInstance[] = [];
    for (const bot of this.bots.values()) {
      if (bot.status !== 'running') {
        continue;
      }
      if ((nowMs - bot.createdAt) >= maxRuntimeMs) {
        overdue.push(bot);
      }
    }
    return overdue;
  }

  /**
   * Append a log entry to a bot.
   */
  addLog(id: string, entry: LogEntry): void {
    const bot = this.bots.get(id);
    if (bot) {
      bot.logs.push(entry);
    }
  }

  /**
   * Set error on a bot.
   */
  setError(id: string, error: string): void {
    const bot = this.bots.get(id);
    if (bot) {
      bot.error = error;
      bot.status = 'error';
    }
  }

  /**
   * Check if all bots have finished (done, dropped, or error).
   */
  allFinished(): boolean {
    for (const bot of this.bots.values()) {
      if (bot.status !== 'done' && bot.status !== 'dropped' && bot.status !== 'error') {
        return false;
      }
    }
    return this.bots.size > 0;
  }

  /**
   * Serialize registry for IPC transport (strips non-serializable fields).
   */
  toJSON(): SerializedBot[] {
    return this.getAllBots().map((bot) => ({
      id: bot.id,
      index: bot.index,
      scriptName: bot.script.name,
      currentState: bot.currentState,
      status: bot.status,
      logs: bot.logs,
      error: bot.error,
    }));
  }

  /**
   * Destroy all bots — close browsers and clear registry.
   */
  async destroyAll(): Promise<void> {
    // Close sequentially with a tiny stagger to avoid connection-close storms
    // against the experiment's websocket server.
    const bots = Array.from(this.bots.values());
    for (let i = 0; i < bots.length; i++) {
      await this.closeBotTransport(bots[i]);
      if (i < bots.length - 1) {
        await sleep(CLOSE_STAGGER_MS);
      }
    }
    this.bots.clear();
  }

  /**
   * Gracefully tear down one bot's page/browser transport.
   */
  private async closeBotTransport(bot: BotInstance): Promise<void> {
    if (!bot.browser) {
      bot.page = null;
      return;
    }

    let openPages: NonNullable<BotInstance['page']>[] = [];
    try {
      openPages = await bot.browser.pages();
    } catch (err) {
      log.warn(
        'Failed to list pages for bot %s: %s',
        bot.id,
        err instanceof Error ? err.message : String(err),
      );
    }

    const pages = new Set(openPages);
    if (bot.page) {
      pages.add(bot.page);
    }

    for (const page of pages) {
      if (!page) {
        continue;
      }
      try {
        if (!page.isClosed()) {
          await page.close({ runBeforeUnload: true });
        }
      } catch (err) {
        log.warn(
          'Failed to close page for bot %s: %s',
          bot.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    try {
      await bot.browser.close();
    } catch (err) {
      log.error(
        'Failed to close browser for bot %s: %s',
        bot.id,
        err instanceof Error ? err.message : String(err),
      );
      try {
        bot.browser.process()?.kill('SIGKILL');
      } catch {
        // Best-effort final fallback.
      }
    }

    bot.page = null;
    bot.browser = null;
  }
}

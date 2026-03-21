// src/main/dropout-simulator.ts
// ──────────────────────────────────────────────────────────────
// Encapsulates dropout-simulation logic: sampling which bots
// will drop out and scheduling their dropout timers.
// ──────────────────────────────────────────────────────────────

import { BotInstance, DEFAULTS, isTerminalStatus } from '../engine/types';
import { createChildLogger } from './logger';

const log = createChildLogger('dropout');

/** Callback used to force-finish a bot when its dropout timer fires. */
export type ForceFinishFn = (botId: string, reason: string, finalStatus: 'done' | 'dropped') => void;

/** Configuration slice needed by the dropout simulator. */
export interface DropoutConfig {
  dropoutRatePercent: number;
  delayMultiplier?: number;
  strategy: {
    actionDelayMs?: number;
  };
}

/**
 * Manages per-run dropout simulation: selects a random subset of bots
 * and schedules delayed force-finish timers for each.
 */
export class DropoutSimulator {
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Clamp a dropout rate percentage to the valid [0, 100] range.
   */
  private clampDropoutRate(percent: number | undefined): number {
    const value = percent == null ? DEFAULTS.dropoutRatePercent : Number(percent);
    if (!Number.isFinite(value)) return DEFAULTS.dropoutRatePercent;
    return Math.max(0, Math.min(100, value));
  }

  /**
   * Fisher-Yates shuffle to sample `count` bot IDs for dropout.
   */
  private sampleDropoutBotIds(allBotIds: string[], count: number): Set<string> {
    if (count <= 0 || allBotIds.length === 0) {
      return new Set<string>();
    }

    const ids = [...allBotIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }

    return new Set(ids.slice(0, Math.min(count, ids.length)));
  }

  /**
   * Schedule dropout timers for a random subset of bots.
   *
   * Call this once per run after all bots have been launched.
   * The `getBotFn` callback retrieves current bot state at timer-fire time
   * so that already-finished bots are skipped.
   */
  scheduleDropouts(
    bots: BotInstance[],
    config: DropoutConfig,
    forceFinish: ForceFinishFn,
    getBotFn: (id: string) => BotInstance | undefined,
  ): void {
    const dropoutRatePercent = this.clampDropoutRate(config.dropoutRatePercent);

    const dropoutCount = Math.min(
      bots.length,
      Math.round((dropoutRatePercent / 100) * bots.length),
    );
    const dropoutBotIds = this.sampleDropoutBotIds(
      bots.map((bot) => bot.id),
      dropoutCount,
    );

    if (dropoutBotIds.size === 0) return;

    log.info(
      'Dropout simulation armed: %s%% => %d/%d bots',
      dropoutRatePercent,
      dropoutBotIds.size,
      bots.length,
    );

    for (const bot of bots) {
      if (!dropoutBotIds.has(bot.id)) continue;

      // Compute a dropout window that scales with bot speed settings so
      // dropouts are spread realistically across the run instead of all
      // firing in the first few seconds.
      const actionDelay = config.strategy.actionDelayMs ?? 0;
      const multiplier = config.delayMultiplier ?? 1.0;
      const estimatedRunMs = Math.max(
        30_000,                                          // at least 30 s
        DEFAULTS.botMaxRuntimeMs * 0.8,                  // 80 % of budget
        actionDelay * multiplier * 200,                  // ~200 actions worth
      );
      const minDelay = DEFAULTS.dropoutMinDelayMs;
      const maxDelay = Math.min(
        Math.max(minDelay, estimatedRunMs),
        DEFAULTS.dropoutMaxDelayMs,
      );
      const delayMs = minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));

      const timer = setTimeout(() => {
        this.timers.delete(bot.id);
        const currentBot = getBotFn(bot.id);
        if (!currentBot) return;
        if (isTerminalStatus(currentBot.status)) return;

        const delaySeconds = (delayMs / 1000).toFixed(1);
        log.warn(
          'Simulated dropout fired for bot #%d (%s) after %ss',
          bot.index,
          bot.id,
          delaySeconds,
        );
        forceFinish(
          bot.id,
          `simulated dropout after ${delaySeconds}s (${dropoutRatePercent}% per run)`,
          'dropped',
        );
      }, delayMs);

      this.timers.set(bot.id, timer);
      log.info(
        'Scheduled simulated dropout for bot #%d (%s) in %dms',
        bot.index,
        bot.id,
        delayMs,
      );
    }
  }

  /** Clear all pending dropout timers. */
  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

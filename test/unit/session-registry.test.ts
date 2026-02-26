import { describe, it, expect, vi } from 'vitest';
import { SessionRegistry } from '../../src/main/session-registry';
import { BotScript } from '../../src/engine/types';

function makeScript(): BotScript {
  return {
    name: 'Test Script',
    initialState: 'start',
    states: {
      start: {
        onEntry: [{ type: 'log', value: 'hello' }],
        transitions: [{ target: 'done' }],
      },
      done: {
        onEntry: [],
        transitions: [],
        final: true,
      },
    },
  };
}

describe('SessionRegistry', () => {
  it('creates bots and updates status/state/logs', () => {
    const registry = new SessionRegistry();
    const bot = registry.createBot(0, makeScript());

    expect(registry.size).toBe(1);
    expect(bot.id).toBeTruthy();
    expect(bot.currentState).toBe('start');
    expect(bot.status).toBe('idle');

    registry.updateStatus(bot.id, 'running');
    registry.updateCurrentState(bot.id, 'done');
    registry.addLog(bot.id, { timestamp: Date.now(), level: 'info', message: 'ok' });

    const updated = registry.getBot(bot.id);
    expect(updated?.status).toBe('running');
    expect(updated?.currentState).toBe('done');
    expect(updated?.logs).toHaveLength(1);
  });

  it('computes allFinished only when all are done/dropped/error', () => {
    const registry = new SessionRegistry();
    const a = registry.createBot(0, makeScript());
    const b = registry.createBot(1, makeScript());

    expect(registry.allFinished()).toBe(false);

    registry.updateStatus(a.id, 'dropped');
    expect(registry.allFinished()).toBe(false);

    registry.setError(b.id, 'boom');
    expect(registry.allFinished()).toBe(true);
  });

  it('serializes bots to JSON-safe structure', () => {
    const registry = new SessionRegistry();
    const bot = registry.createBot(2, makeScript());
    registry.setError(bot.id, 'failed');

    const json = registry.toJSON();
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({
      id: bot.id,
      index: 2,
      scriptName: 'Test Script',
      status: 'error',
      error: 'failed',
    });
  });

  it('destroyAll closes open browsers and clears registry', async () => {
    const registry = new SessionRegistry();
    const a = registry.createBot(0, makeScript());
    const b = registry.createBot(1, makeScript());

    const closeA = vi.fn(async () => undefined);
    const closeB = vi.fn(async () => {
      throw new Error('close failed');
    });

    a.browser = { close: closeA } as any;
    b.browser = { close: closeB } as any;

    await registry.destroyAll();

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('detects stale running bots using last state change timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const registry = new SessionRegistry();
      const stale = registry.createBot(0, makeScript());
      const healthy = registry.createBot(1, makeScript());
      const paused = registry.createBot(2, makeScript());

      registry.updateStatus(stale.id, 'running');
      registry.updateStatus(healthy.id, 'running');
      registry.updateStatus(paused.id, 'paused');

      vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'));
      registry.updateCurrentState(healthy.id, 'still-running');

      vi.setSystemTime(new Date('2026-01-01T00:01:05.000Z'));
      const staleBots = registry.getStaleRunningBots(60_000);

      expect(staleBots.map((bot) => bot.id)).toEqual([stale.id]);
      expect(staleBots[0].lastStateChangeAt).toBe(
        new Date('2026-01-01T00:00:00.000Z').getTime(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not refresh stale timer on self-transition to same state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const registry = new SessionRegistry();
      const bot = registry.createBot(0, makeScript());
      registry.updateStatus(bot.id, 'running');

      vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'));
      registry.updateCurrentState(bot.id, 'start');

      vi.setSystemTime(new Date('2026-01-01T00:01:05.000Z'));
      const staleBots = registry.getStaleRunningBots(60_000);
      expect(staleBots.map((b) => b.id)).toEqual([bot.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detects running bots that exceed max runtime', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const registry = new SessionRegistry();
      const overdue = registry.createBot(0, makeScript());
      registry.updateStatus(overdue.id, 'running');

      vi.setSystemTime(new Date('2026-01-01T00:04:00.000Z'));
      const healthy = registry.createBot(1, makeScript());
      registry.updateStatus(healthy.id, 'running');

      vi.setSystemTime(new Date('2026-01-01T00:05:10.000Z'));
      const overdueBots = registry.getOverdueRunningBots(300_000);
      expect(overdueBots.map((b) => b.id)).toEqual([overdue.id]);
    } finally {
      vi.useRealTimers();
    }
  });
});

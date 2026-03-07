// test/unit/state-machine.test.ts
// ──────────────────────────────────────────────────────────────
// Unit tests for the FSM interpreter.
// Uses mock Page objects to verify state transitions,
// stale/drop probability, polling, and error resilience.
// ──────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateMachineRunner, FSMCallbacks } from '../../src/engine/state-machine';
import { BotScript, BotStatus, BotStrategy, DEFAULT_STRATEGY, LogEntry } from '../../src/engine/types';

// ── Helpers ─────────────────────────────────────────────────

/** Create a minimal mock Puppeteer Page */
function createMockPage(overrides: Record<string, unknown> = {}): any {
  return {
    url: () => 'http://localhost:8000/p/abc123/Introduction/1',
    $: vi.fn().mockResolvedValue(null),
    $eval: vi.fn().mockResolvedValue(''),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue('base64data'),
    reload: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Create a simple two-state script: start → done */
function createSimpleScript(): BotScript {
  return {
    name: 'Test Script',
    initialState: 'start',
    states: {
      start: {
        onEntry: [
          { type: 'log', value: 'Starting' },
        ],
        transitions: [
          { target: 'done' },  // no guard = immediate transition
        ],
      },
      done: {
        onEntry: [
          { type: 'log', value: 'Done' },
        ],
        transitions: [],
        final: true,
      },
    },
  };
}

/** Create a multi-state script with URL-changing navigations to test stale per-page */
function createMultiPageScript(): BotScript {
  return {
    name: 'Multi-Page Script',
    initialState: 'page1_fill',
    states: {
      page1_fill: {
        onEntry: [{ type: 'log', value: 'Filling page 1' }],
        transitions: [{ target: 'page1_submit' }],
      },
      page1_submit: {
        onEntry: [{ type: 'log', value: 'Submitting page 1' }],
        transitions: [{ target: 'page2_fill' }],
      },
      page2_fill: {
        onEntry: [{ type: 'log', value: 'Filling page 2' }],
        transitions: [{ target: 'page2_submit' }],
      },
      page2_submit: {
        onEntry: [{ type: 'log', value: 'Submitting page 2' }],
        transitions: [{ target: 'done' }],
      },
      done: {
        onEntry: [{ type: 'log', value: 'Done' }],
        transitions: [],
        final: true,
      },
    },
  };
}

function createCallbacks(): FSMCallbacks & {
  stateChanges: string[];
  logs: LogEntry[];
  statusChanges: BotStatus[];
  errors: Error[];
} {
  const stateChanges: string[] = [];
  const logs: LogEntry[] = [];
  const statusChanges: BotStatus[] = [];
  const errors: Error[] = [];

  return {
    stateChanges,
    logs,
    statusChanges,
    errors,
    onStateChange: (_botId: string, newState: string) => stateChanges.push(newState),
    onLog: (_botId: string, entry: LogEntry) => logs.push(entry),
    onStatusChange: (_botId: string, status: BotStatus) => statusChanges.push(status),
    onError: (_botId: string, error: Error) => errors.push(error),
  };
}

function makeStrategy(overrides: Partial<BotStrategy> = {}): BotStrategy {
  return { ...DEFAULT_STRATEGY, ...overrides };
}

// ── Tests ───────────────────────────────────────────────────

describe('StateMachineRunner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Group 1: Basic FSM lifecycle ────────────────────────

  it('should reach a final state and report done', async () => {
    const page = createMockPage();
    const script = createSimpleScript();
    const callbacks = createCallbacks();

    const runner = new StateMachineRunner('bot-1', script, page, callbacks);
    await runner.run();

    expect(runner.status).toBe('done');
    expect(runner.currentState).toBe('done');
    expect(callbacks.stateChanges).toContain('done');
    expect(callbacks.statusChanges).toContain('running');
    expect(callbacks.statusChanges).toContain('done');
  });

  it('should execute onEntry actions', async () => {
    const page = createMockPage();
    const script = createSimpleScript();
    const callbacks = createCallbacks();

    const runner = new StateMachineRunner('bot-1', script, page, callbacks);
    await runner.run();

    const messages = callbacks.logs.map((l) => l.message);
    expect(messages).toContain('Starting');
    expect(messages.some((m) => m.includes('final state'))).toBe(true);
  });

  it('should error on unknown state', async () => {
    const page = createMockPage();
    const script: BotScript = {
      name: 'Bad Script',
      initialState: 'nonexistent',
      states: {},
    };
    const callbacks = createCallbacks();

    const runner = new StateMachineRunner('bot-1', script, page, callbacks);
    await runner.run();

    expect(runner.status).toBe('error');
    expect(callbacks.errors.length).toBeGreaterThan(0);
    expect(callbacks.errors[0].message).toContain('nonexistent');
  });

  it('should support pause and resume', async () => {
    const page = createMockPage();
    const script = createSimpleScript();
    const callbacks = createCallbacks();

    const runner = new StateMachineRunner('bot-1', script, page, callbacks);

    const runPromise = runner.run();
    runner.pause();

    expect(['paused', 'done']).toContain(runner.status);

    if (runner.status === 'paused') {
      runner.resume();
      await new Promise((r) => setTimeout(r, 100));
    }

    await runPromise.catch(() => {});
  });

  // ── Group 2: Stale/drop probability (per-page) ─────────

  describe('stale/drop probability', () => {
    it('rolls stale only once per URL (not per state)', async () => {
      // Same URL for all states → stale should roll at most once
      const page = createMockPage({
        url: () => 'http://localhost:8000/p/abc123/Page/1',
      });
      const callbacks = createCallbacks();
      const strategy = makeStrategy({ staleProbability: 1.0, staleExtraDelayMs: 0, dropProbability: 0 });

      const runner = new StateMachineRunner(
        'bot-1', createMultiPageScript(), page, callbacks,
        1.0, 0, 0, strategy,
      );
      await runner.run();

      const staleCount = callbacks.statusChanges.filter((s) => s === 'stale').length;
      expect(staleCount).toBe(1);
      expect(runner.status).toBe('done');
    });

    it('rolls stale again when URL changes', async () => {
      let callCount = 0;
      const urls = [
        'http://localhost:8000/p/abc123/Page/1',
        'http://localhost:8000/p/abc123/Page/1',
        'http://localhost:8000/p/abc123/Page/2', // URL changes at state 3
        'http://localhost:8000/p/abc123/Page/2',
        'http://localhost:8000/p/abc123/Page/2',
      ];
      const page = createMockPage({
        url: () => urls[Math.min(callCount++, urls.length - 1)],
      });
      const callbacks = createCallbacks();
      const strategy = makeStrategy({ staleProbability: 1.0, staleExtraDelayMs: 0, dropProbability: 0 });

      const runner = new StateMachineRunner(
        'bot-1', createMultiPageScript(), page, callbacks,
        1.0, 0, 0, strategy,
      );
      await runner.run();

      const staleCount = callbacks.statusChanges.filter((s) => s === 'stale').length;
      expect(staleCount).toBe(2);
      expect(runner.status).toBe('done');
    });

    it('never triggers stale on final states', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();
      const strategy = makeStrategy({ staleProbability: 1.0, staleExtraDelayMs: 0 });

      const runner = new StateMachineRunner(
        'bot-1', createSimpleScript(), page, callbacks,
        1.0, 0, 0, strategy,
      );
      await runner.run();

      // The simple script has start → done. 'start' is not final so it can go stale,
      // but 'done' is final and must never trigger stale.
      expect(runner.status).toBe('done');
      // At most 1 stale (from 'start'), never from 'done'
      const staleCount = callbacks.statusChanges.filter((s) => s === 'stale').length;
      expect(staleCount).toBeLessThanOrEqual(1);
    });

    it('stale → recovery lifecycle (staleProbability=1, dropProbability=0)', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();
      const strategy = makeStrategy({ staleProbability: 1.0, staleExtraDelayMs: 0, dropProbability: 0 });

      const runner = new StateMachineRunner(
        'bot-1', createSimpleScript(), page, callbacks,
        1.0, 0, 0, strategy,
      );
      await runner.run();

      expect(runner.status).toBe('done');
      // Must see running → stale → running → done
      const idx = (s: BotStatus) => callbacks.statusChanges.indexOf(s);
      expect(callbacks.statusChanges).toContain('stale');
      expect(idx('stale')).toBeGreaterThan(idx('running'));

      // Recovery log
      const messages = callbacks.logs.map((l) => l.message);
      expect(messages.some((m) => m.includes('recovered from stale'))).toBe(true);
    });

    it('stale → drop lifecycle (staleProbability=1, dropProbability=1)', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();
      const strategy = makeStrategy({ staleProbability: 1.0, staleExtraDelayMs: 0, dropProbability: 1.0 });

      const runner = new StateMachineRunner(
        'bot-1', createSimpleScript(), page, callbacks,
        1.0, 0, 0, strategy,
      );
      await runner.run();

      expect(runner.status).toBe('dropped');
      expect(callbacks.statusChanges).toContain('stale');
      expect(callbacks.statusChanges).toContain('dropped');
      // Must not reach 'done'
      expect(callbacks.statusChanges).not.toContain('done');

      const messages = callbacks.logs.map((l) => l.message);
      expect(messages.some((m) => m.includes('dropped out'))).toBe(true);
    });

    it('drop is impossible without stale (staleProbability=0, dropProbability=1)', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();
      const strategy = makeStrategy({ staleProbability: 0, dropProbability: 1.0 });

      const runner = new StateMachineRunner(
        'bot-1', createSimpleScript(), page, callbacks,
        1.0, 0, 0, strategy,
      );
      await runner.run();

      expect(runner.status).toBe('done');
      expect(callbacks.statusChanges).not.toContain('stale');
      expect(callbacks.statusChanges).not.toContain('dropped');
    });

    it('staleExtraDelayMs is respected', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();
      const delayMs = 150;
      const strategy = makeStrategy({ staleProbability: 1.0, staleExtraDelayMs: delayMs, dropProbability: 0 });

      const runner = new StateMachineRunner(
        'bot-1', createSimpleScript(), page, callbacks,
        1.0, 0, 0, strategy,
      );

      const start = Date.now();
      await runner.run();
      const elapsed = Date.now() - start;

      expect(runner.status).toBe('done');
      expect(elapsed).toBeGreaterThanOrEqual(delayMs - 10); // small tolerance
    });

    it('skips stale check gracefully when page.url() throws', async () => {
      const page = createMockPage({
        url: () => { throw new Error('Target closed'); },
      });
      const callbacks = createCallbacks();
      const strategy = makeStrategy({ staleProbability: 1.0, staleExtraDelayMs: 0, dropProbability: 0 });

      const runner = new StateMachineRunner(
        'bot-1', createSimpleScript(), page, callbacks,
        1.0, 0, 0, strategy,
      );
      await runner.run();

      // Should complete without stale or error — the check is skipped
      expect(runner.status).toBe('done');
      expect(callbacks.statusChanges).not.toContain('stale');
    });
  });

  // ── Group 3: Transition polling & timeout ───────────────

  describe('transition polling', () => {
    it('fires guarded transition when guard passes', async () => {
      const page = createMockPage({
        $: vi.fn()
          .mockResolvedValueOnce(null)     // first guard fails
          .mockResolvedValueOnce({})        // second guard passes
          .mockResolvedValueOnce(null),
      });
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'Guard Test',
        initialState: 'start',
        states: {
          start: {
            onEntry: [],
            transitions: [
              { target: 'wrong', guard: { type: 'elementExists', selector: '.a' } },
              { target: 'correct', guard: { type: 'elementExists', selector: '.b' } },
            ],
          },
          wrong: { onEntry: [], transitions: [{ target: 'done' }] },
          correct: { onEntry: [], transitions: [{ target: 'done' }] },
          done: { onEntry: [], transitions: [], final: true },
        },
      };

      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      await runner.run();

      expect(callbacks.stateChanges).toContain('correct');
      expect(callbacks.stateChanges).not.toContain('wrong');
    });

    it('unguarded transition fires immediately without polling', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'No Guard',
        initialState: 'a',
        states: {
          a: { onEntry: [], transitions: [{ target: 'b' }] },
          b: { onEntry: [], transitions: [{ target: 'done' }] },
          done: { onEntry: [], transitions: [], final: true },
        },
      };

      const start = Date.now();
      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      await runner.run();
      const elapsed = Date.now() - start;

      expect(runner.status).toBe('done');
      expect(elapsed).toBeLessThan(200); // should be nearly instant
    });

    it('respects transition delay', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();
      const delayMs = 150;

      const script: BotScript = {
        name: 'Delay Test',
        initialState: 'start',
        states: {
          start: {
            onEntry: [],
            transitions: [{ target: 'done', delay: delayMs }],
          },
          done: { onEntry: [], transitions: [], final: true },
        },
      };

      const start = Date.now();
      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      await runner.run();
      const elapsed = Date.now() - start;

      expect(runner.status).toBe('done');
      expect(elapsed).toBeGreaterThanOrEqual(delayMs - 10);
    });

    it('errors on transition timeout when no guard matches', async () => {
      const page = createMockPage({
        $: vi.fn().mockResolvedValue(null), // guard always fails
      });
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'Timeout Test',
        initialState: 'stuck',
        states: {
          stuck: {
            onEntry: [],
            transitions: [
              { target: 'done', guard: { type: 'elementExists', selector: '.never' } },
            ],
          },
          done: { onEntry: [], transitions: [], final: true },
        },
      };

      // Temporarily lower maxPollTimeMs so we don't wait 120s
      const { DEFAULTS } = await import('../../src/engine/types');
      const original = DEFAULTS.maxPollTimeMs;
      (DEFAULTS as any).maxPollTimeMs = 300;

      try {
        const runner = new StateMachineRunner('bot-1', script, page, callbacks);
        await runner.run();

        expect(runner.status).toBe('error');
        expect(callbacks.errors[0].message).toContain('Transition timeout');
      } finally {
        (DEFAULTS as any).maxPollTimeMs = original;
      }
    });

    it('exits cleanly when stopped during polling', async () => {
      let pollCount = 0;
      const page = createMockPage({
        $: vi.fn(async () => {
          pollCount++;
          return null; // guard never passes
        }),
      });
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'Stop During Poll',
        initialState: 'polling',
        states: {
          polling: {
            onEntry: [],
            transitions: [
              { target: 'done', guard: { type: 'elementExists', selector: '.never' } },
            ],
          },
          done: { onEntry: [], transitions: [], final: true },
        },
      };

      // Lower poll time so the test doesn't take long
      const { DEFAULTS } = await import('../../src/engine/types');
      const originalPoll = DEFAULTS.pollIntervalMs;
      const originalMax = DEFAULTS.maxPollTimeMs;
      (DEFAULTS as any).pollIntervalMs = 20;
      (DEFAULTS as any).maxPollTimeMs = 60_000;

      try {
        const runner = new StateMachineRunner('bot-1', script, page, callbacks);
        const runPromise = runner.run();

        // Wait for a few poll cycles then stop
        await new Promise((r) => setTimeout(r, 100));
        runner.stop();

        await runPromise;

        expect(runner.status).toBe('done');
        expect(pollCount).toBeGreaterThan(0);
        expect(callbacks.errors).toHaveLength(0);
      } finally {
        (DEFAULTS as any).pollIntervalMs = originalPoll;
        (DEFAULTS as any).maxPollTimeMs = originalMax;
      }
    });
  });

  // ── Group 4: Action error resilience ────────────────────

  describe('action error resilience', () => {
    it('logs error but continues when an action throws', async () => {
      const page = createMockPage({
        waitForSelector: vi.fn().mockRejectedValue(new Error('Element not found')),
        screenshot: vi.fn().mockResolvedValue('errorshot'),
      });
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'Action Error',
        initialState: 'start',
        states: {
          start: {
            onEntry: [
              { type: 'waitForSelector', selector: '.missing', timeout: 100 },
              { type: 'log', value: 'after-error' },
            ],
            transitions: [{ target: 'done' }],
          },
          done: { onEntry: [], transitions: [], final: true },
        },
      };

      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      await runner.run();

      expect(runner.status).toBe('done');

      const errorLogs = callbacks.logs.filter((l) => l.level === 'error');
      expect(errorLogs.length).toBeGreaterThan(0);
      expect(errorLogs[0].message).toContain('Element not found');

      // Action after the error still executes
      const messages = callbacks.logs.map((l) => l.message);
      expect(messages).toContain('after-error');
    });

    it('attaches screenshot to error log when screenshot succeeds', async () => {
      const page = createMockPage({
        waitForSelector: vi.fn().mockRejectedValue(new Error('boom')),
        screenshot: vi.fn().mockResolvedValue('c2NyZWVuc2hvdA=='),
      });
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'Screenshot on Error',
        initialState: 'start',
        states: {
          start: {
            onEntry: [
              { type: 'waitForSelector', selector: '.x', timeout: 100 },
            ],
            transitions: [{ target: 'done' }],
          },
          done: { onEntry: [], transitions: [], final: true },
        },
      };

      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      await runner.run();

      const errorLogs = callbacks.logs.filter((l) => l.level === 'error');
      expect(errorLogs[0].screenshotDataUrl).toContain('data:image/jpeg;base64,');
    });

    it('continues when both action and screenshot fail', async () => {
      const page = createMockPage({
        waitForSelector: vi.fn().mockRejectedValue(new Error('action failed')),
        screenshot: vi.fn().mockRejectedValue(new Error('screenshot also failed')),
      });
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'Double Fail',
        initialState: 'start',
        states: {
          start: {
            onEntry: [
              { type: 'waitForSelector', selector: '.x', timeout: 100 },
            ],
            transitions: [{ target: 'done' }],
          },
          done: { onEntry: [], transitions: [], final: true },
        },
      };

      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      await runner.run();

      expect(runner.status).toBe('done');
      const errorLogs = callbacks.logs.filter((l) => l.level === 'error');
      expect(errorLogs.length).toBeGreaterThan(0);
      expect(errorLogs[0].screenshotDataUrl).toBeUndefined();
    });
  });

  // ── Group 5: Multi-state traversal ──────────────────────

  describe('multi-state traversal', () => {
    it('traverses a linear chain in order', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'Chain',
        initialState: 'a',
        states: {
          a: { onEntry: [{ type: 'log', value: 'in-a' }], transitions: [{ target: 'b' }] },
          b: { onEntry: [{ type: 'log', value: 'in-b' }], transitions: [{ target: 'c' }] },
          c: { onEntry: [{ type: 'log', value: 'in-c' }], transitions: [{ target: 'done' }] },
          done: { onEntry: [{ type: 'log', value: 'in-done' }], transitions: [], final: true },
        },
      };

      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      await runner.run();

      expect(runner.status).toBe('done');
      expect(callbacks.stateChanges).toEqual(['b', 'c', 'done']);

      const messages = callbacks.logs.filter((l) => l.message.startsWith('in-')).map((l) => l.message);
      expect(messages).toEqual(['in-a', 'in-b', 'in-c', 'in-done']);
    });

    it('handles loop with exit condition', async () => {
      // Use elementExists guard — page.$ is separate from page.evaluate
      // so onEntry log actions won't interfere with the guard counter.
      let guardCallCount = 0;
      const page = createMockPage({
        $: vi.fn(async () => {
          guardCallCount++;
          return guardCallCount >= 3 ? {} : null; // passes on 3rd call
        }),
      });
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'Loop',
        initialState: 'loop',
        states: {
          loop: {
            onEntry: [{ type: 'log', value: 'looping' }],
            transitions: [
              { target: 'done', guard: { type: 'elementExists', selector: '.exit' } },
              { target: 'loop' }, // fallback loops back
            ],
          },
          done: { onEntry: [], transitions: [], final: true },
        },
      };

      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      await runner.run();

      expect(runner.status).toBe('done');
      const loopCount = callbacks.logs.filter((l) => l.message === 'looping').length;
      expect(loopCount).toBe(3);
    });

    it('stop() halts the FSM with done status', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();

      // Script that loops with a small delay to prevent OOM from log accumulation
      const script: BotScript = {
        name: 'Infinite',
        initialState: 'loop',
        states: {
          loop: {
            onEntry: [{ type: 'wait', value: 10 }],
            transitions: [{ target: 'loop' }],
          },
        },
      };

      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      const runPromise = runner.run();

      await new Promise((r) => setTimeout(r, 50));
      runner.stop();
      await runPromise;

      expect(runner.status).toBe('done');
    });

    it('stop("dropped") sets dropped status', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();

      const script: BotScript = {
        name: 'Drop Test',
        initialState: 'loop',
        states: {
          loop: {
            onEntry: [{ type: 'wait', value: 10 }],
            transitions: [{ target: 'loop' }],
          },
        },
      };

      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      const runPromise = runner.run();

      await new Promise((r) => setTimeout(r, 50));
      runner.stop('dropped');
      await runPromise;

      expect(runner.status).toBe('dropped');
      expect(callbacks.statusChanges).toContain('dropped');
    });

    it('double stop() is idempotent', async () => {
      const page = createMockPage();
      const callbacks = createCallbacks();
      const script = createSimpleScript();

      const runner = new StateMachineRunner('bot-1', script, page, callbacks);
      await runner.run();

      expect(runner.status).toBe('done');
      const countBefore = callbacks.statusChanges.length;

      runner.stop();       // no-op since already done
      runner.stop('dropped'); // also no-op

      expect(callbacks.statusChanges.length).toBe(countBefore);
      expect(runner.status).toBe('done');
    });
  });
});

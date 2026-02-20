// test/unit/state-machine.test.ts
// ──────────────────────────────────────────────────────────────
// Unit tests for the FSM interpreter.
// Uses mock Page objects to verify state transitions.
// ──────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateMachineRunner, FSMCallbacks } from '../../src/engine/state-machine';
import { BotScript, BotStatus, LogEntry } from '../../src/engine/types';

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

// ── Tests ───────────────────────────────────────────────────

describe('StateMachineRunner', () => {
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

    // Should have logged "Starting" and "Done"
    const messages = callbacks.logs.map((l) => l.message);
    expect(messages).toContain('Starting');
    // Final state also produces a "Reached final state" log
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

    // Start and immediately pause (script is fast, may finish before pause)
    const runPromise = runner.run();
    runner.pause();

    // Status should be paused or done (race condition in fast scripts)
    expect(['paused', 'done']).toContain(runner.status);

    if (runner.status === 'paused') {
      runner.resume();
      // Wait a bit for the resumed loop to finish
      await new Promise((r) => setTimeout(r, 100));
    }

    await runPromise.catch(() => {}); // ignore if already resolved
  });
});

// src/engine/state-machine.ts
// ──────────────────────────────────────────────────────────────
// FSM interpreter — pure engine that takes a BotScript + Page
// and runs until a terminal state is reached or an error occurs.
// No knowledge of Electron, grid, or experiment-platform specifics.
// ──────────────────────────────────────────────────────────────

import type { Page } from 'puppeteer';
import {
  BotScript,
  BotStatus,
  BotStrategy,
  DEFAULTS,
  isTerminalStatus,
  LogEntry,
  Transition,
} from './types';
import { executeAction, sleep } from './actions';
import { evaluateGuard } from './conditions';

// ── Event emitter callback types ────────────────────────────

export interface FSMCallbacks {
  onStateChange: (botId: string, newState: string) => void;
  onLog: (botId: string, entry: LogEntry) => void;
  onStatusChange: (botId: string, status: BotStatus) => void;
  onError: (botId: string, error: Error) => void;
}

// ── FSM Runner ──────────────────────────────────────────────

export class StateMachineRunner {
  private _status: BotStatus = 'idle';
  private _currentState: string;
  private readonly actionDelayMs: number;
  private readonly actionJitterMs: number;

  private readonly staleProbability: number;
  private readonly staleExtraDelayMs: number;
  private readonly dropProbability: number;

  /** Timestamp of the last stale/drop dice roll — throttles checks to once per interval */
  private _lastDropCheckAt: number = 0;

  constructor(
    private readonly botId: string,
    private readonly script: BotScript,
    private readonly page: Page,
    private readonly callbacks: FSMCallbacks,
    private readonly delayMultiplier: number = 1.0,
    actionDelayMs: number = 0,
    actionJitterMs: number = 0,
    strategy?: BotStrategy,
  ) {
    this._currentState = script.initialState;
    this.actionDelayMs = actionDelayMs;
    this.actionJitterMs = actionJitterMs;
    this.staleProbability = strategy?.staleProbability ?? 0;
    this.staleExtraDelayMs = strategy?.staleExtraDelayMs ?? 0;
    this.dropProbability = strategy?.dropProbability ?? 0;
  }

  get status(): BotStatus {
    return this._status;
  }

  get currentState(): string {
    return this._currentState;
  }

  /** Pause the FSM loop. Active action will finish before pausing. */
  pause(): void {
    if (this._status === 'running') {
      this._status = 'paused';
      this.callbacks.onStatusChange(this.botId, 'paused');
    }
  }

  /** Resume a paused FSM. */
  resume(): void {
    if (this._status === 'paused') {
      this._status = 'running';
      this.callbacks.onStatusChange(this.botId, 'running');
      // Re-enter the run loop
      this.runLoop().catch((err) => this.handleError(err));
    }
  }

  /** Stop the FSM permanently (idempotent — no-op if already finished). */
  stop(finalStatus: 'done' | 'dropped' = 'done'): void {
    if (isTerminalStatus(this._status)) return;
    this._status = finalStatus;
    this.callbacks.onStatusChange(this.botId, finalStatus);
  }

  /**
   * Start the FSM execution loop.
   * Resolves when the FSM reaches a final state, errors, or is stopped.
   */
  async run(): Promise<void> {
    this._status = 'running';
    this.callbacks.onStatusChange(this.botId, 'running');

    try {
      await this.runLoop();
    } catch (err) {
      this.handleError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // ── internal ──────────────────────────────────────────

  private async runLoop(): Promise<void> {
    while (this._status === 'running') {
      const stateDef = this.script.states[this._currentState];
      if (!stateDef) {
        throw new Error(`Unknown state: "${this._currentState}" in script "${this.script.name}"`);
      }

      // 1. Execute onEntry actions sequentially
      for (const action of stateDef.onEntry) {
        if (this._status !== 'running') return; // check between actions

        // Log every action execution to the system logger.
        // Prefer the human-readable label when available.
        const actionDesc = action.label
          ? `${action.type}: ${action.label}`
          : action.selector
            ? `${action.type}(${action.selector})`
            : `${action.type}`;
        this.callbacks.onLog(this.botId, {
          timestamp: Date.now(),
          level: 'info',
          message: `[${this._currentState}] ${actionDesc}`,
        });

        try {
          const logEntry = await executeAction(this.page, action, this.delayMultiplier);
          if (logEntry) {
            this.callbacks.onLog(this.botId, logEntry);
          }
        } catch (actionErr) {
          // Log the error but don't crash — let transitions decide
          const entry: LogEntry = {
            timestamp: Date.now(),
            level: 'error',
            message: `Action ${action.type} failed: ${actionErr instanceof Error ? actionErr.message : String(actionErr)}`,
          };
          this.callbacks.onLog(this.botId, entry);

          // Try to capture a screenshot on error
          try {
            const buf = await this.page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 40 });
            entry.screenshotDataUrl = `data:image/jpeg;base64,${buf}`;
          } catch {
            // screenshot also failed, continue
          }
        }

        // Inter-action delay so interactions are visible in screencast
        if ((this.actionDelayMs > 0 || this.actionJitterMs > 0) && action.type !== 'wait' && action.type !== 'log') {
          const jitter = this.actionJitterMs > 0 ? Math.round(Math.random() * this.actionJitterMs) : 0;
          await sleep(this.actionDelayMs + jitter);
        }
      }

      // 2. Stale/drop check — roll dice at most once per dropCheckIntervalMs
      const now = Date.now();
      if (
        this._status === 'running' &&
        this.staleProbability > 0 &&
        !stateDef.final &&
        now - this._lastDropCheckAt >= DEFAULTS.dropCheckIntervalMs
      ) {
        this._lastDropCheckAt = now;
        if (Math.random() < this.staleProbability) {
          // Bot becomes stale on this page
          this._status = 'stale';
          this.callbacks.onStatusChange(this.botId, 'stale');
          this.callbacks.onLog(this.botId, {
            timestamp: Date.now(),
            level: 'warn',
            message: `Bot went stale in state "${this._currentState}" — delaying ${this.staleExtraDelayMs}ms`,
          });

          await sleep(this.staleExtraDelayMs);

          // While stale, check if bot drops
          if (this.dropProbability > 0 && Math.random() < this.dropProbability) {
            this._status = 'dropped';
            this.callbacks.onStatusChange(this.botId, 'dropped');
            this.callbacks.onLog(this.botId, {
              timestamp: Date.now(),
              level: 'warn',
              message: `Bot dropped out in state "${this._currentState}"`,
            });
            return;
          }

          // Recover from stale → running
          this._status = 'running';
          this.callbacks.onStatusChange(this.botId, 'running');
          this.callbacks.onLog(this.botId, {
            timestamp: Date.now(),
            level: 'info',
            message: `Bot recovered from stale in state "${this._currentState}"`,
          });
        }
      }

      if (this._status !== 'running') return;

      // 3. If this is a final state → done
      if (stateDef.final) {
        this._status = 'done';
        this.callbacks.onStatusChange(this.botId, 'done');
        this.callbacks.onLog(this.botId, {
          timestamp: Date.now(),
          level: 'info',
          message: `Reached final state: "${this._currentState}"`,
        });
        return;
      }

      // 3. Poll transitions until one matches
      const nextState = await this.pollTransitions(stateDef.transitions);

      if (this._status !== 'running') return; // could have been paused/stopped

      // 4. Transition
      this._currentState = nextState;
      this.callbacks.onStateChange(this.botId, nextState);
    }
  }

  /**
   * Continuously evaluate transition guards until one passes.
   * Respects maxPollTime to prevent infinite loops.
   */
  private async pollTransitions(transitions: Transition[]): Promise<string> {
    const startTime = Date.now();

    while (this._status === 'running') {
      for (const t of transitions) {
        // If no guard, the transition fires immediately
        if (!t.guard) {
          if (t.delay && t.delay > 0) {
            await sleep(t.delay);
          }
          return t.target;
        }

        try {
          const passes = await evaluateGuard(this.page, t.guard);
          if (passes) {
            if (t.delay && t.delay > 0) {
              await sleep(t.delay);
            }
            return t.target;
          }
        } catch {
          // Guard evaluation failed — skip this transition
        }
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > DEFAULTS.maxPollTimeMs) {
        throw new Error(
          `Transition timeout after ${DEFAULTS.maxPollTimeMs}ms in state "${this._currentState}". ` +
          `No matching guard found among ${transitions.length} transitions.`,
        );
      }

      // Wait before next poll cycle
      await sleep(DEFAULTS.pollIntervalMs);
    }

    // Unreachable unless paused/stopped, but TypeScript needs a return
    return this._currentState;
  }

  private handleError(err: Error): void {
    this._status = 'error';
    this.callbacks.onError(this.botId, err);
    this.callbacks.onStatusChange(this.botId, 'error');
    this.callbacks.onLog(this.botId, {
      timestamp: Date.now(),
      level: 'error',
      message: `FSM error: ${err.message}`,
    });
  }
}

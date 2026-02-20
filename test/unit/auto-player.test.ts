import { describe, expect, it } from 'vitest';
import { createAutoPlayer } from '../../src/scripts/auto-player';

describe('createAutoPlayer terminal detection', () => {
  it('adds terminal-page detection to waitForPage', () => {
    const script = createAutoPlayer();
    const transitions = script.states.waitForPage.transitions;

    const terminalTransition = transitions.find((t) =>
      t.target === 'done' && t.guard?.type === 'custom',
    );

    expect(terminalTransition).toBeDefined();
    expect(terminalTransition?.guard?.fn).toContain('end of study');
    expect(terminalTransition?.guard?.fn).toContain('your response has been recorded');
  });

  it('adds terminal-page detection to wait-like click states', () => {
    const script = createAutoPlayer();

    for (const stateId of ['handleWaitPage', 'queueNextRound', 'clickNext'] as const) {
      const transitions = script.states[stateId].transitions;
      const terminalTransition = transitions.find((t) =>
        t.target === 'done' && t.guard?.type === 'custom',
      );
      expect(terminalTransition, `missing terminal guard in ${stateId}`).toBeDefined();
    }
  });

  it('adds wait-page nudge and stuck-ready recovery', () => {
    const script = createAutoPlayer();
    const waitEntry = script.states.handleWaitPage.onEntry;
    const hasNudgeEval = waitEntry.some((a) =>
      a.type === 'evaluate' && typeof a.value === 'string' && a.value.includes('waitForRedirect'),
    );
    expect(hasNudgeEval).toBe(true);

    const transitions = script.states.handleWaitPage.transitions;
    const recoveryTransition = transitions.find((t) => t.target === 'recoverWaitPage');
    expect(recoveryTransition?.guard?.type).toBe('custom');
    expect(recoveryTransition?.guard?.fn).toContain('participants ready');
    expect(recoveryTransition?.guard?.fn).toContain('__otb_wait_recovered_urls');
    const staleRecoveryTransition = transitions.find((t) => t.target === 'recoverWaitPageStale');
    expect(staleRecoveryTransition?.guard?.type).toBe('custom');
    expect(staleRecoveryTransition?.guard?.fn).toContain('__otb_wait_progress_state');

    expect(script.states.recoverWaitPage).toBeDefined();
    const recoverEntry = script.states.recoverWaitPage.onEntry;
    const hasRecoveryMarker = recoverEntry.some((a) =>
      a.type === 'evaluate' && typeof a.value === 'string' && a.value.includes('__otb_wait_recovered_urls'),
    );
    expect(hasRecoveryMarker).toBe(true);

    expect(script.states.recoverWaitPageStale).toBeDefined();
    const staleRecoverEntry = script.states.recoverWaitPageStale.onEntry;
    const hasStaleRecoveryMarker = staleRecoverEntry.some((a) =>
      a.type === 'evaluate' && typeof a.value === 'string' && a.value.includes('__otb_wait_progress_state'),
    );
    expect(hasStaleRecoveryMarker).toBe(true);
  });
});

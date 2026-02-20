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
});

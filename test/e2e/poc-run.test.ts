// test/e2e/poc-run.test.ts
// ──────────────────────────────────────────────────────────────
// End-to-end test placeholder.
// Requires a running oTree server to execute.
//
// To run:
//   1. Start oTree dev server: `otree devserver`
//   2. Create a session and get the session-wide link
//   3. Set OTREE_URL env var
//   4. Run: `npx vitest run test/e2e/`
// ──────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

describe('PoC End-to-End Run', () => {
  it.skip('should complete a 2-player session (requires live oTree server)', async () => {
    const url = process.env.OTREE_URL;
    if (!url) {
      console.warn('Skipping E2E test: set OTREE_URL env var');
      return;
    }

    // This test would:
    // 1. Launch the electron app programmatically
    // 2. Wait for all bots to reach 'done' status
    // 3. Assert no errors
    //
    // Implementation deferred to Phase 2.

    expect(url).toBeTruthy();
  });
});

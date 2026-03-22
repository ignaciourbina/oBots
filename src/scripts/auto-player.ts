// src/scripts/auto-player.ts
// ──────────────────────────────────────────────────────────────
// Game-agnostic auto-player — factory that generates a
// BotScript from a BotStrategy configuration.
//
// The generated script works with ANY standard behavioral experiment:
//   1. Detects page type (WaitPage, form page, results page)
//   2. Fills form fields using the chosen strategy
//   3. Clicks submit / next
//   4. Handles WaitPages (poll until advanced)
//   5. Loops until OutOfRangeNotification (game over)
//
// The strategy controls HOW each field type is filled, making
// the behaviour fully configurable without game-specific code.
// ──────────────────────────────────────────────────────────────

import { BotScript, BotStrategy, DEFAULT_STRATEGY } from '../engine/types';

// ── WaitPage detection guard (shared) ───────────────────────

const WAIT_PAGE_GUARD = `(() => {
  const text = (document.body?.innerText || '').toLowerCase();
  const hasWaitText = text.includes('please wait') && text.includes('participants ready');
  const hasWaitScript = Array.from(document.scripts || []).some((s) =>
    /waitforredirect|is_wait_page/i.test(s.textContent || '')
  );

  return !!(
    document.querySelector('.otree-wait-page') ||
    document.querySelector('[data-wait-page]') ||
    hasWaitScript ||
    hasWaitText
  );
})()`;

const EXIT_WAIT_PAGE_GUARD = `(() => {
  const text = (document.body?.innerText || '').toLowerCase();
  const hasWaitText = text.includes('please wait') && text.includes('participants ready');
  const hasWaitScript = Array.from(document.scripts || []).some((s) =>
    /waitforredirect|is_wait_page/i.test(s.textContent || '')
  );
  const isWaitPage = !!(
    document.querySelector('.otree-wait-page') ||
    document.querySelector('[data-wait-page]') ||
    hasWaitScript ||
    hasWaitText
  );
  return !isWaitPage;
})()`;

const WAIT_PAGE_STORAGE_HELPERS = `
  const storage = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })();
  const readJson = (key, fallback) => {
    if (!storage) return fallback;
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const readNumber = (key, fallback = 0) => {
    if (!storage) return fallback;
    try {
      const raw = storage.getItem(key);
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  };
  const writeValue = (key, value) => {
    if (!storage) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };
  const removeValue = (key) => {
    if (!storage) return false;
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  };
`;

const WAIT_PAGE_STUCK_READY_GUARD = `(() => {
  ${WAIT_PAGE_STORAGE_HELPERS}
  if (!storage) return false;
  const urlKey = window.location.pathname + window.location.search;
  const recoveredKey = '__otb_wait_recovered_urls';
  const text = (document.body?.innerText || '').toLowerCase();
  const match = text.match(/(\\d+)\\s*\\/\\s*(\\d+)\\s*participants\\s+ready/);
  const key = '__otb_wait_ready_since:' + urlKey;
  const now = Date.now();

  const recovered = readJson(recoveredKey, {});

  // Cooldown: at most one forced recovery per wait-page URL.
  if (recovered[urlKey]) {
    removeValue(key);
    return false;
  }

  if (!match) {
    removeValue(key);
    return false;
  }

  const ready = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(ready) || !Number.isFinite(total) || total <= 0 || ready < total) {
    removeValue(key);
    return false;
  }

  const since = readNumber(key, 0);
  if (!since) {
    writeValue(key, String(now));
    return false;
  }

  return (now - since) > 12_000;
})()`;

const CLEAR_WAIT_PAGE_MARKERS = `(() => {
  ${WAIT_PAGE_STORAGE_HELPERS}
  const urlKey = window.location.pathname + window.location.search;
  removeValue('__otb_wait_ready_since:' + urlKey);
  removeValue('__otb_wait_progress_state:' + urlKey);
  const w = window;
  if (w.__otbWaitNudgeTimer) {
    clearInterval(w.__otbWaitNudgeTimer);
    w.__otbWaitNudgeTimer = null;
  }
})()`;

const MARK_WAIT_PAGE_RECOVERY = `(() => {
  ${WAIT_PAGE_STORAGE_HELPERS}
  if (!storage) return;
  const urlKey = window.location.pathname + window.location.search;
  const recoveredKey = '__otb_wait_recovered_urls';
  const recovered = readJson(recoveredKey, {});
  recovered[urlKey] = Date.now();
  writeValue(recoveredKey, JSON.stringify(recovered));
  removeValue('__otb_wait_ready_since:' + urlKey);
})()`;

const WAIT_PAGE_STALE_PROGRESS_GUARD = `(() => {
  ${WAIT_PAGE_STORAGE_HELPERS}
  if (!storage) return false;
  const urlKey = window.location.pathname + window.location.search;
  const stateKey = '__otb_wait_progress_state:' + urlKey;
  const text = (document.body?.innerText || '').toLowerCase();
  const match = text.match(/(\\d+)\\s*\\/\\s*(\\d+)\\s*participants\\s+ready/);
  const now = Date.now();

  if (!match) {
    removeValue(stateKey);
    return false;
  }

  const ready = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(ready) || !Number.isFinite(total) || total <= 0) {
    removeValue(stateKey);
    return false;
  }

  const ratio = ready + '/' + total;
  const state = readJson(stateKey, null);

  if (!state || state.ratio !== ratio) {
    writeValue(stateKey, JSON.stringify({
      ratio,
      since: now,
      lastReload: state?.lastReload || 0,
      reloads: state?.reloads || 0,
    }));
    return false;
  }

  const since = Number(state.since || now);
  const lastReload = Number(state.lastReload || 0);
  const reloads = Number(state.reloads || 0);

  // If readiness ratio is unchanged for a while, do a bounded refresh.
  // Cooldowns reduce websocket churn from repeated reconnects.
  const unchangedTooLong = (now - since) > 25_000;
  const cooldownPassed = (now - lastReload) > 25_000;
  const belowReloadCap = reloads < 3;

  return unchangedTooLong && cooldownPassed && belowReloadCap;
})()`;

const MARK_WAIT_PAGE_STALE_RECOVERY = `(() => {
  ${WAIT_PAGE_STORAGE_HELPERS}
  if (!storage) return;
  const urlKey = window.location.pathname + window.location.search;
  const stateKey = '__otb_wait_progress_state:' + urlKey;
  const text = (document.body?.innerText || '').toLowerCase();
  const match = text.match(/(\\d+)\\s*\\/\\s*(\\d+)\\s*participants\\s+ready/);
  const now = Date.now();

  const ratio = match ? (Number(match[1]) + '/' + Number(match[2])) : 'unknown';
  const state = readJson(stateKey, null);

  writeValue(stateKey, JSON.stringify({
    ratio: state?.ratio || ratio,
    since: now,
    lastReload: now,
    reloads: Number(state?.reloads || 0) + 1,
  }));
})()`;

const WAIT_PAGE_NUDGE_ACTION = `(() => {
  const w = window;
  const call = (name) => {
    const fn = w[name];
    if (typeof fn !== 'function') return false;
    try {
      fn.call(w);
      return true;
    } catch {
      return false;
    }
  };

  // Wait pages often rely on JS polling loops; call known hooks directly.
  const tick = () => {
    call('waitForRedirect');
    call('wait_for_redirect');
    call('checkWaitPage');
    call('check_wait_page');
    call('sendPing');
  };

  tick();
  if (!w.__otbWaitNudgeTimer) {
    w.__otbWaitNudgeTimer = setInterval(tick, 1000);
  }
})()`;

// ── Queue / next-round detection guard ──────────────────────

const QUEUE_NEXT_ROUND_GUARD = `(() => {
  const candidates = Array.from(document.querySelectorAll(
    'button.otree-btn-next, .btn-primary, button[type="submit"], button'
  ));
  return candidates.some((el) => {
    const text = (el.textContent || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const cls = (el.className || '').toLowerCase();
    const marker = [text, title, id, cls].join(' ');
    return marker.includes('queue')
      || marker.includes('next round')
      || marker.includes('continue');
  });
})()`;

// ── Form fields detection guard ─────────────────────────────

const HAS_FORM_FIELDS_GUARD = `(() => {
  const inputs = document.querySelectorAll(
    'input[type="number"], input[type="text"]:not([readonly]), select, input[type="radio"], input[type="checkbox"], textarea'
  );
  return inputs.length > 0;
})()`;

// ── Named-button form detection guard ───────────────────────
// Detects decision pages that use <button name="field" value="x">
// (e.g. "I choose Choice A / Choice B") instead of <input type="radio">.
// These buttons set the field value AND submit the form when clicked.

const HAS_NAMED_BUTTONS_GUARD = `(() => {
  const buttons = document.querySelectorAll('button[name]:not(.otree-btn-next)');
  return Array.from(buttons).some((el) => {
    const btn = el;
    return btn.name && btn.name !== '' && !btn.disabled;
  });
})()`;

// ── Terminal-page detection guard ───────────────────────────

const TERMINAL_PAGE_GUARD = `(() => {
  const isVisible = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return el.getClientRects().length > 0;
  };

  const url = window.location.href.toLowerCase();
  if (url.includes('outofrangenotification')) {
    return true;
  }

  const title = (document.title || '').toLowerCase();
  const text = (document.body?.innerText || '').toLowerCase();

  const terminalMarkers = [
    'end of study',
    'your response has been recorded',
    'thank you for your time',
    'study is complete',
    'you have completed',
    'thanks for participating',
    'completion code',
    'prolific'
  ];

  const hasTerminalMarker = terminalMarkers.some((m) =>
    title.includes(m) || text.includes(m)
  );

  if (!hasTerminalMarker) {
    return false;
  }

  const visibleActionButtons = Array.from(
    document.querySelectorAll('button.otree-btn-next, button[type="submit"], .btn-primary')
  ).filter((el) => {
    const btn = el;
    return isVisible(btn) && !btn.disabled;
  });

  const visibleEditableControls = Array.from(
    document.querySelectorAll('input:not([type="hidden"]), select, textarea')
  ).filter((el) => {
    const control = el;
    if (!isVisible(control)) return false;
    if (control.hasAttribute('readonly')) return false;
    if (control.hasAttribute('disabled')) return false;
    return true;
  });

  const waitText = (document.body?.innerText || '').toLowerCase();
  const waitScript = Array.from(document.scripts || []).some((s) =>
    /waitforredirect|is_wait_page/i.test(s.textContent || '')
  );
  const isWaitPage = !!(
    document.querySelector('.otree-wait-page') ||
    document.querySelector('[data-wait-page]') ||
    waitScript ||
    (waitText.includes('please wait') && waitText.includes('participants ready'))
  );

  return visibleActionButtons.length === 0
    && visibleEditableControls.length === 0
    && !isWaitPage;
})()`;

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a game-agnostic BotScript configured with the given strategy.
 * Works with any standard behavioral experiment.
 */
export function createAutoPlayer(strategy: BotStrategy = DEFAULT_STRATEGY): BotScript {
  const submitDelayAction = strategy.submitDelay > 0
    ? [{ type: 'wait' as const, value: strategy.submitDelay }]
    : [];

  return {
    name: `Auto-Player (${strategy.name})`,
    initialState: 'navigate',

    states: {
      // ── navigate ────────────────────────────────────────
      navigate: {
        onEntry: [
          { type: 'log', value: `Auto-player starting — strategy: ${strategy.name}` },
        ],
        transitions: [
          {
            target: 'waitForPage',
            guard: { type: 'urlContains', value: '/' },
          },
        ],
      },

      // ── waitForPage ─────────────────────────────────────
      waitForPage: {
        onEntry: [
          { type: 'evaluate', value: CLEAR_WAIT_PAGE_MARKERS },
          { type: 'waitForSelector', selector: 'body', timeout: 10000 },
          { type: 'log', value: 'Page loaded.' },
          { type: 'wait', value: 50 },
        ],
        transitions: [
          // Game over
          {
            target: 'done',
            guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
          },
          // Terminal pages without OutOfRangeNotification URL
          {
            target: 'done',
            guard: { type: 'custom', fn: TERMINAL_PAGE_GUARD },
          },
          // WaitPage
          {
            target: 'handleWaitPage',
            guard: { type: 'custom', fn: WAIT_PAGE_GUARD },
          },
          // Queue for next round
          {
            target: 'queueNextRound',
            guard: { type: 'custom', fn: QUEUE_NEXT_ROUND_GUARD },
          },
          // StudyOverview PC-selector widget — needs a custom multi-step
          // interaction (open grid → click PC button → click Next → confirm modal).
          {
            target: 'handlePCSelector',
            guard: { type: 'elementExists', selector: '#pc-grid-trigger' },
          },
          // named-button decision pages (e.g. <button name="cooperate" value="True">)
          // Must be checked before fillAndSubmit — named buttons act as both
          // the field input and the form submit, so no separate submit click is needed.
          {
            target: 'clickNamedButton',
            guard: { type: 'custom', fn: HAS_NAMED_BUTTONS_GUARD },
          },
          // Form page — fill fields
          {
            target: 'fillAndSubmit',
            guard: { type: 'custom', fn: HAS_FORM_FIELDS_GUARD },
          },
          // Submit button only (results page, etc.)
          {
            target: 'clickNext',
            guard: {
              type: 'elementExists',
              selector: 'button.otree-btn-next, .btn-primary, button[type="submit"]',
            },
          },
          // Fallback — poll again
          { target: 'waitForPage', delay: 500 },
        ],
      },

      // ── handleWaitPage ──────────────────────────────────
      // Do NOT reload — WaitPages use built-in JS polling
      // (waitForRedirect) that auto-redirects when the group is ready.
      // Reloading destroys that JS context and causes missed redirects.
      handleWaitPage: {
        onEntry: [
          { type: 'log', value: 'Detected WaitPage — waiting for other players…' },
          { type: 'evaluate', value: WAIT_PAGE_NUDGE_ACTION },
          { type: 'wait', value: 3000 },
        ],
        transitions: [
          {
            target: 'done',
            guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
          },
          {
            target: 'done',
            guard: { type: 'custom', fn: TERMINAL_PAGE_GUARD },
          },
          // experiment JS auto-redirected us — no longer on a WaitPage
          {
            target: 'waitForPage',
            guard: {
              type: 'custom',
              fn: EXIT_WAIT_PAGE_GUARD,
            },
          },
          // Full group is ready but the wait page didn't auto-redirect.
          // Do a controlled refresh to rebind the experiment's wait-page polling.
          {
            target: 'recoverWaitPage',
            guard: {
              type: 'custom',
              fn: WAIT_PAGE_STUCK_READY_GUARD,
            },
          },
          // Readiness ratio did not move for too long. Reconnect once in a while
          // to refresh wait-page state and websocket/session linkage.
          {
            target: 'recoverWaitPageStale',
            guard: {
              type: 'custom',
              fn: WAIT_PAGE_STALE_PROGRESS_GUARD,
            },
          },
          // Still on wait page — loop and keep waiting
          { target: 'handleWaitPage' },
        ],
      },

      // ── recoverWaitPage ───────────────────────────────
      recoverWaitPage: {
        onEntry: [
          { type: 'log', value: 'WaitPage appears stuck at full readiness — refreshing once.' },
          { type: 'evaluate', value: MARK_WAIT_PAGE_RECOVERY },
          { type: 'reload', timeout: 10000 },
          { type: 'wait', value: 1200 },
        ],
        transitions: [
          {
            target: 'waitForPage',
            guard: { type: 'elementExists', selector: 'body' },
          },
        ],
      },

      // ── recoverWaitPageStale ───────────────────────────
      recoverWaitPageStale: {
        onEntry: [
          { type: 'log', value: 'WaitPage readiness unchanged for 25s — refreshing to resync.' },
          { type: 'evaluate', value: MARK_WAIT_PAGE_STALE_RECOVERY },
          { type: 'reload', timeout: 10000 },
          { type: 'wait', value: 1200 },
        ],
        transitions: [
          {
            target: 'waitForPage',
            guard: { type: 'elementExists', selector: 'body' },
          },
        ],
      },

      // ── queueNextRound ──────────────────────────────────
      queueNextRound: {
        onEntry: [
          { type: 'log', value: 'Queueing for next round...' },
          {
            type: 'clickAndNavigate',
            selector: 'button.otree-btn-next, .btn-primary, button[type="submit"]',
            timeout: 5000,
          },
          { type: 'wait', value: 200 },
        ],
        transitions: [
          {
            target: 'done',
            guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
          },
          {
            target: 'done',
            guard: { type: 'custom', fn: TERMINAL_PAGE_GUARD },
          },
          {
            target: 'waitForPage',
            guard: { type: 'elementExists', selector: 'body' },
            delay: 200,
          },
        ],
      },

      // ── clickNamedButton ────────────────────────────────
      // Handles pages where the decision is expressed as
      //   <button name="field" value="x">Label</button>
      // Clicking one of these buttons both sets the field value and
      // submits the form, so no separate "clickNext" step is needed.
      clickNamedButton: {
        onEntry: [
          { type: 'log', value: `Clicking named form button (${strategy.name} strategy)...` },
          { type: 'clickNamedFormButton', strategyConfig: strategy },
          { type: 'wait', value: 200 },
        ],
        transitions: [
          {
            target: 'done',
            guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
          },
          {
            target: 'done',
            guard: { type: 'custom', fn: TERMINAL_PAGE_GUARD },
          },
          {
            target: 'waitForPage',
            guard: { type: 'elementExists', selector: 'body' },
            delay: 200,
          },
        ],
      },

      // ── handlePCSelector ─────────────────────────────────
      // Custom handler for the StudyOverview "Lab PC Number" widget.
      // Sequence: open grid trigger → wait for async PC buttons →
      //           click a random PC → click Next → confirm modal.
      handlePCSelector: {
        onEntry: [
          { type: 'log', value: 'PC selector detected — running custom handler.' },
          // 1. Click the trigger button to open the grid panel
          { type: 'click', selector: '#pc-grid-trigger' },
          // 2. Wait for grid buttons to load (async fetch), click a random one
          { type: 'evaluate', value: `(async () => {
            for (let i = 0; i < 20; i++) {
              const cells = Array.from(document.querySelectorAll('button.pc-grid-cell'));
              if (cells.length > 0) {
                cells[Math.floor(Math.random() * cells.length)].click();
                return;
              }
              await new Promise(r => setTimeout(r, 250));
            }
          })()` },
          { type: 'wait', value: 500 },
          // 3. Verify the hidden input was populated, then click Next
          { type: 'evaluate', value: `(() => {
            const inp = document.getElementById('id_PC_id_manual_input');
            if (!inp || !inp.value.trim()) return;
            const btn = document.querySelector('button.otree-btn-next') ||
                        document.querySelector('.btn-primary') ||
                        document.querySelector('button[type="submit"]');
            if (btn) btn.click();
          })()` },
          { type: 'wait', value: 1000 },
          // 4. Click confirm in the modal
          { type: 'evaluate', value: `(() => {
            const confirmBtn = document.getElementById('confirmPCConfirm');
            if (confirmBtn) confirmBtn.click();
          })()` },
          { type: 'wait', value: 500 },
          { type: 'log', value: 'PC handler complete.' },
        ],
        transitions: [
          {
            target: 'done',
            guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
          },
          {
            target: 'done',
            guard: { type: 'custom', fn: TERMINAL_PAGE_GUARD },
          },
          {
            target: 'waitForPage',
            guard: { type: 'elementExists', selector: 'body' },
            delay: 200,
          },
        ],
      },

      // ── fillAndSubmit ───────────────────────────────────
      fillAndSubmit: {
        onEntry: [
          { type: 'log', value: `Filling form fields (${strategy.name} strategy)...` },

          // Fill all form fields using visible Puppeteer interactions
          { type: 'fillFormFields', strategyConfig: strategy },

          { type: 'wait', value: 50 },
          { type: 'log', value: 'Form filled.' },

          // Optional submit delay
          ...submitDelayAction,
        ],
        transitions: [
          {
            target: 'clickNext',
            guard: {
              type: 'elementExists',
              selector: 'button.otree-btn-next, .btn-primary, button[type="submit"]',
            },
          },
          // Fallback if submit button not found — re-evaluate page state
          { target: 'waitForPage', delay: 2000 },
        ],
      },

      // ── clickNext ───────────────────────────────────────
      clickNext: {
        onEntry: [
          { type: 'log', value: 'Clicking next...' },
          {
            type: 'clickAndNavigate',
            selector: 'button.otree-btn-next, .btn-primary, button[type="submit"]',
            timeout: 5000,
          },
          { type: 'wait', value: 200 },
        ],
        transitions: [
          {
            target: 'done',
            guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
          },
          {
            target: 'done',
            guard: { type: 'custom', fn: TERMINAL_PAGE_GUARD },
          },
          {
            target: 'waitForPage',
            guard: { type: 'elementExists', selector: 'body' },
            delay: 200,
          },
        ],
      },

      // ── done ────────────────────────────────────────────
      done: {
        onEntry: [
          { type: 'log', value: '✓ Bot finished — game complete.' },
          { type: 'screenshot' },
        ],
        transitions: [],
        final: true,
      },
    },
  };
}

export default createAutoPlayer;

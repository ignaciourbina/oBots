// src/scripts/auto-player.ts
// ──────────────────────────────────────────────────────────────
// Game-agnostic oTree auto-player — factory that generates a
// BotScript from a BotStrategy configuration.
//
// The generated script works with ANY standard oTree game:
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

const WAIT_PAGE_STUCK_READY_GUARD = `(() => {
  const urlKey = window.location.pathname + window.location.search;
  const recoveredKey = '__otb_wait_recovered_urls';
  const text = (document.body?.innerText || '').toLowerCase();
  const match = text.match(/(\\d+)\\s*\\/\\s*(\\d+)\\s*participants\\s+ready/);
  const key = '__otb_wait_ready_since:' + urlKey;
  const now = Date.now();

  let recovered = {};
  try {
    recovered = JSON.parse(sessionStorage.getItem(recoveredKey) || '{}');
  } catch {
    recovered = {};
  }

  // Cooldown: at most one forced recovery per wait-page URL.
  if (recovered[urlKey]) {
    sessionStorage.removeItem(key);
    return false;
  }

  if (!match) {
    sessionStorage.removeItem(key);
    return false;
  }

  const ready = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(ready) || !Number.isFinite(total) || total <= 0 || ready < total) {
    sessionStorage.removeItem(key);
    return false;
  }

  const since = Number(sessionStorage.getItem(key) || 0);
  if (!since) {
    sessionStorage.setItem(key, String(now));
    return false;
  }

  return (now - since) > 12_000;
})()`;

const CLEAR_WAIT_PAGE_MARKERS = `(() => {
  const urlKey = window.location.pathname + window.location.search;
  sessionStorage.removeItem('__otb_wait_ready_since:' + urlKey);
  sessionStorage.removeItem('__otb_wait_progress_state:' + urlKey);
  const w = window;
  if (w.__otbWaitNudgeTimer) {
    clearInterval(w.__otbWaitNudgeTimer);
    w.__otbWaitNudgeTimer = null;
  }
})()`;

const MARK_WAIT_PAGE_RECOVERY = `(() => {
  const urlKey = window.location.pathname + window.location.search;
  const recoveredKey = '__otb_wait_recovered_urls';
  let recovered = {};
  try {
    recovered = JSON.parse(sessionStorage.getItem(recoveredKey) || '{}');
  } catch {
    recovered = {};
  }
  recovered[urlKey] = Date.now();
  sessionStorage.setItem(recoveredKey, JSON.stringify(recovered));
  sessionStorage.removeItem('__otb_wait_ready_since:' + urlKey);
})()`;

const WAIT_PAGE_STALE_PROGRESS_GUARD = `(() => {
  const urlKey = window.location.pathname + window.location.search;
  const stateKey = '__otb_wait_progress_state:' + urlKey;
  const text = (document.body?.innerText || '').toLowerCase();
  const match = text.match(/(\\d+)\\s*\\/\\s*(\\d+)\\s*participants\\s+ready/);
  const now = Date.now();

  if (!match) {
    sessionStorage.removeItem(stateKey);
    return false;
  }

  const ready = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(ready) || !Number.isFinite(total) || total <= 0) {
    sessionStorage.removeItem(stateKey);
    return false;
  }

  const ratio = ready + '/' + total;
  let state = null;
  try {
    state = JSON.parse(sessionStorage.getItem(stateKey) || 'null');
  } catch {
    state = null;
  }

  if (!state || state.ratio !== ratio) {
    sessionStorage.setItem(stateKey, JSON.stringify({
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
  const urlKey = window.location.pathname + window.location.search;
  const stateKey = '__otb_wait_progress_state:' + urlKey;
  const text = (document.body?.innerText || '').toLowerCase();
  const match = text.match(/(\\d+)\\s*\\/\\s*(\\d+)\\s*participants\\s+ready/);
  const now = Date.now();

  const ratio = match ? (Number(match[1]) + '/' + Number(match[2])) : 'unknown';
  let state = null;
  try {
    state = JSON.parse(sessionStorage.getItem(stateKey) || 'null');
  } catch {
    state = null;
  }

  sessionStorage.setItem(stateKey, JSON.stringify({
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

  // oTree wait pages often rely on JS polling loops; call known hooks directly.
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
// Detects oTree decision pages that use <button name="field" value="x">
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
 * Works with any standard oTree experiment.
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
          // oTree named-button decision pages (e.g. <button name="cooperate" value="True">)
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
      // Do NOT reload — oTree WaitPages use built-in JS polling
      // (waitForRedirect) that auto-redirects when the group is ready.
      // Reloading destroys that JS context and causes missed redirects.
      handleWaitPage: {
        onEntry: [
          { type: 'log', value: 'Detected oTree WaitPage — waiting for other players…' },
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
          // oTree JS auto-redirected us — no longer on a WaitPage
          {
            target: 'waitForPage',
            guard: {
              type: 'custom',
              fn: EXIT_WAIT_PAGE_GUARD,
            },
          },
          // Full group is ready but the wait page didn't auto-redirect.
          // Do a controlled refresh to rebind oTree's wait-page polling.
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
      // Handles oTree pages where the decision is expressed as
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

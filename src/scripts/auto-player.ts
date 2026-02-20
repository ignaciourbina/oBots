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
  return !!(
    document.querySelector('.otree-wait-page') ||
    document.querySelector('[data-wait-page]') ||
    (document.querySelector('script') &&
      document.documentElement.innerHTML.includes('waitForRedirect'))
  );
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

  const isWaitPage = !!(
    document.querySelector('.otree-wait-page') ||
    document.querySelector('[data-wait-page]') ||
    document.documentElement.innerHTML.includes('waitForRedirect')
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
              fn: `(() => {
                const isWaitPage = !!(
                  document.querySelector('.otree-wait-page') ||
                  document.querySelector('[data-wait-page]') ||
                  document.documentElement.innerHTML.includes('waitForRedirect')
                );
                return !isWaitPage;
              })()`,
            },
          },
          // Still on wait page — loop and keep waiting
          { target: 'handleWaitPage' },
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

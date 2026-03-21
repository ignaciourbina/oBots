// src/scripts/poc-bot.ts
// ──────────────────────────────────────────────────────────────
// Proof-of-Concept bot script.
//
// This is a generic auto-player that:
//   1. Navigates to the join link (handled by BotRunner)
//   2. Waits for the page to load
//   3. Fills form fields with sensible defaults
//   4. Clicks the Next / Submit button
//   5. If a "queue for next round" button appears, clicks it immediately
//   6. Loops until the game ends (OutOfRangeNotification)
//
// This script works with most standard experiment apps without
// any game-specific customization.
// ──────────────────────────────────────────────────────────────

import { BotScript } from '../engine/types';

/** Generic auto-player bot script that handles most standard experiment apps. */
const POC_BOT: BotScript = {
  name: 'PoC Simple Clicker',
  initialState: 'navigate',

  states: {
    // ── State: navigate ───────────────────────────────────
    // Entry point. The BotRunner handles page.goto(url) before
    // the FSM starts. We just wait for the URL to resolve.
    navigate: {
      onEntry: [
        { type: 'log', value: 'Navigating to join link...' },
      ],
      transitions: [
        {
          target: 'waitForPage',
          guard: { type: 'urlContains', value: '/' },
        },
      ],
    },

    // ── State: waitForPage ────────────────────────────────
    // Waits for a page to be fully loaded, then decides
    // whether to fill a form or just click next.
    waitForPage: {
      onEntry: [
        {
          // Wait for body — matches ALL page types (forms, results, WaitPages)
          type: 'waitForSelector',
          selector: 'body',
          timeout: 10000,
        },
        { type: 'log', value: 'Page loaded.' },
        { type: 'wait', value: 50 },
      ],
      transitions: [
        // Check for game-over page first
        {
          target: 'done',
          guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
        },
        // Detect WaitPage (auto-refreshing page with no form)
        {
          target: 'handleWaitPage',
          guard: {
            type: 'custom',
            fn: `(() => {
              // WaitPages: have the .otree-wait-page class, or
              // script containing 'waitForRedirect' / 'is_wait_page', or
              // the page body has no form and no submit button
              const isWaitPage = !!(
                document.querySelector('.otree-wait-page') ||
                document.querySelector('[data-wait-page]') ||
                (document.querySelector('script') &&
                  document.documentElement.innerHTML.includes('waitForRedirect'))
              );
              // Also check: no form AND no buttons → likely a WaitPage
              const hasForm = !!document.querySelector('form');
              const hasButton = !!document.querySelector(
                'button.otree-btn-next, .btn-primary, button[type="submit"]'
              );
              return isWaitPage || (!hasForm && !hasButton);
            })()`,
          },
        },
        // If this player already finished and can queue for the next round,
        // prioritize that action so the bot does not idle on an inter-round page.
        {
          target: 'queueNextRound',
          guard: {
            type: 'custom',
            fn: `(() => {
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
            })()`,
          },
        },
        // If there's a form with inputs, fill it
        {
          target: 'fillAndSubmit',
          guard: {
            type: 'custom',
            fn: `(() => {
              const inputs = document.querySelectorAll(
                'input[type="number"], input[type="text"]:not([readonly]), select, input[type="radio"]'
              );
              return inputs.length > 0;
            })()`,
          },
        },
        // Otherwise just click next
        {
          target: 'clickNext',
          guard: {
            type: 'elementExists',
            selector: 'button.otree-btn-next, .btn-primary, button[type="submit"]',
          },
        },
        // Fallback — poll again
        {
          target: 'waitForPage',
          delay: 500,
        },
      ],
    },

    // ── State: handleWaitPage ─────────────────────────────
    // WaitPages auto-advance via AJAX when all group
    // members arrive. Just wait and reload until we leave.
    handleWaitPage: {
      onEntry: [
        { type: 'log', value: 'Detected WaitPage — waiting for other players…' },
        { type: 'wait', value: 1500 },
        {
          type: 'evaluate',
          value: `window.location.reload()`,
        },
        { type: 'wait', value: 1000 },
      ],
      transitions: [
        {
          target: 'done',
          guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
        },
        // Still on a WaitPage? loop back
        {
          target: 'handleWaitPage',
          guard: {
            type: 'custom',
            fn: `(() => {
              const hasForm = !!document.querySelector('form');
              const hasButton = !!document.querySelector(
                'button.otree-btn-next, .btn-primary, button[type="submit"]'
              );
              return !hasForm && !hasButton;
            })()`,
          },
        },
        // Page advanced to a real page
        {
          target: 'waitForPage',
        },
      ],
    },

    // ── State: queueNextRound ─────────────────────────────
    // Clicks the queue/continue button shown after a player
    // finishes early and should be placed into the next round.
    queueNextRound: {
      onEntry: [
        { type: 'log', value: 'Queueing for next round...' },
        {
          type: 'evaluate',
          value: `
            (() => {
              const candidates = Array.from(document.querySelectorAll(
                'button.otree-btn-next, .btn-primary, button[type="submit"], button'
              ));
              const target = candidates.find((el) => {
                const text = (el.textContent || '').toLowerCase();
                const title = (el.getAttribute('title') || '').toLowerCase();
                const id = (el.id || '').toLowerCase();
                const cls = (el.className || '').toLowerCase();
                const marker = [text, title, id, cls].join(' ');
                return marker.includes('queue')
                  || marker.includes('next round')
                  || marker.includes('continue');
              });
              if (target) {
                target.click();
              }
            })();
          `,
        },
        { type: 'waitForNavigation', timeout: 15000 },
        { type: 'wait', value: 100 },
      ],
      transitions: [
        {
          target: 'done',
          guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
        },
        {
          target: 'waitForPage',
          guard: { type: 'elementExists', selector: 'body' },
          delay: 200,
        },
      ],
    },

    // ── State: fillAndSubmit ──────────────────────────────
    // Fills all visible form fields with sensible defaults.
    fillAndSubmit: {
      onEntry: [
        { type: 'log', value: 'Filling form fields...' },

        // Fill number inputs with 5
        {
          type: 'evaluate',
          value: `
            document.querySelectorAll('input[type="number"]').forEach(el => {
              const min = parseFloat(el.getAttribute('min')) || 0;
              const max = parseFloat(el.getAttribute('max')) || 100;
              const val = Math.min(Math.max(5, min), max);
              el.value = String(val);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            });
          `,
        },

        // Fill text inputs with "test"
        {
          type: 'evaluate',
          value: `
            document.querySelectorAll('input[type="text"]:not([readonly])').forEach(el => {
              if (!el.value) {
                el.value = 'test';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            });
          `,
        },

        // Select first non-empty option in dropdowns
        {
          type: 'evaluate',
          value: `
            document.querySelectorAll('select').forEach(el => {
              if (el.options.length > 1 && el.selectedIndex <= 0) {
                el.selectedIndex = 1;
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            });
          `,
        },

        // Click first radio button in each group
        {
          type: 'evaluate',
          value: `
            const seen = new Set();
            document.querySelectorAll('input[type="radio"]').forEach(el => {
              if (!seen.has(el.name)) {
                el.click();
                seen.add(el.name);
              }
            });
          `,
        },

        // Check first unchecked checkbox (if any)
        {
          type: 'evaluate',
          value: `
            document.querySelectorAll('input[type="checkbox"]:not(:checked)').forEach(el => {
              el.click();
            });
          `,
        },

        { type: 'wait', value: 50 },
        { type: 'log', value: 'Form filled.' },
      ],
      transitions: [
        {
          target: 'clickNext',
          guard: {
            type: 'elementExists',
            selector: 'button.otree-btn-next, .btn-primary, button[type="submit"]',
          },
        },
      ],
    },

    // ── State: clickNext ─────────────────────────────────
    // Clicks the primary submit / next button and waits for
    // the page to navigate.
    clickNext: {
      onEntry: [
        { type: 'log', value: 'Clicking next...' },
        {
          type: 'click',
          selector: 'button.otree-btn-next, .btn-primary, button[type="submit"]',
        },
        { type: 'waitForNavigation', timeout: 15000 },
        { type: 'wait', value: 100 },
      ],
      transitions: [
        // Check for game-over
        {
          target: 'done',
          guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
        },
        // Go back to page evaluation loop
        {
          target: 'waitForPage',
          guard: { type: 'elementExists', selector: 'body' },
          delay: 200,
        },
      ],
    },

    // ── State: done ──────────────────────────────────────
    // Terminal state. Bot stops here.
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

export default POC_BOT;

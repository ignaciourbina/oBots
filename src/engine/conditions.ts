// src/engine/conditions.ts
// ──────────────────────────────────────────────────────────────
// Built-in guard evaluators.
// Each guard resolves to a boolean given a Puppeteer Page.
// ──────────────────────────────────────────────────────────────

import type { Page } from 'puppeteer';
import { Guard } from './types';

/**
 * Evaluate a Guard condition against the current page state.
 * Returns true if the guard passes (transition should fire).
 */
export async function evaluateGuard(page: Page, guard: Guard): Promise<boolean> {
  switch (guard.type) {
    // ── elementExists ────────────────────────────────────
    case 'elementExists': {
      if (!guard.selector) throw new Error('elementExists guard requires a selector');
      try {
        const el = await page.$(guard.selector);
        return el !== null;
      } catch {
        return false;
      }
    }

    // ── elementNotExists ─────────────────────────────────
    case 'elementNotExists': {
      if (!guard.selector) throw new Error('elementNotExists guard requires a selector');
      try {
        const el = await page.$(guard.selector);
        return el === null;
      } catch {
        return true;
      }
    }

    // ── urlContains ──────────────────────────────────────
    case 'urlContains': {
      if (!guard.value) throw new Error('urlContains guard requires a value');
      const currentUrl = page.url();
      return currentUrl.includes(guard.value);
    }

    // ── urlEquals ────────────────────────────────────────
    case 'urlEquals': {
      if (!guard.value) throw new Error('urlEquals guard requires a value');
      return page.url() === guard.value;
    }

    // ── textContains ─────────────────────────────────────
    case 'textContains': {
      if (!guard.selector) throw new Error('textContains guard requires a selector');
      if (!guard.value) throw new Error('textContains guard requires a value');
      try {
        const text = await page.$eval(guard.selector, (el) => el.textContent ?? '');
        return text.includes(guard.value);
      } catch {
        return false;
      }
    }

    // ── custom (evaluate function body in page) ──────────
    case 'custom': {
      if (!guard.fn) throw new Error('custom guard requires an fn string');
      try {
        // The fn string should be a function body that returns a boolean
        const result = await page.evaluate(guard.fn);
        return Boolean(result);
      } catch {
        return false;
      }
    }

    default: {
      const _exhaustive: never = guard.type;
      throw new Error(`Unknown guard type: ${_exhaustive}`);
    }
  }
}

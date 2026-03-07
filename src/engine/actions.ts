// src/engine/actions.ts
// ──────────────────────────────────────────────────────────────
// Built-in Puppeteer action executors.
// Each function takes a Puppeteer Page and an Action descriptor.
// ──────────────────────────────────────────────────────────────

import type { Page } from 'puppeteer';
import { Action, BotStrategy, DEFAULTS, LogEntry } from './types';

/** Utility: sleep for ms milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a single Action on the given page.
 * Returns a LogEntry if the action produces loggable output.
 */
export async function executeAction(
  page: Page,
  action: Action,
  delayMultiplier: number = 1.0,
): Promise<LogEntry | null> {
  const timeout = action.timeout ?? DEFAULTS.actionTimeoutMs;

  switch (action.type) {
    // ── click ────────────────────────────────────────────
    case 'click': {
      if (!action.selector) throw new Error('click action requires a selector');
      await page.waitForSelector(action.selector, { timeout });
      await page.click(action.selector);
      return null;
    }

    // ── clickAndNavigate (atomic click + waitForNavigation) ──
    case 'clickAndNavigate': {
      if (!action.selector) throw new Error('clickAndNavigate action requires a selector');
      const navTimeout = action.timeout ?? DEFAULTS.navigationTimeoutMs;
      await page.waitForSelector(action.selector, { timeout });
      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: navTimeout }),
          page.click(action.selector),
        ]);
      } catch {
        // Navigation didn't happen within the timeout (e.g. form
        // validation blocked the submit).  Resolve gracefully so the
        // state-machine transitions can decide what to do next.
      }
      return null;
    }

    // ── fill (type text into an input) ───────────────────
    case 'fill': {
      if (!action.selector) throw new Error('fill action requires a selector');
      const value = String(action.value ?? '');
      await page.waitForSelector(action.selector, { timeout });
      // Clear existing value then type
      await page.click(action.selector, { clickCount: 3 });
      await page.type(action.selector, value);
      return null;
    }

    // ── select (dropdown) ────────────────────────────────
    case 'select': {
      if (!action.selector) throw new Error('select action requires a selector');
      const val = String(action.value ?? '');
      await page.waitForSelector(action.selector, { timeout });
      await page.select(action.selector, val);
      return null;
    }

    // ── wait (static delay) ──────────────────────────────
    case 'wait': {
      const ms = typeof action.value === 'number' ? action.value : 1000;
      await sleep(ms * delayMultiplier);
      return null;
    }

    // ── waitForNavigation ────────────────────────────────
    case 'waitForNavigation': {
      await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: action.timeout ?? DEFAULTS.navigationTimeoutMs,
      });
      return null;
    }

    // ── waitForSelector ──────────────────────────────────
    case 'waitForSelector': {
      if (!action.selector) throw new Error('waitForSelector requires a selector');
      await page.waitForSelector(action.selector, { timeout });
      return null;
    }
    // ── reload (Puppeteer page.reload) ─────────────────
    case 'reload': {
      await page.reload({
        waitUntil: 'domcontentloaded',
        timeout: action.timeout ?? DEFAULTS.navigationTimeoutMs,
      });
      return null;
    }
    // ── evaluate (run arbitrary JS in page context) ──────
    case 'evaluate': {
      if (typeof action.value !== 'string') {
        throw new Error('evaluate action requires a string value (JS code)');
      }
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      await page.evaluate(action.value);
      return null;
    }

    // ── screenshot ───────────────────────────────────────
    case 'screenshot': {
      const buf = await page.screenshot({
        encoding: 'base64',
        type: 'jpeg',
        quality: DEFAULTS.screenshotQuality,
      });
      return {
        timestamp: Date.now(),
        level: 'info',
        message: 'Screenshot captured',
        screenshotDataUrl: `data:image/jpeg;base64,${buf}`,
      };
    }

    // ── log ──────────────────────────────────────────────
    case 'log': {
      const message = String(action.value ?? '');
      return {
        timestamp: Date.now(),
        level: 'info',
        message,
      };
    }

    // ── fillFormFields (visible Puppeteer interactions) ──
    case 'fillFormFields': {
      if (!action.strategyConfig) throw new Error('fillFormFields requires strategyConfig');
      await fillFormFieldsVisible(page, action.strategyConfig);
      return null;
    }

    // ── clickNamedFormButton ──────────────────────────────
    // Handles experiment decision pages that use <button name="field" value="x">
    // instead of <input type="radio">. Randomly selects a button per group
    // according to the radioStrategy, then clicks it (which also submits the form).
    case 'clickNamedFormButton': {
      if (!action.strategyConfig) throw new Error('clickNamedFormButton requires strategyConfig');
      await clickNamedFormButtonVisible(page, action.strategyConfig);
      return null;
    }

    default: {
      const _exhaustive: never = action.type;
      throw new Error(`Unknown action type: ${_exhaustive}`);
    }
  }
}

// ── Visible form-field filling ──────────────────────────────

interface DiscoveredField {
  type: 'number' | 'text' | 'textarea' | 'select' | 'radio' | 'checkbox';
  selector: string;
  /** For number: { min, max, step }. For select: option values. For radio: group name */
  meta: Record<string, unknown>;
}

/**
 * Fill form fields using visible Puppeteer interactions (click, type, select)
 * so they are captured by screencast/screenshots.
 */
async function fillFormFieldsVisible(page: Page, strategy: BotStrategy): Promise<void> {
  const delayMs = strategy.actionDelayMs ?? 0;

  // 1. Discover all form fields via a single evaluate call
  const fields = await page.evaluate(() => {
    const result: Array<{
      type: string;
      selector: string;
      meta: Record<string, unknown>;
    }> = [];

    // Number inputs
    document.querySelectorAll('input[type="number"]').forEach((el, i) => {
      const input = el as HTMLInputElement;
      result.push({
        type: 'number',
        selector: `input[type="number"]:nth-of-type(${i + 1})`,
        meta: {
          min: parseFloat(input.getAttribute('min') ?? '') || 0,
          max: parseFloat(input.getAttribute('max') ?? '') || 100,
          step: parseFloat(input.getAttribute('step') ?? '') || 1,
          id: input.id,
          name: input.name,
        },
      });
    });

    // Text inputs
    document.querySelectorAll('input[type="text"]:not([readonly])').forEach((el, i) => {
      const input = el as HTMLInputElement;
      if (!input.value) {
        result.push({
          type: 'text',
          selector: `input[type="text"]:not([readonly]):nth-of-type(${i + 1})`,
          meta: { id: input.id, name: input.name },
        });
      }
    });

    // Textareas
    document.querySelectorAll('textarea:not([readonly])').forEach((el, i) => {
      const ta = el as HTMLTextAreaElement;
      if (!ta.value) {
        result.push({
          type: 'textarea',
          selector: `textarea:not([readonly]):nth-of-type(${i + 1})`,
          meta: { id: ta.id, name: ta.name },
        });
      }
    });

    // Selects
    document.querySelectorAll('select').forEach((el, i) => {
      const sel = el as HTMLSelectElement;
      if (sel.options.length > 1) {
        const opts: string[] = [];
        const hasBlank = sel.options[0]?.value === '';
        for (let j = hasBlank ? 1 : 0; j < sel.options.length; j++) {
          opts.push(sel.options[j].value);
        }
        result.push({
          type: 'select',
          selector: `select:nth-of-type(${i + 1})`,
          meta: { id: sel.id, name: sel.name, options: opts, selectedIndex: sel.selectedIndex },
        });
      }
    });

    // Radios — group by name
    const radioGroups: Record<string, Array<{ index: number; value: string }>> = {};
    document.querySelectorAll('input[type="radio"]').forEach((el, i) => {
      const radio = el as HTMLInputElement;
      const name = radio.name;
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push({ index: i, value: radio.value });
    });
    for (const [name, radios] of Object.entries(radioGroups)) {
      result.push({
        type: 'radio',
        selector: `input[type="radio"][name="${name}"]`,
        meta: { name, radios },
      });
    }

    // Checkboxes
    document.querySelectorAll('input[type="checkbox"]').forEach((el, i) => {
      const cb = el as HTMLInputElement;
      result.push({
        type: 'checkbox',
        selector: `input[type="checkbox"]:nth-of-type(${i + 1})`,
        meta: { id: cb.id, name: cb.name, checked: cb.checked },
      });
    });

    return result;
  });

  // 2. Interact with each field using real Puppeteer methods
  for (const field of fields) {
    try {
      switch (field.type) {
        case 'number': {
          const { min, max, step } = field.meta as { min: number; max: number; step: number };
          let val: number;
          switch (strategy.numberStrategy) {
            case 'min': val = min; break;
            case 'max': val = max; break;
            case 'midpoint': val = Math.round((min + max) / 2); break;
            case 'fixed': val = Math.min(Math.max(strategy.numberFixedValue, min), max); break;
            case 'random': {
              const steps = Math.floor((max - min) / step);
              val = min + Math.round(Math.random() * steps) * step;
              break;
            }
          }
          // Build a unique selector using id/name if available
          const numSel = buildSelector(field);
          await page.click(numSel, { clickCount: 3 });
          if (delayMs) await sleep(delayMs / 2);
          await page.type(numSel, String(val), { delay: 30 });
          break;
        }

        case 'text': {
          const txtSel = buildSelector(field);
          await page.click(txtSel, { clickCount: 3 });
          if (delayMs) await sleep(delayMs / 2);
          await page.type(txtSel, strategy.textValue, { delay: 30 });
          break;
        }

        case 'textarea': {
          const taSel = buildSelector(field);
          await page.click(taSel);
          if (delayMs) await sleep(delayMs / 2);
          await page.type(taSel, strategy.textValue, { delay: 30 });
          break;
        }

        case 'select': {
          const opts = field.meta.options as string[];
          if (opts.length === 0) break;
          let chosen: string;
          switch (strategy.selectStrategy) {
            case 'first': chosen = opts[0]; break;
            case 'last': chosen = opts[opts.length - 1]; break;
            case 'random': chosen = opts[Math.floor(Math.random() * opts.length)]; break;
          }
          const selSel = buildSelector(field);
          await page.select(selSel, chosen);
          break;
        }

        case 'radio': {
          const radios = field.meta.radios as Array<{ index: number; value: string }>;
          if (radios.length === 0) break;
          let target: { index: number; value: string };
          switch (strategy.radioStrategy) {
            case 'first': target = radios[0]; break;
            case 'last': target = radios[radios.length - 1]; break;
            case 'random': target = radios[Math.floor(Math.random() * radios.length)]; break;
          }
          // Click the specific radio by name + value
          const radioSel = `input[type="radio"][name="${field.meta.name}"][value="${target.value}"]`;
          await page.click(radioSel);
          break;
        }

        case 'checkbox': {
          const checked = field.meta.checked as boolean;
          const cbSel = buildSelector(field);
          switch (strategy.checkboxStrategy) {
            case 'all':
              if (!checked) await page.click(cbSel);
              break;
            case 'none':
              if (checked) await page.click(cbSel);
              break;
            case 'random':
              if (Math.random() > 0.5) await page.click(cbSel);
              break;
          }
          break;
        }
      }
    } catch {
      // Skip fields that can't be interacted with (hidden, detached, etc.)
    }

    // Visible delay between fields
    if (delayMs) await sleep(delayMs);
  }
}

/**
 * Build the most specific CSS selector possible for a discovered field.
 * Prefers id > name > positional selector.
 */
function buildSelector(field: { type: string; selector: string; meta: Record<string, unknown> }): string {
  const id = field.meta.id as string | undefined;
  const name = field.meta.name as string | undefined;
  if (id) return `#${CSS.escape(id)}`;
  if (name) {
    const tag = field.type === 'textarea' ? 'textarea' : 
                field.type === 'select' ? 'select' :
                `input[type="${field.type}"]`;
    return `${tag}[name="${name}"]`;
  }
  return field.selector;
}

/** CSS.escape polyfill for Node/Puppeteer context */
const CSS = globalThis.CSS ?? {
  escape: (s: string) => s.replace(/([^\w-])/g, '\\$1'),
};

// ── Named form button clicking ─────────────────────────────

/**
 * Handle experiment decision pages that use <button name="field" value="x"> elements
 * (e.g. prisoner's dilemma Choice A / Choice B) instead of radio inputs.
 * Groups buttons by their `name` attribute and applies the radioStrategy to
 * randomly select one per group, then clicks it (which also submits the form).
 */
async function clickNamedFormButtonVisible(page: Page, strategy: BotStrategy): Promise<void> {
  // Discover named-button groups via a single evaluate call.
  // Exclude .otree-btn-next (experiment nav button) and buttons with no name.
  const groups = await page.evaluate(() => {
    const result: Record<string, string[]> = {};
    document.querySelectorAll<HTMLButtonElement>('button[name]:not(.otree-btn-next)').forEach((btn) => {
      if (!btn.name || btn.disabled) return;
      if (!result[btn.name]) result[btn.name] = [];
      result[btn.name].push(btn.value);
    });
    return result;
  });

  for (const [name, values] of Object.entries(groups)) {
    if (values.length === 0) continue;

    let chosenValue: string;
    switch (strategy.radioStrategy) {
      case 'first':  chosenValue = values[0]; break;
      case 'last':   chosenValue = values[values.length - 1]; break;
      case 'random': chosenValue = values[Math.floor(Math.random() * values.length)]; break;
    }

    // Escape CSS special characters in the value attribute selector.
    const safeValue = chosenValue.replace(/["\\]/g, '\\$&');
    const selector = `button[name="${name}"][value="${safeValue}"]`;

    // Click the button and wait for the resulting form-submit navigation.
    await Promise.all([
      page.waitForNavigation({ timeout: 10_000, waitUntil: 'domcontentloaded' }).catch(() => {
        // Navigation may not happen on SPAs or if already navigated — that's fine.
      }),
      page.click(selector),
    ]);

    // Process one group only: experiment decision pages have a single named-button
    // group that both sets the field value AND submits the form.
    break;
  }
}

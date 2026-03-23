// src/engine/actions.ts
// ──────────────────────────────────────────────────────────────
// Built-in Puppeteer action executors.
// Each function takes a Puppeteer Page and an Action descriptor.
// ──────────────────────────────────────────────────────────────

import type { Page } from 'puppeteer';
import { Action, BotStrategy, DEFAULTS, LogEntry } from './types';
import { pickRandomCustomMessage, pickRandomMessage } from './message-bank';

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

    // ── fillCarousel ────────────────────────────────────────
    // Navigates carousel slides and fills form fields on each active slide.
    case 'fillCarousel': {
      if (!action.strategyConfig) throw new Error('fillCarousel requires strategyConfig');
      await fillCarouselVisible(page, action.strategyConfig);
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
          const textToType = pickRandomCustomMessage(strategy.customMessages) ?? pickRandomMessage(strategy.messageBankCategories ?? []) ?? strategy.textValue;
          const txtSel = buildSelector(field);
          await page.click(txtSel, { clickCount: 3 });
          if (delayMs) await sleep(delayMs / 2);
          await page.type(txtSel, textToType, { delay: 30 });
          break;
        }

        case 'textarea': {
          const taTextToType = pickRandomCustomMessage(strategy.customMessages) ?? pickRandomMessage(strategy.messageBankCategories ?? []) ?? strategy.textValue;
          const taSel = buildSelector(field);
          await page.click(taSel);
          if (delayMs) await sleep(delayMs / 2);
          await page.type(taSel, taTextToType, { delay: 30 });
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
          // Force-set via evaluate so custom widgets (hidden <select>
          // behind a JS overlay) react to the change event.
          // page.select() only works on visible native selects;
          // evaluate + dispatchEvent covers custom dropdown widgets.
          await page.evaluate((sel, val) => {
            const el = document.querySelector(sel) as HTMLSelectElement | null;
            if (el) {
              el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, selSel, chosen);
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

  // ── Fallback: fill any empty form inputs + bypass confirmation ───
  // Custom widgets (e.g. oTree PC-selector) hide the real <input> and
  // manage it via JS.  The main loop may fail to type into hidden inputs.
  // This single evaluate pass fills ALL empty named inputs in the form
  // and pre-sets data-confirmed to bypass confirmation modals.
  try {
    await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) return;

      // Fill every empty named input (text, hidden, etc.)
      form.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
        if (inp.type === 'submit' || inp.type === 'button' || inp.type === 'checkbox' || inp.type === 'radio') return;
        if (inp.name && !inp.value.trim()) {
          inp.value = String(Math.floor(Math.random() * 28) + 1);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      // Fill unfilled selects
      form.querySelectorAll('select').forEach((el) => {
        const sel = el as HTMLSelectElement;
        if (sel.value && sel.selectedIndex > 0) return;
        const validOpts = Array.from(sel.options).filter((o) => o.value !== '');
        if (validOpts.length > 0) {
          sel.value = validOpts[Math.floor(Math.random() * validOpts.length)].value;
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      // Bypass confirmation modals (e.g. "Confirm your PC number")
      form.dataset.confirmed = 'yes';
    });
  } catch {
    // Fallback failed — continue to submit attempt
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

// ── Carousel form-field filling ─────────────────────────────

/** Info about a detected carousel on the page. */
interface CarouselInfo {
  containerSelector: string;
  slideSelector: string;
  nextSelector: string;
  indicatorSelector: string;
  slideCount: number;
  hasNext: boolean;
  hasIndicators: boolean;
}

/**
 * Navigate carousel slides and fill form fields on each active slide.
 * Detects common carousel libraries (Bootstrap, Splide, Swiper, Owl,
 * Slick) and a generic `[data-carousel]` convention.
 */
async function fillCarouselVisible(page: Page, strategy: BotStrategy): Promise<void> {
  const delayMs = strategy.actionDelayMs ?? 0;

  // 1. Discover carousel structure via a single evaluate call
  const carouselInfo: CarouselInfo | null = await page.evaluate(() => {
    const patterns = [
      {
        container: '.carousel',
        slide: '.carousel-item',
        next: '.carousel-control-next, [data-bs-slide="next"], [data-slide="next"]',
        indicators: '.carousel-indicators [data-bs-slide-to], .carousel-indicators [data-slide-to], .carousel-indicators button',
      },
      {
        container: '.splide',
        slide: '.splide__slide',
        next: '.splide__arrow--next',
        indicators: '.splide__pagination__page',
      },
      {
        container: '.swiper',
        slide: '.swiper-slide',
        next: '.swiper-button-next',
        indicators: '.swiper-pagination-bullet',
      },
      {
        container: '.owl-carousel',
        slide: '.owl-item',
        next: '.owl-next',
        indicators: '.owl-dot',
      },
      {
        container: '.slick-slider',
        slide: '.slick-slide:not(.slick-cloned)',
        next: '.slick-next',
        indicators: '.slick-dots button',
      },
      {
        container: '[data-carousel]',
        slide: '[data-slide]',
        next: '[data-carousel-next]',
        indicators: '[data-carousel-indicator]',
      },
    ];

    for (const p of patterns) {
      const container = document.querySelector(p.container);
      if (!container) continue;
      const slides = container.querySelectorAll(p.slide);
      if (slides.length <= 1) continue;
      // Only match if the carousel actually contains form fields
      const hasFields = container.querySelector(
        'input, select, textarea, button[name]:not(.otree-btn-next)',
      );
      if (!hasFields) continue;
      return {
        containerSelector: p.container,
        slideSelector: p.slide,
        nextSelector: p.next,
        indicatorSelector: p.indicators,
        slideCount: slides.length,
        hasNext: !!container.querySelector(p.next),
        hasIndicators: !!container.querySelector(p.indicators),
      };
    }
    return null;
  });

  if (!carouselInfo) return; // No carousel found

  // 2. Determine which slides to visit based on strategy
  const allIndices = Array.from({ length: carouselInfo.slideCount }, (_, i) => i);
  let targetIndices: number[];
  switch (strategy.carouselStrategy) {
    case 'sequential': targetIndices = allIndices; break;
    case 'random':     targetIndices = [allIndices[Math.floor(Math.random() * allIndices.length)]]; break;
    case 'first':      targetIndices = [0]; break;
    case 'last':       targetIndices = [allIndices.length - 1]; break;
  }

  // 3. Navigate to each target slide and fill its fields
  for (let ti = 0; ti < targetIndices.length; ti++) {
    const slideIndex = targetIndices[ti];

    // Navigate to the target slide
    if (slideIndex > 0 || ti > 0) {
      if (carouselInfo.hasIndicators) {
        // Direct jump via indicator click
        await page.evaluate(
          (sel: string, idx: number) => {
            const indicators = document.querySelectorAll(sel);
            const target = indicators[idx] as HTMLElement | undefined;
            if (target) target.click();
          },
          carouselInfo.indicatorSelector,
          slideIndex,
        );
      } else if (carouselInfo.hasNext) {
        // Sequential advance via next button
        const clicksNeeded = ti === 0 ? slideIndex : 1;
        for (let c = 0; c < clicksNeeded; c++) {
          await page.click(carouselInfo.nextSelector);
          await sleep(350); // animation settle between clicks
        }
      }
      // Wait for slide transition animation to complete
      await sleep(450);
    }

    // 4. Fill visible form fields on the now-active slide
    await fillFormFieldsVisible(page, strategy);

    if (delayMs) await sleep(delayMs);
  }
}

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

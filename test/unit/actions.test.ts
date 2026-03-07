// test/unit/actions.test.ts
// ──────────────────────────────────────────────────────────────
// Unit tests for built-in action executors.
// ──────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { executeAction } from '../../src/engine/actions';
import { Action, DEFAULT_STRATEGY, BotStrategy } from '../../src/engine/types';

// ── Helpers ─────────────────────────────────────────────────

function createMockPage(overrides: Record<string, unknown> = {}): any {
  return {
    url: () => 'http://localhost:8000/p/abc123/Page/1',
    $: vi.fn().mockResolvedValue(null),
    $eval: vi.fn().mockResolvedValue(''),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue('base64data'),
    reload: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Parameter validation ────────────────────────────────────

describe('executeAction — parameter validation', () => {
  it('click requires a selector', async () => {
    const page = createMockPage();
    await expect(executeAction(page, { type: 'click' })).rejects.toThrow('requires a selector');
  });

  it('clickAndNavigate requires a selector', async () => {
    const page = createMockPage();
    await expect(executeAction(page, { type: 'clickAndNavigate' })).rejects.toThrow('requires a selector');
  });

  it('fill requires a selector', async () => {
    const page = createMockPage();
    await expect(executeAction(page, { type: 'fill' })).rejects.toThrow('requires a selector');
  });

  it('select requires a selector', async () => {
    const page = createMockPage();
    await expect(executeAction(page, { type: 'select' })).rejects.toThrow('requires a selector');
  });

  it('waitForSelector requires a selector', async () => {
    const page = createMockPage();
    await expect(executeAction(page, { type: 'waitForSelector' })).rejects.toThrow('requires a selector');
  });

  it('evaluate requires a string value', async () => {
    const page = createMockPage();
    await expect(executeAction(page, { type: 'evaluate', value: 42 })).rejects.toThrow('requires a string value');
  });

  it('fillFormFields requires strategyConfig', async () => {
    const page = createMockPage();
    await expect(executeAction(page, { type: 'fillFormFields' })).rejects.toThrow('requires strategyConfig');
  });

  it('clickNamedFormButton requires strategyConfig', async () => {
    const page = createMockPage();
    await expect(executeAction(page, { type: 'clickNamedFormButton' })).rejects.toThrow('requires strategyConfig');
  });
});

// ── Wait & delay multiplier ─────────────────────────────────

describe('executeAction — wait', () => {
  it('waits for the specified duration', async () => {
    const page = createMockPage();
    const start = Date.now();
    await executeAction(page, { type: 'wait', value: 100 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it('applies delayMultiplier to wait duration', async () => {
    const page = createMockPage();
    const start = Date.now();
    await executeAction(page, { type: 'wait', value: 100 }, 2.0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(190);
  });

  it('defaults to 1000ms when value is not a number', async () => {
    const page = createMockPage();
    const start = Date.now();
    // Use multiplier 0.01 so we don't wait a full second
    await executeAction(page, { type: 'wait' }, 0.01);
    const elapsed = Date.now() - start;
    // 1000 * 0.01 = 10ms
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(elapsed).toBeLessThan(200);
  });
});

// ── Click actions ───────────────────────────────────────────

describe('executeAction — click', () => {
  it('waits for selector then clicks', async () => {
    const page = createMockPage();
    await executeAction(page, { type: 'click', selector: '.btn' });
    expect(page.waitForSelector).toHaveBeenCalledWith('.btn', expect.any(Object));
    expect(page.click).toHaveBeenCalledWith('.btn');
  });
});

describe('executeAction — clickAndNavigate', () => {
  it('clicks and waits for navigation', async () => {
    const page = createMockPage();
    await executeAction(page, { type: 'clickAndNavigate', selector: '.submit' });
    expect(page.click).toHaveBeenCalledWith('.submit');
    expect(page.waitForNavigation).toHaveBeenCalled();
  });

  it('swallows navigation timeout gracefully', async () => {
    const page = createMockPage({
      waitForNavigation: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
    });
    // Should not throw
    const result = await executeAction(page, { type: 'clickAndNavigate', selector: '.submit' });
    expect(result).toBeNull();
  });
});

// ── Fill action ─────────────────────────────────────────────

describe('executeAction — fill', () => {
  it('clears and types into input', async () => {
    const page = createMockPage();
    await executeAction(page, { type: 'fill', selector: '#name', value: 'Alice' });
    expect(page.click).toHaveBeenCalledWith('#name', { clickCount: 3 });
    expect(page.type).toHaveBeenCalledWith('#name', 'Alice');
  });
});

// ── Select action ───────────────────────────────────────────

describe('executeAction — select', () => {
  it('selects a dropdown value', async () => {
    const page = createMockPage();
    await executeAction(page, { type: 'select', selector: '#role', value: 'admin' });
    expect(page.select).toHaveBeenCalledWith('#role', 'admin');
  });
});

// ── Evaluate action ─────────────────────────────────────────

describe('executeAction — evaluate', () => {
  it('evaluates JS in page context', async () => {
    const page = createMockPage();
    await executeAction(page, { type: 'evaluate', value: 'document.title' });
    expect(page.evaluate).toHaveBeenCalledWith('document.title');
  });
});

// ── Reload action ───────────────────────────────────────────

describe('executeAction — reload', () => {
  it('reloads the page with domcontentloaded', async () => {
    const page = createMockPage();
    await executeAction(page, { type: 'reload' });
    expect(page.reload).toHaveBeenCalledWith(
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
  });
});

// ── Screenshot action ───────────────────────────────────────

describe('executeAction — screenshot', () => {
  it('captures screenshot and returns log entry with data URL', async () => {
    const page = createMockPage({
      screenshot: vi.fn().mockResolvedValue('aW1hZ2VkYXRh'),
    });
    const result = await executeAction(page, { type: 'screenshot' });
    expect(result).not.toBeNull();
    expect(result!.message).toBe('Screenshot captured');
    expect(result!.screenshotDataUrl).toContain('data:image/jpeg;base64,');
  });
});

// ── Log action ──────────────────────────────────────────────

describe('executeAction — log', () => {
  it('returns a log entry with the message', async () => {
    const page = createMockPage();
    const result = await executeAction(page, { type: 'log', value: 'hello world' });
    expect(result).not.toBeNull();
    expect(result!.message).toBe('hello world');
    expect(result!.level).toBe('info');
  });

  it('coerces non-string values to string', async () => {
    const page = createMockPage();
    const result = await executeAction(page, { type: 'log', value: 42 });
    expect(result!.message).toBe('42');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { evaluateGuard } from '../../src/engine/conditions';

function makePage(overrides: Record<string, unknown> = {}): any {
  return {
    url: vi.fn(() => 'http://localhost:8000/join/abc/'),
    $: vi.fn(async () => null),
    $eval: vi.fn(async () => ''),
    evaluate: vi.fn(async () => true),
    ...overrides,
  };
}

describe('evaluateGuard', () => {
  it('evaluates elementExists and elementNotExists', async () => {
    const page = makePage({
      $: vi.fn(async (selector: string) => (selector === '.present' ? {} : null)),
    });

    await expect(evaluateGuard(page, { type: 'elementExists', selector: '.present' })).resolves.toBe(true);
    await expect(evaluateGuard(page, { type: 'elementNotExists', selector: '.missing' })).resolves.toBe(true);
  });

  it('evaluates urlContains and urlEquals', async () => {
    const page = makePage({
      url: vi.fn(() => 'http://localhost:8000/p/abc123/Results/1'),
    });

    await expect(evaluateGuard(page, { type: 'urlContains', value: 'Results' })).resolves.toBe(true);
    await expect(evaluateGuard(page, { type: 'urlEquals', value: 'http://localhost:8000/p/abc123/Results/1' })).resolves.toBe(true);
  });

  it('evaluates textContains', async () => {
    const page = makePage({
      $eval: vi.fn(async () => 'Round 1 completed'),
    });

    await expect(
      evaluateGuard(page, { type: 'textContains', selector: '.status', value: 'completed' }),
    ).resolves.toBe(true);
  });

  it('handles custom guard failures as false', async () => {
    const page = makePage({
      evaluate: vi.fn(async () => {
        throw new Error('bad custom');
      }),
    });

    await expect(evaluateGuard(page, { type: 'custom', fn: '(() => true)()' })).resolves.toBe(false);
  });

  it('throws for invalid guard payloads', async () => {
    const page = makePage();

    await expect(evaluateGuard(page, { type: 'elementExists' })).rejects.toThrow('requires a selector');
    await expect(evaluateGuard(page, { type: 'urlContains' })).rejects.toThrow('requires a value');
    await expect(evaluateGuard(page, { type: 'custom' })).rejects.toThrow('requires an fn string');
  });

  // ── Edge cases ──────────────────────────────────────────

  it('elementExists returns false when page.$ throws', async () => {
    const page = makePage({
      $: vi.fn(async () => { throw new Error('Execution context was destroyed'); }),
    });
    await expect(evaluateGuard(page, { type: 'elementExists', selector: '.x' })).resolves.toBe(false);
  });

  it('elementNotExists returns true when page.$ throws', async () => {
    const page = makePage({
      $: vi.fn(async () => { throw new Error('Execution context was destroyed'); }),
    });
    await expect(evaluateGuard(page, { type: 'elementNotExists', selector: '.x' })).resolves.toBe(true);
  });

  it('urlContains matches substrings', async () => {
    const page = makePage({
      url: vi.fn(() => 'http://localhost:8000/p/abc123/Results/1'),
    });
    await expect(evaluateGuard(page, { type: 'urlContains', value: 'abc123' })).resolves.toBe(true);
    await expect(evaluateGuard(page, { type: 'urlContains', value: 'xyz' })).resolves.toBe(false);
  });

  it('textContains returns false when element is missing', async () => {
    const page = makePage({
      $eval: vi.fn(async () => { throw new Error('No element found for selector'); }),
    });
    await expect(
      evaluateGuard(page, { type: 'textContains', selector: '.missing', value: 'foo' }),
    ).resolves.toBe(false);
  });

  it('custom guard coerces truthy non-boolean to true', async () => {
    const page = makePage({
      evaluate: vi.fn(async () => 1),
    });
    await expect(evaluateGuard(page, { type: 'custom', fn: '(() => 1)()' })).resolves.toBe(true);
  });

  it('custom guard coerces falsy non-boolean to false', async () => {
    const page = makePage({
      evaluate: vi.fn(async () => 0),
    });
    await expect(evaluateGuard(page, { type: 'custom', fn: '(() => 0)()' })).resolves.toBe(false);
  });
});

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
});

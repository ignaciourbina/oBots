import { describe, it, expect } from 'vitest';
import { computeAdaptiveScreenshotIntervalMs } from '../../src/main/screenshot-rate';

describe('computeAdaptiveScreenshotIntervalMs', () => {
  it('caps high FPS for low bot counts', () => {
    // 1 bot => max-per-bot cap (20 FPS) => 50ms interval.
    expect(computeAdaptiveScreenshotIntervalMs(1)).toBe(50);
  });

  it('adapts interval with medium bot counts', () => {
    // 12 bots => floor(120 / 12) = 10 FPS => 100ms interval.
    expect(computeAdaptiveScreenshotIntervalMs(12)).toBe(100);
  });

  it('enforces minimum per-bot FPS at high bot counts', () => {
    // 100 bots => raw 1 FPS, clamped to 4 FPS => 250ms interval.
    expect(computeAdaptiveScreenshotIntervalMs(100)).toBe(250);
  });

  it('handles invalid bot count values safely', () => {
    expect(computeAdaptiveScreenshotIntervalMs(0)).toBe(50);
    expect(computeAdaptiveScreenshotIntervalMs(-5)).toBe(50);
  });
});

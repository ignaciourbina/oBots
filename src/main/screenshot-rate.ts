import { DEFAULTS } from '../engine/types';

/**
 * Compute screenshot interval based on the number of active bots and
 * a global FPS budget for the entire app.
 */
export function computeAdaptiveScreenshotIntervalMs(activeBots: number): number {
  const normalizedBots = Math.max(1, activeBots);
  const budgetPerBotFps = Math.floor(DEFAULTS.screenshotGlobalFpsBudget / normalizedBots);
  const cappedPerBotFps = Math.min(
    DEFAULTS.screenshotMaxPerBotFps,
    Math.max(DEFAULTS.screenshotMinPerBotFps, budgetPerBotFps),
  );
  const budgetIntervalMs = Math.max(1, Math.round(1000 / cappedPerBotFps));
  return Math.max(DEFAULTS.screenshotIntervalMs, budgetIntervalMs);
}

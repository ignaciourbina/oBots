// src/main/screencast.ts
// ──────────────────────────────────────────────────────────────
// Shared helpers for CDP Page.startScreencast / stopScreencast.
// Used by BotRunner for both grid-tile and focus-window screencasts.
// ──────────────────────────────────────────────────────────────

import type { CDPSession } from 'puppeteer';

/** Options forwarded to CDP Page.startScreencast. */
export interface ScreencastOptions {
  format?: 'jpeg' | 'png';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  everyNthFrame?: number;
}

/**
 * Start a CDP screencast, piping each frame through the provided callback.
 * Registers a `Page.screencastFrame` listener that automatically acknowledges
 * frames so CDP continues sending. Call {@link stopScreencast} to tear down.
 */
export async function startScreencast(
  cdp: CDPSession,
  opts: ScreencastOptions,
  onFrame: (dataUrl: string) => void,
): Promise<void> {
  const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';

  cdp.on('Page.screencastFrame', (params: { data: string; sessionId: number }) => {
    onFrame(`data:${mime};base64,${params.data}`);
    cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
  });

  await cdp.send('Page.startScreencast', {
    format: opts.format ?? 'jpeg',
    quality: opts.quality,
    maxWidth: opts.maxWidth,
    maxHeight: opts.maxHeight,
    everyNthFrame: opts.everyNthFrame,
  });
}

/**
 * Restart a running screencast with new parameters (e.g. after a window resize).
 * Stops the current screencast and starts a new one without detaching the CDP
 * session, so the existing frame listener remains active.
 */
export async function restartScreencast(
  cdp: CDPSession,
  opts: ScreencastOptions,
): Promise<void> {
  await cdp.send('Page.stopScreencast').catch(() => {});
  await cdp.send('Page.startScreencast', {
    format: opts.format ?? 'jpeg',
    quality: opts.quality,
    maxWidth: opts.maxWidth,
    maxHeight: opts.maxHeight,
    everyNthFrame: opts.everyNthFrame,
  }).catch(() => {});
}

/**
 * Stop a CDP screencast and detach the session.
 * Both operations silently swallow errors for safe teardown during shutdown.
 */
export async function stopScreencast(cdp: CDPSession): Promise<void> {
  await cdp.send('Page.stopScreencast').catch(() => {});
  await cdp.detach().catch(() => {});
}

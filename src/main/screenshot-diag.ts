// src/main/screenshot-diag.ts
// ──────────────────────────────────────────────────────────────
// Dedicated diagnostic logger for the screenshot pipeline.
// Writes structured JSONL to logs/screenshot-diag-<DATE>.log
// so frozen-frame issues can be post-mortem analysed.
//
// Usage (main process — capture side):
//   import { diagCapture, diagSend, diagSkip } from './screenshot-diag';
//   diagCapture(botId, index, captureMs, bytes);
//   diagSend(botId, index);
//   diagSkip(botId, index, reason);
//
// Usage (renderer side — via IPC forwarding):
//   diagRenderer(botId, index, event, detail);
// ──────────────────────────────────────────────────────────────

import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// ── Log directory ────────────────────────────────────────────
// Always write inside the project root so logs are easy to find.

function getDiagLogDir(): string {
  return path.join(process.cwd(), 'logs');
}

// ── Diagnostic logger (file-only, no console spam) ──────────

const diagLogger = winston.createLogger({
  level: 'debug',
  transports: [
    new DailyRotateFile({
      dirname: getDiagLogDir(),
      filename: 'screenshot-diag-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '7d',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
        winston.format.json(),
      ),
    }),
  ],
  exitOnError: false,
});

// ── Per-bot frame counters for periodic summaries ───────────

interface BotStats {
  captured: number;
  sent: number;
  skipped: number;
  lastCaptureMs: number;
  lastSendTs: number;
}

const stats = new Map<string, BotStats>();

function getStats(botId: string): BotStats {
  let s = stats.get(botId);
  if (!s) {
    s = { captured: 0, sent: 0, skipped: 0, lastCaptureMs: 0, lastSendTs: 0 };
    stats.set(botId, s);
  }
  return s;
}

// ── Public API ──────────────────────────────────────────────

/**
 * Log a successful screenshot capture from Puppeteer's page.screenshot().
 *
 * @param botId     Bot identifier
 * @param index     Grid slot index
 * @param captureMs Time spent in page.screenshot() call
 * @param bytes     Size of the base64 payload in bytes
 */
export function diagCapture(
  botId: string,
  index: number,
  captureMs: number,
  bytes: number,
): void {
  const s = getStats(botId);
  s.captured++;
  s.lastCaptureMs = captureMs;
  diagLogger.debug('capture', {
    side: 'main',
    event: 'capture',
    botId,
    index,
    captureMs,
    bytes,
    frameNum: s.captured,
  });
}

/**
 * Log that a screenshot was sent via IPC to the renderer.
 *
 * @param botId  Bot identifier
 * @param index  Grid slot index
 */
export function diagSend(botId: string, index: number): void {
  const s = getStats(botId);
  s.sent++;
  s.lastSendTs = Date.now();
  diagLogger.debug('send', {
    side: 'main',
    event: 'ipc-send',
    botId,
    index,
    frameNum: s.sent,
  });
}

/**
 * Log that a screenshot capture was skipped.
 *
 * @param botId   Bot identifier
 * @param index   Grid slot index
 * @param reason  Why it was skipped (e.g. 'capture-error', 'bot-done')
 */
export function diagSkip(
  botId: string,
  index: number,
  reason: string,
): void {
  const s = getStats(botId);
  s.skipped++;
  diagLogger.debug('skip', {
    side: 'main',
    event: 'skip',
    botId,
    index,
    reason,
    skippedTotal: s.skipped,
  });
}

/**
 * Log a diagnostic event from the renderer side (forwarded via IPC).
 *
 * @param botId   Bot identifier
 * @param index   Grid slot index
 * @param event   Event type (e.g. 'ipc-recv', 'queued', 'flush-render', 'flush-skip', 'throttled')
 * @param detail  Optional extra data
 */
export function diagRenderer(
  botId: string,
  index: number,
  event: string,
  detail?: Record<string, unknown>,
): void {
  diagLogger.debug(event, {
    side: 'renderer',
    event,
    botId,
    index,
    ...detail,
  });
}

/**
 * Log a summary of per-bot screenshot stats.
 * Call periodically or at end of run.
 */
export function diagFlushSummary(): void {
  for (const [botId, s] of stats.entries()) {
    diagLogger.info('summary', {
      side: 'main',
      event: 'summary',
      botId,
      captured: s.captured,
      sent: s.sent,
      skipped: s.skipped,
      lastCaptureMs: s.lastCaptureMs,
    });
  }
}

/**
 * Reset all counters (call on new run).
 */
export function diagReset(): void {
  stats.clear();
}

/**
 * Return the path to the diagnostic log directory.
 */
export function getDiagLogPath(): string {
  return getDiagLogDir();
}

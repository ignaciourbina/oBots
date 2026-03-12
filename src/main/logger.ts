// src/main/logger.ts
// ──────────────────────────────────────────────────────────────
// Centralized logging built on winston.
//
// - File transport: JSON lines, daily-rotated, kept for 14 days
// - Error file transport: errors only, kept for 30 days
//
// Usage:
//   import { logger, createChildLogger } from './logger';
//   logger.info('global message');
//
//   const log = createChildLogger('bot-runner');
//   log.info('scoped message');          // → [bot-runner] scoped message
//
//   const botLog = createChildLogger('bot', { botId: 'abc-123' });
//   botLog.warn('timeout');             // → [bot] timeout  { botId: 'abc-123' }
// ──────────────────────────────────────────────────────────────

import path from 'path';
import { app } from 'electron';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// ── Log directory ────────────────────────────────────────────
// Use the Electron userData folder so logs persist across runs.
// Falls back to <project>/logs for dev (before app is ready).

function getLogDir(): string {
  try {
    return path.join(app.getPath('userData'), 'logs');
  } catch {
    // app not ready yet — use project-local folder
    return path.join(process.cwd(), 'logs');
  }
}

// ── Formats ──────────────────────────────────────────────────

const { combine, timestamp, errors, json, splat } = winston.format;

/** Structured JSON format for file transport */
const fileFmt = combine(
  timestamp(),
  errors({ stack: true }),
  splat(),
  json(),
);

// ── Transports ───────────────────────────────────────────────

const fileTransport = new DailyRotateFile({
  dirname: getLogDir(),
  filename: 'obots-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: fileFmt,
  level: 'debug',       // file always captures debug+
});

const errorFileTransport = new DailyRotateFile({
  dirname: getLogDir(),
  filename: 'obots-error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '30d',
  format: fileFmt,
  level: 'error',       // only errors go here
});

// ── Root Logger ──────────────────────────────────────────────

export const logger = winston.createLogger({
  level: 'info',         // default — raised to 'debug' by setVerbose()
  transports: [
    fileTransport,
    errorFileTransport,
  ],
  // Don't crash the app on logging failures
  exitOnError: false,
});

// ── API ──────────────────────────────────────────────────────

/**
 * Enable verbose (debug-level) file output.
 * Called when `--verbose` is passed on the CLI.
 */
export function setVerbose(enabled: boolean): void {
  if (enabled) {
    logger.level = 'debug';
    logger.debug('Verbose logging enabled');
  }
}

/**
 * Create a child logger scoped to a specific component.
 * All messages carry the component label + any extra defaultMeta.
 *
 * @param component  Short label (e.g. 'main', 'fsm', 'bot-runner')
 * @param meta       Extra key-value pairs attached to every message
 */
export function createChildLogger(
  component: string,
  meta: Record<string, unknown> = {},
): winston.Logger {
  return logger.child({ component, ...meta });
}

/**
 * Return the resolved path where log files are written.
 */
export function getLogPath(): string {
  return getLogDir();
}

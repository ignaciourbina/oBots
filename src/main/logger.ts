// src/main/logger.ts
// ──────────────────────────────────────────────────────────────
// Centralized logging built on winston.
//
// - Console transport: coloured, human-readable
// - File transport: JSON lines, daily-rotated, kept for 14 days
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

const { combine, timestamp, printf, colorize, errors, json, splat } = winston.format;

/** Pretty console format: 2026-02-19 14:05:32 [main] INFO  message */
const consoleFmt = combine(
  colorize({ level: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  printf(({ timestamp: ts, level, message, component, ...rest }) => {
    const comp = component ? `[${component}]` : '[app]';
    const meta = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
    return `${ts} ${comp} ${level}: ${message}${meta}`;
  }),
);

/** Structured JSON format for file transport */
const fileFmt = combine(
  timestamp(),
  errors({ stack: true }),
  splat(),
  json(),
);

// ── Transports ───────────────────────────────────────────────

const consoleTransport = new winston.transports.Console({
  format: consoleFmt,
});

const fileTransport = new DailyRotateFile({
  dirname: getLogDir(),
  filename: 'otree-bots-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: fileFmt,
  level: 'debug',       // file always captures debug+
});

const errorFileTransport = new DailyRotateFile({
  dirname: getLogDir(),
  filename: 'otree-bots-error-%DATE%.log',
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
    consoleTransport,
    fileTransport,
    errorFileTransport,
  ],
  // Don't crash the app on logging failures
  exitOnError: false,
});

// ── API ──────────────────────────────────────────────────────

/**
 * Enable verbose (debug-level) output on the console transport.
 * Called when `--verbose` is passed on the CLI.
 */
export function setVerbose(enabled: boolean): void {
  if (enabled) {
    logger.level = 'debug';
    consoleTransport.level = 'debug';
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

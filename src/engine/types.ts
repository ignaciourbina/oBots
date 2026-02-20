// src/engine/types.ts
// ──────────────────────────────────────────────────────────────
// Shared TypeScript interfaces — the canonical type definitions
// for bot scripts, bot instances, grid layout, IPC, and config.
// ──────────────────────────────────────────────────────────────

import type { Browser, Page } from 'puppeteer';

// ── Bot Script (user-authored) ──────────────────────────────

/**
 * A BotScript defines the finite-state-machine that drives one bot
 * through an oTree game session.
 */
export interface BotScript {
  /** Human-readable name shown in the grid tile */
  name: string;

  /** Initial state id */
  initialState: string;

  /** Map of stateId → StateDefinition */
  states: Record<string, StateDefinition>;

  /** Optional: per-bot config overrides */
  config?: BotConfig;
}

export interface StateDefinition {
  /** Actions to execute sequentially when entering this state */
  onEntry: Action[];

  /** Transitions evaluated in order; first matching guard wins */
  transitions: Transition[];

  /** If true, this is a terminal state — bot stops here */
  final?: boolean;
}

export interface Transition {
  /** Target state id */
  target: string;
  /** Guard condition — must resolve true to take this transition */
  guard?: Guard;
  /** Delay in ms before evaluating this transition (polling interval) */
  delay?: number;
}

export type ActionType =
  | 'click'
  | 'clickAndNavigate'
  | 'fill'
  | 'select'
  | 'wait'
  | 'waitForNavigation'
  | 'waitForSelector'
  | 'reload'
  | 'evaluate'
  | 'fillFormFields'
  | 'screenshot'
  | 'log';

export interface Action {
  /** Built-in action type */
  type: ActionType;
  /** CSS selector (for click, fill, select, waitForSelector) */
  selector?: string;
  /** Value (for fill, select, evaluate, wait, log) */
  value?: string | number | boolean;
  /** Timeout in ms */
  timeout?: number;
  /** Strategy config (for fillFormFields) */
  strategyConfig?: BotStrategy;
}

export type GuardType =
  | 'elementExists'
  | 'elementNotExists'
  | 'urlContains'
  | 'urlEquals'
  | 'textContains'
  | 'custom';

export interface Guard {
  type: GuardType;
  selector?: string;
  value?: string;
  /** For 'custom': a function body string to evaluate */
  fn?: string;
}

export interface BotConfig {
  /** Viewport width */
  viewportWidth?: number;
  /** Viewport height */
  viewportHeight?: number;
  /** User-agent override */
  userAgent?: string;
  /** Proxy address (future — pinned) */
  proxy?: string;
  /** Extra launch args for Chromium */
  chromiumArgs?: string[];
}

// ── Bot Instance (runtime) ──────────────────────────────────

export type BotStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  screenshotDataUrl?: string;
}

export interface BotInstance {
  id: string;
  index: number;
  script: BotScript;
  currentState: string;
  status: BotStatus;
  browser: Browser | null;
  page: Page | null;
  webviewId: string | null;
  logs: LogEntry[];
  error?: string;
}

/** Serializable subset of BotInstance for IPC transport */
export interface SerializedBot {
  id: string;
  index: number;
  scriptName: string;
  currentState: string;
  status: BotStatus;
  logs: LogEntry[];
  error?: string;
}

// ── Grid Layout ─────────────────────────────────────────────

export interface GridCell {
  slotIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridLayout {
  cols: number;
  rows: number;
  cells: GridCell[];
}

export interface GridSlot {
  slotIndex: number;
  botId: string;
  label: string;
  status: BotStatus;
  currentState: string;
  thumbnailDataUrl?: string;
}

// ── IPC Channels ────────────────────────────────────────────

export enum IpcChannel {
  // Main → Renderer
  GRID_LAYOUT      = 'grid:layout',
  BOT_STATUS       = 'bot:status',
  BOT_STATE_CHANGE = 'bot:state-change',
  BOT_LOG          = 'bot:log',
  BOT_SCREENSHOT   = 'bot:screenshot',
  ALL_DONE         = 'run:all-done',

  // Renderer → Main
  CMD_START        = 'cmd:start',
  CMD_STOP         = 'cmd:stop',
  CMD_RESTART      = 'cmd:restart',
  CMD_PAUSE        = 'cmd:pause-bot',
  CMD_RESUME       = 'cmd:resume-bot',
  CMD_FOCUS        = 'cmd:focus-bot',
  SCREENSHOT_DIAG  = 'diag:screenshot',

  // Main → Grid BrowserViews (per-bot processes)
  BOTVIEW_SCREENSHOT = 'botview:screenshot',
  BOTVIEW_INFO       = 'botview:info',
  BOTVIEW_STATUS     = 'botview:status',
  BOTVIEW_STATE      = 'botview:state',

  // Grid BrowserView → Main
  CMD_OPEN_DRAWER    = 'cmd:open-drawer',

  // Renderer → Main (drawer state)
  CMD_DRAWER_TOGGLE  = 'cmd:drawer-toggle',

  // Main → Focus window
  FOCUS_SCREENSHOT = 'focus:screenshot',
  FOCUS_BOT_INFO   = 'focus:bot-info',
  FOCUS_BOT_LOG    = 'focus:bot-log',
  FOCUS_BOT_STATUS = 'focus:bot-status',
  FOCUS_BOT_STATE  = 'focus:bot-state',
}

// ── Bot Strategy (form-filling profile) ─────────────────────

/** How to fill number inputs */
export type NumberStrategy = 'min' | 'max' | 'midpoint' | 'random' | 'fixed';
/** How to pick dropdown options */
export type SelectStrategy = 'first' | 'last' | 'random';
/** How to pick radio buttons within a group */
export type RadioStrategy = 'first' | 'last' | 'random';
/** How to handle checkboxes */
export type CheckboxStrategy = 'all' | 'none' | 'random';

/**
 * A BotStrategy configures how the auto-player fills form fields.
 * This makes the bot game-agnostic — no hardcoded behaviour per game.
 */
export interface BotStrategy {
  /** Human-readable label for the strategy */
  name: string;
  /** How to fill <input type="number"> */
  numberStrategy: NumberStrategy;
  /** Fixed value for numbers when numberStrategy is 'fixed' (clamped to min/max) */
  numberFixedValue: number;
  /** Default text for <input type="text"> */
  textValue: string;
  /** How to pick <select> options */
  selectStrategy: SelectStrategy;
  /** How to pick radio buttons */
  radioStrategy: RadioStrategy;
  /** How to handle checkboxes */
  checkboxStrategy: CheckboxStrategy;
  /** Milliseconds to wait before clicking submit (0 = immediate) */
  submitDelay: number;
  /** Milliseconds to wait between each action / field interaction (0 = fast) */
  actionDelayMs: number;
}

/** Built-in strategy presets */
export const STRATEGY_PRESETS: Record<string, BotStrategy> = {
  random: {
    name: 'Random',
    numberStrategy: 'random',
    numberFixedValue: 5,
    textValue: 'test',
    selectStrategy: 'random',
    radioStrategy: 'random',
    checkboxStrategy: 'random',
    submitDelay: 0,
    actionDelayMs: 300,
  },
  minimum: {
    name: 'Minimum',
    numberStrategy: 'min',
    numberFixedValue: 0,
    textValue: 'a',
    selectStrategy: 'first',
    radioStrategy: 'first',
    checkboxStrategy: 'none',
    submitDelay: 0,
    actionDelayMs: 300,
  },
  maximum: {
    name: 'Maximum',
    numberStrategy: 'max',
    numberFixedValue: 100,
    textValue: 'test response',
    selectStrategy: 'last',
    radioStrategy: 'last',
    checkboxStrategy: 'all',
    submitDelay: 0,
    actionDelayMs: 300,
  },
  midpoint: {
    name: 'Midpoint',
    numberStrategy: 'midpoint',
    numberFixedValue: 50,
    textValue: 'test',
    selectStrategy: 'first',
    radioStrategy: 'first',
    checkboxStrategy: 'all',
    submitDelay: 0,
    actionDelayMs: 300,
  },
  fixed: {
    name: 'Fixed (5)',
    numberStrategy: 'fixed',
    numberFixedValue: 5,
    textValue: 'test',
    selectStrategy: 'first',
    radioStrategy: 'first',
    checkboxStrategy: 'all',
    submitDelay: 0,
    actionDelayMs: 300,
  },
};

export const DEFAULT_STRATEGY: BotStrategy = STRATEGY_PRESETS.random;

// ── Configuration ───────────────────────────────────────────

export interface AppConfig {
  url: string;
  playerCount: number;
  scriptPath: string;
  cols?: number;
  delayMultiplier: number;
  headless: boolean;
  debug: boolean;
  strategy: BotStrategy;
}

export const DEFAULTS = {
  playerCount: 2,
  gridCols: 'auto' as const,
  actionDelayMultiplier: 1.0,
  pollIntervalMs: 250,
  maxPollTimeMs: 120_000,
  // Base minimum interval for screenshot attempts.
  screenshotIntervalMs: 16,
  // Global FPS budget for all bots combined.
  screenshotGlobalFpsBudget: 120,
  // Per-bot caps after budget allocation by active bot count.
  screenshotMinPerBotFps: 4,
  screenshotMaxPerBotFps: 20,
  // Lower JPEG quality improves throughput when many bots are active.
  screenshotQuality: 40,
  // Smaller capture viewport reduces encode/decode cost per frame.
  captureViewportWidth: 640,
  captureViewportHeight: 360,
  // Max time (ms) to wait for a single page.screenshot() CDP call.
  // Prevents the 180 s Puppeteer protocolTimeout from freezing the
  // capture loop when a screenshot overlaps a page navigation.
  screenshotCaptureTimeoutMs: 5_000,
  navigationTimeoutMs: 30_000,
  actionTimeoutMs: 10_000,
  retryCount: 2,
  retryBackoffMs: 1_000,
  chromiumArgs: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-infobars',
    '--disable-extensions',
  ] as readonly string[],
} as const;

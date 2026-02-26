// src/main/bot-runner.ts
// ──────────────────────────────────────────────────────────────
// Spawns Puppeteer browsers, navigates to the join URL,
// attaches the FSM engine, and manages CDP screencasts for both
// grid tiles (BrowserViews) and focus (zoom) windows.
// ──────────────────────────────────────────────────────────────

import path from 'path';
import puppeteer, { Browser, CDPSession } from 'puppeteer';
import { BrowserWindow } from 'electron';
import {
  BotInstance,
  DEFAULTS,
  IpcChannel,
  LogEntry,
} from '../engine/types';
import { StateMachineRunner, FSMCallbacks } from '../engine/state-machine';
import { SessionRegistry } from './session-registry';
import { createChildLogger } from './logger';
import { GridManager } from './grid-manager';

interface FocusSession {
  win: BrowserWindow;
  cdp: CDPSession;
}

interface GridScreencast {
  cdp: CDPSession;
  active: boolean;
}

export class BotRunner {
  private runners: Map<string, StateMachineRunner> = new Map();
  private gridScreencasts: Map<string, GridScreencast> = new Map();
  private focusSessions: Map<string, FocusSession> = new Map();
  private readonly syslog = createChildLogger('bot-runner');
  private gridManager: GridManager | null = null;
  private allDoneCallback: (() => void) | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly registry: SessionRegistry,
    private readonly delayMultiplier: number = 1.0,
  ) {}

  /**
   * Set the grid manager reference so the bot-runner can forward
   * screencast frames and status updates to per-bot BrowserViews.
   */
  setGridManager(gm: GridManager): void {
    this.gridManager = gm;
  }

  /**
   * Register a callback that fires when all bots finish.
   * Used by the main process for repeat-round logic.
   */
  setAllDoneCallback(cb: (() => void) | null): void {
    this.allDoneCallback = cb;
  }

  /** Send IPC to the main window, guarding against a destroyed window during shutdown. */
  private safeSend(channel: string, ...args: unknown[]): void {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(channel, ...args);
    }
  }

  /**
   * Launch a Chromium browser instance for the given bot.
   */
  async launchBrowser(bot: BotInstance): Promise<void> {
    const extraArgs = bot.script.config?.chromiumArgs ?? [];

    const browser: Browser = await puppeteer.launch({
      headless: true,  // headless for PoC — screenshots piped to Electron grid
      defaultViewport: {
        width: bot.script.config?.viewportWidth ?? DEFAULTS.captureViewportWidth,
        height: bot.script.config?.viewportHeight ?? DEFAULTS.captureViewportHeight,
      },
      args: [
        ...DEFAULTS.chromiumArgs,
        ...extraArgs,
      ],
    });

    const pages = await browser.pages();
    const page = pages[0] ?? await browser.newPage();

    // Apply user-agent override if configured
    if (bot.script.config?.userAgent) {
      await page.setUserAgent(bot.script.config.userAgent);
    }

    bot.browser = browser;
    bot.page = page;

    this.registry.updateStatus(bot.id, 'idle');
    this.syslog.info('Browser launched for bot #%d (%s)', bot.index, bot.id);
    this.log(bot.id, 'info', `Browser launched for bot #${bot.index}`);
  }

  /**
   * Navigate the bot's page to the target URL.
   */
  async navigate(bot: BotInstance, url: string): Promise<void> {
    if (!bot.page) throw new Error(`Bot ${bot.id} has no page`);

    this.syslog.info('Bot %s navigating to %s', bot.id, url);
    this.log(bot.id, 'info', `Navigating to ${url}`);
    await bot.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULTS.navigationTimeoutMs,
    });
    this.syslog.info('Bot %s navigation complete: %s', bot.id, bot.page.url());
    this.log(bot.id, 'info', `Navigation complete: ${bot.page.url()}`);
  }

  /**
   * Start the FSM for the given bot.
   */
  async startFSM(bot: BotInstance, actionDelayMs: number = 0, actionJitterMs: number = 0): Promise<void> {
    if (!bot.page) throw new Error(`Bot ${bot.id} has no page — launch browser first`);

    const callbacks: FSMCallbacks = {
      onStateChange: (botId, newState) => {
        this.syslog.debug('Bot %s → state %s', botId, newState);
        this.registry.updateCurrentState(botId, newState);
        this.safeSend(IpcChannel.BOT_STATE_CHANGE, {
          id: botId,
          index: bot.index,
          state: newState,
        });
        // Forward to grid BrowserView
        this.gridManager?.sendBotState(botId, newState);
        // Forward to focus window if open
        this.sendToFocus(botId, IpcChannel.FOCUS_BOT_STATE, newState);
      },
      onLog: (botId, entry) => {
        this.syslog[entry.level]('Bot %s: %s', botId, entry.message);
        this.registry.addLog(botId, entry);
        this.safeSend(IpcChannel.BOT_LOG, {
          id: botId,
          index: bot.index,
          entry,
        });
        // Forward to focus window if open
        this.sendToFocus(botId, IpcChannel.FOCUS_BOT_LOG, entry);
      },
      onStatusChange: (botId, status) => {
        this.syslog.info('Bot %s status → %s', botId, status);
        this.registry.updateStatus(botId, status);
        this.safeSend(IpcChannel.BOT_STATUS, {
          id: botId,
          index: bot.index,
          status,
        });
        // Forward to grid BrowserView
        this.gridManager?.sendBotStatus(botId, status);
        // Forward to focus window if open
        this.sendToFocus(botId, IpcChannel.FOCUS_BOT_STATUS, status);

        // Stop grid screencast when bot finishes
        if (status === 'done' || status === 'error') {
          this.stopGridScreencast(botId);
        }

        // Check if all bots finished
        if (this.registry.allFinished()) {
          this.safeSend(IpcChannel.ALL_DONE);
          this.allDoneCallback?.();
        }
      },
      onError: (botId, error) => {
        this.syslog.error('Bot %s error: %s', botId, error.message);
        this.registry.setError(botId, error.message);
      },
    };

    const runner = new StateMachineRunner(
      bot.id,
      bot.script,
      bot.page,
      callbacks,
      this.delayMultiplier,
      actionDelayMs,
      actionJitterMs,
    );

    this.runners.set(bot.id, runner);

    // Start CDP screencast for the grid tile (replaces old screenshot loop)
    await this.startGridScreencast(bot);

    // Run the FSM (async — don't await, let it run in background)
    runner.run().catch((err) => {
      this.syslog.error('FSM error for bot %s: %s', bot.id, err instanceof Error ? err.message : String(err));
    });
  }

  /**
   * Pause a specific bot's FSM.
   */
  pauseBot(botId: string): void {
    const runner = this.runners.get(botId);
    if (runner) runner.pause();
  }

  /**
   * Resume a paused bot's FSM.
   */
  resumeBot(botId: string): void {
    const runner = this.runners.get(botId);
    if (runner) runner.resume();
  }

  /**
   * Force-finish a bot that appears stalled.
   * Marks it as done through the same status pipeline used by normal completion.
   */
  forceFinishBot(botId: string, reason: string): boolean {
    const bot = this.registry.getBot(botId);
    if (!bot) {
      this.syslog.warn('Cannot force-finish unknown bot %s', botId);
      return false;
    }

    if (bot.status === 'done' || bot.status === 'error') {
      return false;
    }

    this.syslog.warn('Force-finishing bot %s: %s', botId, reason);
    this.log(botId, 'warn', `Force-finished: ${reason}`);

    const runner = this.runners.get(botId);
    if (runner) {
      runner.stop();
      return true;
    }

    // Fallback path if runner is missing but registry still says non-terminal.
    this.registry.updateStatus(botId, 'done');
    this.safeSend(IpcChannel.BOT_STATUS, {
      id: botId,
      index: bot.index,
      status: 'done',
    });
    this.gridManager?.sendBotStatus(botId, 'done');
    this.sendToFocus(botId, IpcChannel.FOCUS_BOT_STATUS, 'done');
    this.stopGridScreencast(botId);

    if (this.registry.allFinished()) {
      this.safeSend(IpcChannel.ALL_DONE);
      this.allDoneCallback?.();
    }

    return true;
  }

  /**
   * Open a floating focus window for a specific bot.
   * Uses CDP Page.startScreencast for real-time live frames.
   * If one is already open, focus it instead of creating a duplicate.
   */
  async openFocusWindow(botId: string): Promise<void> {
    const existing = this.focusSessions.get(botId);
    if (existing && !existing.win.isDestroyed()) {
      existing.win.focus();
      return;
    }

    const bot = this.registry.getBot(botId);
    if (!bot?.page) {
      this.syslog.warn('Cannot open focus window: bot %s has no page', botId);
      return;
    }

    const label = bot ? `Bot #${bot.index}` : botId;

    const focusPreload = path.join(__dirname, 'focus-preload.js');
    const focusWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: `Focus — ${label}`,
      autoHideMenuBar: true,
      webPreferences: {
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true,
        preload: focusPreload,
      },
    });
    // Remove menu entirely so it can't be toggled with Alt
    focusWin.setMenu(null);

    const htmlPath = path.join(__dirname, '..', 'renderer', 'focus.html');
    await focusWin.loadFile(htmlPath);

    // Send initial bot identity + backfilled logs
    focusWin.webContents.send(IpcChannel.FOCUS_BOT_INFO, {
      id: bot.id,
      index: bot.index,
      status: bot.status,
      currentState: bot.currentState,
      logs: bot.logs,
    });

    // Resize the bot's Puppeteer viewport to match the focus window
    const [cw, ch] = focusWin.getContentSize();
    await bot.page.setViewport({ width: cw, height: ch });

    // Start CDP screencast — real-time frame events from the browser
    const cdp = await bot.page.createCDPSession();

    cdp.on('Page.screencastFrame', (params: { data: string; sessionId: number }) => {
      if (!focusWin.isDestroyed()) {
        focusWin.webContents.send(
          IpcChannel.FOCUS_SCREENSHOT,
          `data:image/jpeg;base64,${params.data}`,
        );
      }
      // Acknowledge frame so CDP keeps sending
      cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
    });

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      maxWidth: cw,
      maxHeight: ch,
      everyNthFrame: 1,
    });

    // Re-sync viewport + screencast when focus window is resized
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    focusWin.on('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(async () => {
        if (focusWin.isDestroyed() || !bot.page) return;
        const [w, h] = focusWin.getContentSize();
        await bot.page.setViewport({ width: w, height: h });
        await cdp.send('Page.stopScreencast').catch(() => {});
        await cdp.send('Page.startScreencast', {
          format: 'jpeg',
          quality: 80,
          maxWidth: w,
          maxHeight: h,
          everyNthFrame: 1,
        }).catch(() => {});
      }, 200);
    });

    this.focusSessions.set(botId, { win: focusWin, cdp });
    this.syslog.info('Focus window opened (live screencast) for %s', label);

    // Store original viewport to restore on close
    const origWidth = bot.script.config?.viewportWidth ?? DEFAULTS.captureViewportWidth;
    const origHeight = bot.script.config?.viewportHeight ?? DEFAULTS.captureViewportHeight;

    focusWin.on('closed', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      cdp.send('Page.stopScreencast').catch(() => {});
      cdp.detach().catch(() => {});
      this.focusSessions.delete(botId);
      // Restore original viewport
      bot.page?.setViewport({ width: origWidth, height: origHeight }).catch(() => {});
      this.syslog.debug('Focus window closed for %s', label);
    });
  }

  /**
   * Stop all bots and clean up.
   */
  async stopAll(): Promise<void> {
    // Stop all grid screencasts
    for (const [botId, gs] of this.gridScreencasts) {
      gs.active = false;
      gs.cdp.send('Page.stopScreencast').catch(() => {});
      gs.cdp.detach().catch(() => {});
    }
    this.gridScreencasts.clear();

    // Stop all FSM runners
    for (const runner of this.runners.values()) {
      runner.stop();
    }

    // Close all focus windows and stop their screencasts
    for (const { win, cdp } of this.focusSessions.values()) {
      cdp.send('Page.stopScreencast').catch(() => {});
      cdp.detach().catch(() => {});
      if (!win.isDestroyed()) win.close();
    }
    this.focusSessions.clear();

    // Destroy all BrowserViews
    this.gridManager?.destroyAllViews();

    // Destroy all browsers via registry
    await this.registry.destroyAll();
    this.runners.clear();
  }

  // ── Grid CDP Screencast ───────────────────────────────

  /**
   * Start a CDP screencast for a bot and pipe frames to its
   * grid BrowserView. This is the same approach used by the
   * focus window — push-based, no polling.
   */
  private async startGridScreencast(bot: BotInstance): Promise<void> {
    if (!bot.page || !this.gridManager) return;

    const botView = this.gridManager.getBotView(bot.id);
    if (!botView) {
      this.syslog.warn('No BrowserView found for bot %s, skipping grid screencast', bot.id);
      return;
    }

    // Use the BrowserView's current bounds to size the screencast
    const bounds = botView.view.getBounds();
    // Subtract 24px for the bot header bar inside bot-view.html
    const headerH = 24;
    const scW = Math.max(160, bounds.width);
    const scH = Math.max(90, bounds.height - headerH);

    const cdp = await bot.page.createCDPSession();

    const gs: GridScreencast = { cdp, active: true };
    this.gridScreencasts.set(bot.id, gs);

    cdp.on('Page.screencastFrame', (params: { data: string; sessionId: number }) => {
      if (gs.active) {
        this.gridManager?.sendScreenshot(
          bot.id,
          `data:image/jpeg;base64,${params.data}`,
        );
      }
      // Acknowledge frame so CDP keeps sending
      cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
    });

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,       // lower quality for grid tiles (small)
      maxWidth: scW,
      maxHeight: scH,
      everyNthFrame: 1,
    });

    this.syslog.info('Grid screencast started for bot #%d (%s) — %d×%d',
      bot.index, bot.id, scW, scH);

    // Send initial bot info to the BrowserView
    this.gridManager.sendBotInfo(bot.id, {
      id: bot.id,
      index: bot.index,
      status: bot.status,
      currentState: bot.currentState,
    });
  }

  /**
   * Stop a specific bot's grid screencast (e.g. when bot finishes).
   */
  private stopGridScreencast(botId: string): void {
    const gs = this.gridScreencasts.get(botId);
    if (gs) {
      gs.active = false;
      gs.cdp.send('Page.stopScreencast').catch(() => {});
      gs.cdp.detach().catch(() => {});
      this.gridScreencasts.delete(botId);
      this.syslog.debug('Grid screencast stopped for %s', botId);
    }
  }

  // ── Helpers ───────────────────────────────────────────

  /** Send an IPC message to the focus window for a specific bot (if open). */
  private sendToFocus(botId: string, channel: string, data: unknown): void {
    const session = this.focusSessions.get(botId);
    if (session && !session.win.isDestroyed()) {
      session.win.webContents.send(channel, data);
    }
  }

  private log(botId: string, level: LogEntry['level'], message: string): void {
    const entry: LogEntry = { timestamp: Date.now(), level, message };
    this.registry.addLog(botId, entry);
    this.safeSend(IpcChannel.BOT_LOG, { id: botId, entry });
  }

}

// src/main/index.ts
// ──────────────────────────────────────────────────────────────
// Electron main process entry point.
// Creates the BrowserWindow, orchestrates bot launch, wires IPC.
// ──────────────────────────────────────────────────────────────

import path from 'path';
import { app, BrowserWindow } from 'electron';
import { AppConfig, BotScript, DEFAULT_STRATEGY, DEFAULTS, BotStrategy, IpcChannel, isTerminalStatus, UrlInjectionConfig } from '../engine/types';
import type { MessageCategory } from '../engine/message-bank';
import { parseCLI } from './cli';
import { GridManager } from './grid-manager';
import { SessionRegistry } from './session-registry';
import { BotRunner } from './bot-runner';
import { registerIpcHandlers, removeIpcHandlers, StartPayload, StrategyPayload } from './ipc-handlers';
import { createChildLogger, setVerbose, getLogPath } from './logger';
import { createAutoPlayer } from '../scripts/auto-player';
import { DropoutSimulator } from './dropout-simulator';
import { attachContextMenu } from './context-menu';

const log = createChildLogger('main');

// ── Linux sandbox fix ───────────────────────────────────────
// Packaged Electron on Linux (deb/AppImage) triggers SIGTRAP if
// the chrome-sandbox helper lacks SUID permissions.  Disable the
// Chromium sandbox at the process level — safe for a local-only
// research/automation tool.
app.commandLine.appendSwitch('no-sandbox');
// Fallback: some GPU drivers cause crashes in the GPU process;
// using the software rasterizer avoids that.
app.commandLine.appendSwitch('disable-gpu-sandbox');
// Some Linux environments have /dev/shm unavailable or misconfigured,
// which causes Chromium to crash at startup.
app.commandLine.appendSwitch('disable-dev-shm-usage');

// ── Globals ─────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let gridManager: GridManager;
let registry: SessionRegistry;
let botRunner: BotRunner;
let baseConfig: AppConfig;
let currentPlayerCount = 0;
let runStarted = false;
let runStarting = false;
let layoutRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let runStartedAt: number | null = null;
let overviewWindow: BrowserWindow | null = null;
let overviewTimer: ReturnType<typeof setInterval> | null = null;
let repeatCurrentRound = 0;
let repeatTotalRounds = 1;
let lastRunConfig: AppConfig | null = null;
let isRepeating = false;
let budgetWatchdogTimer: ReturnType<typeof setInterval> | null = null;
/** Active runtime budget (ms). 0 = no limit. Set from runConfig each run. */
let activeBotMaxRuntimeMs: number = DEFAULTS.botMaxRuntimeMs;
const dropoutSimulator = new DropoutSimulator();

interface OverviewSnapshot {
  timestamp: number;
  expectedBots: number;
  finishedBots: number;
  runStartedAt: number | null;
  currentRound: number;
  totalRounds: number;
  bots: Array<{
    id: string;
    index: number;
    status: string;
    currentState: string;
    logCount: number;
    error?: string;
  }>;
}

// ── Window Creation ─────────────────────────────────────────

async function createWindow(config: AppConfig): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, 'preload.js');
  log.debug('Preload path: %s', preloadPath);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'oBots — Open Bot Online Testing Suite',
    webPreferences: {
      sandbox: false,           // allow require() in preload
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  attachContextMenu(win.webContents);

  // Attach console listener BEFORE loading the page so we catch
  // every message including preload and renderer startup.
  const rendererLog = createChildLogger('renderer');
  win.webContents.on('console-message', (_ev, level, msg, line, sourceId) => {
    const logLevel = level === 2 ? 'error' : level === 1 ? 'warn' : 'debug';
    rendererLog.log(logLevel, '%s  (%s:%d)', msg, sourceId, line);
  });

  // Log any page-level errors
  win.webContents.on('did-fail-load', (_ev, code, desc) => {
    log.error('Page failed to load: %d %s', code, desc);
  });

  // Load the renderer HTML and wait for it to finish
  const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  log.debug('Loading renderer HTML: %s', htmlPath);
  await win.loadFile(htmlPath, {
    query: {
      defaultUrl: config.url ?? '',
      defaultPlayers: String(config.playerCount),
    },
  });
  log.info('Renderer HTML loaded successfully');

  return win;
}

// ── Bot Script Loading ──────────────────────────────────────

function loadBotScript(scriptPath: string): BotScript {
  const resolvedPath = path.resolve(scriptPath);
  log.debug('Loading bot script: %s', resolvedPath);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(resolvedPath);
  const script: BotScript = mod.default ?? mod;

  // Basic validation
  if (!script.name || !script.initialState || !script.states) {
    throw new Error(
      `Invalid bot script at ${resolvedPath}. ` +
      `Must export { name, initialState, states }.`,
    );
  }

  if (!script.states[script.initialState]) {
    throw new Error(
      `Bot script initial state "${script.initialState}" not found in states.`,
    );
  }

  log.info('Bot script loaded: "%s" with %d states', script.name, Object.keys(script.states).length);
  return script;
}

// ── Orchestrator ────────────────────────────────────────────

/**
 * Validate and normalize a start payload received from the renderer setup form.
 */
function normalizeStartPayload(payload: StartPayload): StartPayload {
  const url = payload.url?.trim();
  const playerCount = Number(payload.playerCount);
  const dropoutRatePercent = payload.dropoutRatePercent == null
    ? undefined
    : Number(payload.dropoutRatePercent);

  if (!url) {
    throw new Error('URL is required.');
  }
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new Error('Player count must be an integer >= 1.');
  }
  if (dropoutRatePercent != null && (!Number.isFinite(dropoutRatePercent) || dropoutRatePercent < 0 || dropoutRatePercent > 100)) {
    throw new Error('Dropout % must be between 0 and 100.');
  }
  if (payload.urlInjection?.enabled) {
    try {
      void new URL(url);
    } catch {
      throw new Error('URL injection requires an absolute URL (including http:// or https://).');
    }
  }

  return {
    url,
    urlInjection: payload.urlInjection,
    playerCount,
    dropoutRatePercent,
    botMaxRuntimeMs: payload.botMaxRuntimeMs,
    strategy: payload.strategy,
    repeatRounds: payload.repeatRounds,
  };
}

function randomToken(length = 8): string {
  const token = Math.random().toString(36).slice(2);
  if (token.length >= length) return token.slice(0, length);
  return (token + Math.random().toString(36).slice(2)).slice(0, length);
}

function resolveInjectionTemplate(
  template: string,
  botIndex: number,
  runContext: { runTs: string; runRand: string },
): string {
  return template
    .replaceAll('{bot}', String(botIndex + 1))
    .replaceAll('{bot0}', String(botIndex))
    .replaceAll('{runTs}', runContext.runTs)
    .replaceAll('{runRand}', runContext.runRand)
    .replaceAll('{ts}', String(Date.now()))
    .replaceAll('{rand}', randomToken(6));
}

function buildBotNavigationUrl(
  baseUrl: string,
  botIndex: number,
  urlInjection: UrlInjectionConfig | undefined,
  runContext: { runTs: string; runRand: string },
): string {
  if (!urlInjection?.enabled) {
    return baseUrl;
  }

  const url = new URL(baseUrl);

  const participantTemplate = urlInjection.participantIdTemplate?.trim() || 'participant-{runTs}-{bot}-{rand}';
  const assignmentTemplate = urlInjection.assignmentIdTemplate?.trim() || 'assignment-{runTs}-{bot}';
  const projectTemplate = urlInjection.projectIdTemplate?.trim() || 'project-{runTs}';

  url.searchParams.set('participantId', resolveInjectionTemplate(participantTemplate, botIndex, runContext));
  url.searchParams.set('assignmentId', resolveInjectionTemplate(assignmentTemplate, botIndex, runContext));
  url.searchParams.set('projectId', resolveInjectionTemplate(projectTemplate, botIndex, runContext));

  return url.toString();
}

/**
 * Launch bots for a validated run config.
 */
async function launchBots(config: AppConfig): Promise<void> {
  dropoutSimulator.clearAll();
  currentPlayerCount = config.playerCount;
  const runContext = {
    runTs: String(Date.now()),
    runRand: randomToken(8),
  };

  log.info('Starting run', {
    url: config.url,
    players: config.playerCount,
    dropoutRatePercent: config.dropoutRatePercent,
    strategy: config.strategy.name,
    cols: config.cols ?? 'auto',
    delay: config.delayMultiplier,
  });

  const layout = gridManager.computeLayout(config.playerCount, config.cols);
  log.info('Grid layout computed: %d×%d, %d cells', layout.cols, layout.rows, layout.cells.length);
  gridManager.broadcastLayout();

  // Create BrowserViews for each bot slot FIRST (one per-bot renderer process)
  // This distributes rendering across CPU cores naturally.
  const script = createAutoPlayer(config.strategy);
  const bots = await Promise.all(
    Array.from({ length: config.playerCount }, async (_, i) => {
      const bot = registry.createBot(i, script);
      const botView = await gridManager.createBotView(i, bot.id);
      log.info('BrowserView created for bot #%d (%s) pid=%d',
        i, bot.id, botView.view.webContents.getOSProcessId());
      return bot;
    }),
  );

  // Launch all bots concurrently — each gets its own browser + page
  const launchPromises = bots.map(async (bot) => {
    log.info('Launching bot #%d (%s)', bot.index, bot.id);

    try {
      const navigationUrl = buildBotNavigationUrl(config.url, bot.index, config.urlInjection, runContext);
      await botRunner.launchBrowser(bot);
      await botRunner.navigate(bot, navigationUrl);
      await botRunner.startFSM(bot, config.strategy.actionDelayMs ?? 0, config.strategy.actionJitterMs ?? 0, config.strategy);
    } catch (err) {
      log.error('Failed to start bot #%d: %s', bot.index, err instanceof Error ? err.message : String(err));
      registry.setError(bot.id, err instanceof Error ? err.message : String(err));
    }
  });

  await Promise.all(launchPromises);

  // Schedule dropout timers after all bots are launched
  dropoutSimulator.scheduleDropouts(
    bots,
    config,
    (botId, reason, finalStatus) => botRunner.forceFinishBot(botId, reason, finalStatus),
    (id) => registry.getBot(id),
  );

  log.info('All %d bots launched', config.playerCount);
}

/**
 * Start the run once from UI-provided setup values.
 */
async function handleStartRequest(payload: StartPayload): Promise<void> {
  if (runStarted || runStarting) {
    log.warn('Ignoring cmd:start: run already started or starting');
    return;
  }

  runStarting = true;
  try {
    const start = normalizeStartPayload(payload);
    // Build strategy from the inline object sent by the renderer
    const strategy: BotStrategy = start.strategy
      ? {
          name: start.strategy.name ?? 'Custom',
          numberStrategy: (start.strategy.numberStrategy as BotStrategy['numberStrategy']) ?? 'random',
          numberFixedValue: Number(start.strategy.numberFixedValue) || 5,
          textValue: start.strategy.textValue ?? 'test',
          selectStrategy: (start.strategy.selectStrategy as BotStrategy['selectStrategy']) ?? 'random',
          radioStrategy: (start.strategy.radioStrategy as BotStrategy['radioStrategy']) ?? 'random',
          checkboxStrategy: (start.strategy.checkboxStrategy as BotStrategy['checkboxStrategy']) ?? 'random',
          submitDelay: Number(start.strategy.submitDelay) || 0,
          actionDelayMs: Number(start.strategy.actionDelayMs) || 0,
          actionJitterMs: Number(start.strategy.actionJitterMs) || 0,
          staleProbability: Number(start.strategy.staleProbability) || 0,
          staleExtraDelayMs: Number(start.strategy.staleExtraDelayMs) || 0,
          dropProbability: Number(start.strategy.dropProbability) || 0,
          carouselStrategy: (start.strategy.carouselStrategy as BotStrategy['carouselStrategy']) ?? 'sequential',
          realisticTiming: !!start.strategy.realisticTiming,
          readingWpmMin: Number(start.strategy.readingWpmMin) || 100,
          readingWpmMax: Number(start.strategy.readingWpmMax) || 250,
          customMessages: Array.isArray(start.strategy.customMessages)
            ? start.strategy.customMessages.filter((m: unknown) => typeof m === 'string')
            : undefined,
          messageBankCategories: Array.isArray(start.strategy.messageBankCategories)
            ? start.strategy.messageBankCategories as MessageCategory[]
            : undefined,
        }
      : baseConfig.strategy;
    const runConfig: AppConfig = {
      ...baseConfig,
      url: start.url,
      urlInjection: start.urlInjection,
      playerCount: start.playerCount,
      dropoutRatePercent: start.dropoutRatePercent ?? baseConfig.dropoutRatePercent,
      botMaxRuntimeMs: start.botMaxRuntimeMs ?? baseConfig.botMaxRuntimeMs,
      strategy,
    };

    // Store active runtime budget for the watchdog
    activeBotMaxRuntimeMs = runConfig.botMaxRuntimeMs;

    // Repeat rounds setup
    repeatTotalRounds = Math.max(1, Number(start.repeatRounds) || 1);
    repeatCurrentRound = 1;
    lastRunConfig = runConfig;

    log.info('Starting run — round %d/%d', repeatCurrentRound, repeatTotalRounds);
    await launchBots(runConfig);
    runStarted = true;
    runStartedAt = Date.now();
    sendOverviewSnapshot();
    sendRoundUpdate();
  } catch (err) {
    runStarted = false;
    throw err;
  } finally {
    runStarting = false;
  }
}

/**
 * Send round progress to the renderer.
 */
function sendRoundUpdate(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannel.ROUND_UPDATE, {
      currentRound: repeatCurrentRound,
      totalRounds: repeatTotalRounds,
    });
  }
}

/**
 * Automatically start the next repeat round after all bots finish.
 */
async function handleRepeatRound(): Promise<void> {
  if (!lastRunConfig || repeatCurrentRound >= repeatTotalRounds) {
    log.info('All %d rounds completed', repeatTotalRounds);
    return;
  }

  log.info('Round %d/%d complete — starting next round…', repeatCurrentRound, repeatTotalRounds);

  // Tear down current round
  dropoutSimulator.clearAll();
  await botRunner.stopAll();
  currentPlayerCount = 0;

  // Brief pause to let the experiment server process the completed session
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Bail if a restart/stop occurred during the pause
  if (!lastRunConfig) {
    log.info('Repeat cancelled (lastRunConfig cleared during pause)');
    return;
  }

  repeatCurrentRound++;
  sendRoundUpdate();

  // Re-launch identical run
  log.info('Launching round %d/%d', repeatCurrentRound, repeatTotalRounds);
  try {
    await launchBots(lastRunConfig);
    runStartedAt = Date.now();
    sendOverviewSnapshot();
  } catch (err) {
    log.error('Failed to launch repeat round %d: %s', repeatCurrentRound, err instanceof Error ? err.message : String(err));
    // Reset to allow the user to restart manually
    repeatCurrentRound = repeatTotalRounds; // prevent further repeats
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannel.ALL_DONE);
    }
  }
}

/**
 * Stop current run and allow the renderer to go back to settings/start state.
 */
async function handleRestartRequest(): Promise<void> {
  if (runStarting) {
    log.warn('Ignoring cmd:restart while run is still starting');
    return;
  }

  runStarting = true;
  try {
    dropoutSimulator.clearAll();
    await botRunner.stopAll();
    currentPlayerCount = 0;
    runStarted = false;
    runStartedAt = null;
    repeatCurrentRound = 0;
    repeatTotalRounds = 1;
    lastRunConfig = null;
    isRepeating = false;
    sendOverviewSnapshot();
    log.info('Run stopped and reset. Ready for new start request.');
  } finally {
    runStarting = false;
  }
}

function checkRuntimeBudget(): void {
  if (!runStarted || runStarting || currentPlayerCount <= 0) {
    return;
  }
  // 0 = no limit
  if (activeBotMaxRuntimeMs <= 0) {
    return;
  }

  const now = Date.now();
  const overdueBots = registry.getOverdueRunningBots(activeBotMaxRuntimeMs, now);
  for (const bot of overdueBots) {
    const runtimeMs = now - bot.createdAt;
    const runtimeSec = Math.round(runtimeMs / 1000);
    log.warn(
      'Bot #%d (%s) exceeded runtime budget (%ds); force-finishing',
      bot.index,
      bot.id,
      runtimeSec,
    );
    botRunner.forceFinishBot(
      bot.id,
      `runtime budget exceeded at ${runtimeSec}s (timeout ${Math.round(activeBotMaxRuntimeMs / 1000)}s)`,
      'dropped',
    );
  }
}

function startBudgetWatchdog(): void {
  if (budgetWatchdogTimer) {
    return;
  }
  budgetWatchdogTimer = setInterval(checkRuntimeBudget, DEFAULTS.budgetCheckIntervalMs);
}

function stopBudgetWatchdog(): void {
  if (!budgetWatchdogTimer) {
    return;
  }
  clearInterval(budgetWatchdogTimer);
  budgetWatchdogTimer = null;
}

function scheduleGridRefresh(reason: string): void {
  if (layoutRefreshTimer) {
    clearTimeout(layoutRefreshTimer);
  }

  layoutRefreshTimer = setTimeout(() => {
    layoutRefreshTimer = null;
    if (currentPlayerCount <= 0) return;
    log.debug('Window geometry changed (%s) — refreshing grid layout', reason);
    gridManager.refresh(currentPlayerCount, baseConfig.cols);
  }, 80);
}

function buildOverviewSnapshot(): OverviewSnapshot {
  const bots = registry
    .getAllBots()
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((bot) => ({
      id: bot.id,
      index: bot.index,
      status: bot.status,
      currentState: bot.currentState,
      logCount: bot.logs.length,
      error: bot.error,
    }));

  const finishedBots = bots.filter((b) => isTerminalStatus(b.status)).length;

  return {
    timestamp: Date.now(),
    expectedBots: currentPlayerCount,
    finishedBots,
    runStartedAt,
    currentRound: repeatCurrentRound,
    totalRounds: repeatTotalRounds,
    bots,
  };
}

function sendOverviewSnapshot(): void {
  if (!overviewWindow || overviewWindow.isDestroyed()) return;
  overviewWindow.webContents.send(IpcChannel.OVERVIEW_SNAPSHOT, buildOverviewSnapshot());
}

function startOverviewTicker(): void {
  if (overviewTimer) return;
  overviewTimer = setInterval(() => {
    if (!overviewWindow || overviewWindow.isDestroyed()) return;
    sendOverviewSnapshot();
  }, 1000);
}

function stopOverviewTicker(): void {
  if (overviewTimer) {
    clearInterval(overviewTimer);
    overviewTimer = null;
  }
}

async function openOverviewWindow(): Promise<void> {
  if (overviewWindow && !overviewWindow.isDestroyed()) {
    overviewWindow.focus();
    sendOverviewSnapshot();
    return;
  }

  const overviewPreload = path.join(__dirname, 'overview-preload.js');
  overviewWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 680,
    minHeight: 520,
    title: 'Run Overview',
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      preload: overviewPreload,
    },
  });
  overviewWindow.setMenu(null);
  attachContextMenu(overviewWindow.webContents);

  const htmlPath = path.join(__dirname, '..', 'renderer', 'overview.html');
  await overviewWindow.loadFile(htmlPath);
  startOverviewTicker();
  sendOverviewSnapshot();

  overviewWindow.on('closed', () => {
    overviewWindow = null;
    stopOverviewTicker();
  });
}

// ── App Lifecycle ───────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    baseConfig = parseCLI();
    setVerbose(baseConfig.debug);
    log.info('Log files → %s', getLogPath());

    // Create window before run; renderer shows setup form and sends cmd:start.
    mainWindow = await createWindow(baseConfig);
    log.info('Window created, renderer + preload loaded');

    if (baseConfig.devtools) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    gridManager = new GridManager(mainWindow);
    registry = new SessionRegistry();
    botRunner = new BotRunner(mainWindow, registry, baseConfig.delayMultiplier);
    botRunner.setGridManager(gridManager);
    startBudgetWatchdog();

    // Wire repeat-round logic: when all bots finish, start next round if needed.
    // Guard with isRepeating to prevent re-entrant calls: stopAll() triggers
    // onStatusChange → allFinished() → allDoneCallback, which would recurse.
    botRunner.setAllDoneCallback(() => {
      dropoutSimulator.clearAll();
      if (!isRepeating && repeatCurrentRound < repeatTotalRounds) {
        isRepeating = true;
        void handleRepeatRound()
          .catch((err) => {
            log.error('Repeat round failed: %s', err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            isRepeating = false;
          });
      }
    });

    registerIpcHandlers(botRunner, handleStartRequest, handleRestartRequest, mainWindow, {
      onDrawerToggle: (open: boolean) => {
        const DRAWER_WIDTH = 380;           // must match .log-drawer width in CSS
        gridManager.setDrawerOffset(open ? DRAWER_WIDTH : 0);
        if (currentPlayerCount > 0) {
          scheduleGridRefresh('drawer-toggle');
        }
      },
      onOverviewToggle: (open: boolean) => {
        gridManager.setViewsVisible(!open);
        if (!open && currentPlayerCount > 0) {
          scheduleGridRefresh('overview-close');
        }
      },
      openOverviewWindow: () => openOverviewWindow(),
    });

    for (const event of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) {
      mainWindow.on(event as 'resize', () => scheduleGridRefresh(event));
    }

    // Headless mode has no setup form, so start immediately using CLI values.
    if (baseConfig.headless) {
      await handleStartRequest({
        url: baseConfig.url,
        playerCount: baseConfig.playerCount,
        dropoutRatePercent: baseConfig.dropoutRatePercent,
      });
    }
  } catch (err) {
    log.error('Fatal error: %s', err instanceof Error ? err.message : String(err));
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  stopBudgetWatchdog();
  dropoutSimulator.clearAll();
  removeIpcHandlers();
  if (registry) {
    await registry.destroyAll();
  }
  app.quit();
});

app.on('before-quit', async () => {
  stopBudgetWatchdog();
  dropoutSimulator.clearAll();
  stopOverviewTicker();
  if (overviewWindow && !overviewWindow.isDestroyed()) {
    overviewWindow.close();
  }
  if (botRunner) {
    await botRunner.stopAll();
  }
});

// src/main/index.ts
// ──────────────────────────────────────────────────────────────
// Electron main process entry point.
// Creates the BrowserWindow, orchestrates bot launch, wires IPC.
// ──────────────────────────────────────────────────────────────

import path from 'path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { AppConfig, BotScript, DEFAULT_STRATEGY, BotStrategy, IpcChannel } from '../engine/types';
import { parseCLI } from './cli';
import { GridManager } from './grid-manager';
import { SessionRegistry } from './session-registry';
import { BotRunner } from './bot-runner';
import { registerIpcHandlers, removeIpcHandlers, StartPayload, StrategyPayload } from './ipc-handlers';
import { createChildLogger, setVerbose, getLogPath } from './logger';
import { createAutoPlayer } from '../scripts/auto-player';

const log = createChildLogger('main');

// ── Globals ─────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let gridManager: GridManager;
let registry: SessionRegistry;
let botRunner: BotRunner;
let baseConfig: AppConfig;
let currentPlayerCount = 0;
let runStarted = false;
let runStarting = false;

// ── Window Creation ─────────────────────────────────────────

async function createWindow(config: AppConfig): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, 'preload.js');
  log.debug('Preload path: %s', preloadPath);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'oTree Bots',
    webPreferences: {
      sandbox: false,           // allow require() in preload
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

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

  if (!url) {
    throw new Error('URL is required.');
  }
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new Error('Player count must be an integer >= 1.');
  }

  return { url, playerCount, strategy: payload.strategy };
}

/**
 * Launch bots for a validated run config.
 */
async function launchBots(config: AppConfig): Promise<void> {
  currentPlayerCount = config.playerCount;

  log.info('Starting run', {
    url: config.url,
    players: config.playerCount,
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
      await botRunner.launchBrowser(bot);
      await botRunner.navigate(bot, config.url);
      await botRunner.startFSM(bot, config.strategy.actionDelayMs ?? 0);
    } catch (err) {
      log.error('Failed to start bot #%d: %s', bot.index, err instanceof Error ? err.message : String(err));
      registry.setError(bot.id, err instanceof Error ? err.message : String(err));
    }
  });

  await Promise.all(launchPromises);

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
        }
      : baseConfig.strategy;
    await launchBots({
      ...baseConfig,
      url: start.url,
      playerCount: start.playerCount,
      strategy,
    });
    runStarted = true;
  } catch (err) {
    runStarted = false;
    throw err;
  } finally {
    runStarting = false;
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
    await botRunner.stopAll();
    currentPlayerCount = 0;
    runStarted = false;
    log.info('Run stopped and reset. Ready for new start request.');
  } finally {
    runStarting = false;
  }
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

    if (baseConfig.debug) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    gridManager = new GridManager(mainWindow);
    registry = new SessionRegistry();
    botRunner = new BotRunner(mainWindow, registry, baseConfig.delayMultiplier);
    botRunner.setGridManager(gridManager);

    registerIpcHandlers(botRunner, handleStartRequest, handleRestartRequest);

    // Forward open-drawer requests from BrowserView → main renderer
    ipcMain.on(IpcChannel.CMD_OPEN_DRAWER, (_event, payload: { id: string; index: number }) => {
      log.debug('cmd:open-drawer received for %s', payload.id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-drawer-for-bot', payload);
      }
    });

    // ── Drawer toggle — shrink grid to make room for the sidebar ──
    ipcMain.on(IpcChannel.CMD_DRAWER_TOGGLE, (_event, payload: { open: boolean }) => {
      const DRAWER_WIDTH = 380;           // must match .log-drawer width in CSS
      gridManager.setDrawerOffset(payload.open ? DRAWER_WIDTH : 0);
      if (currentPlayerCount > 0) {
        gridManager.refresh(currentPlayerCount, baseConfig.cols);
      }
    });

    mainWindow.on('resize', () => {
      if (currentPlayerCount > 0) {
        gridManager.refresh(currentPlayerCount, baseConfig.cols);
      }
    });

    // Headless mode has no setup form, so start immediately using CLI values.
    if (baseConfig.headless) {
      await handleStartRequest({
        url: baseConfig.url,
        playerCount: baseConfig.playerCount,
      });
    }
  } catch (err) {
    log.error('Fatal error: %s', err instanceof Error ? err.message : String(err));
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  removeIpcHandlers();
  if (registry) {
    await registry.destroyAll();
  }
  app.quit();
});

app.on('before-quit', async () => {
  if (botRunner) {
    await botRunner.stopAll();
  }
});

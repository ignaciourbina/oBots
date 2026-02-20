#!/usr/bin/env node
// scripts/dev-capture.js  (plain JS — runs directly against dist/)
// ──────────────────────────────────────────────────────────────
// Dev helper: launches the Electron app AND takes periodic
// screenshots of the BrowserWindow using capturePage().
//
// Screenshots saved to ./dev-screenshots/ with timestamps.
//
// Usage:
//   npx electron scripts/dev-capture.js -- --url http://localhost:8099/join/xyz --players 3
//   OR: npm run dev:capture -- --url ... --players 3
// ──────────────────────────────────────────────────────────────

const path = require('path');
const fs   = require('fs');
const { app, BrowserWindow } = require('electron');

function isBrokenPipeError(err) {
  return Boolean(err && (
    err.code === 'EPIPE'
    || (typeof err.message === 'string' && err.message.includes('EPIPE'))
  ));
}

function safeWrite(stream, message) {
  try {
    stream.write(message + '\n');
  } catch (err) {
    if (!isBrokenPipeError(err)) {
      throw err;
    }
  }
}

function safeLog(...args) {
  safeWrite(process.stdout, args.map((v) => String(v)).join(' '));
}

function safeError(...args) {
  safeWrite(process.stderr, args.map((v) => String(v)).join(' '));
}

process.stdout.on('error', (err) => {
  if (!isBrokenPipeError(err)) throw err;
});

process.stderr.on('error', (err) => {
  if (!isBrokenPipeError(err)) throw err;
});

// ── Config ──────────────────────────────────────────────────
const SCREENSHOT_DIR        = path.join(__dirname, '..', 'dev-screenshots');
const SCREENSHOT_INTERVAL   = 2000;   // ms
const MAX_SCREENSHOTS       = 30;     // stop after 30 captures (~60s)
const AUTO_QUIT_MS          = 65000;

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function ts() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23); }

// ── Parse argv ──────────────────────────────────────────────
// Electron eats some flags, so look past '--'
const raw   = process.argv;
const ddIdx = raw.indexOf('--');
const args  = ddIdx !== -1 ? raw.slice(ddIdx + 1) : raw.slice(2);

function flag(name, fallback) {
  const i = args.indexOf('--' + name);
  if (i === -1) return fallback;
  return args[i + 1] ?? fallback;
}
// Load .env file if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL     = flag('url', process.env.OTREE_SESSION_URL || null);
const PLAYERS = Number(flag('players', '3'));
if (!URL) { safeError('Missing --url (pass --url or set OTREE_SESSION_URL in .env)'); process.exit(1); }

const SCRIPT_PATH = flag('script', path.join(__dirname, '..', 'dist', 'scripts', 'poc-bot.js'));

// ── Main ────────────────────────────────────────────────────
app.whenReady().then(async () => {
  safeLog('[dev-capture] URL:', URL, 'Players:', PLAYERS);

  // 1. Create BrowserWindow
  const preloadPath = path.join(__dirname, '..', 'dist', 'main', 'preload.js');
  safeLog('[dev-capture] preload:', preloadPath);

  const win = new BrowserWindow({
    width: 1280, height: 800,
    title: 'oTree Bots (Dev Capture)',
    webPreferences: {
      sandbox: false,
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  // Forward renderer console
  win.webContents.on('console-message', (_ev, level, msg, line, src) => {
    const tag = ['LOG', 'WARN', 'ERR'][level] || 'LOG';
    safeLog(`[renderer:${tag}] ${msg} (${src}:${line})`);
  });
  win.webContents.on('did-fail-load', (_ev, code, desc) => {
    safeError('[dev-capture] page load failed:', code, desc);
  });

  const htmlPath = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
  safeLog('[dev-capture] html:', htmlPath, 'exists:', fs.existsSync(htmlPath));
  await win.loadFile(htmlPath);
  safeLog('[dev-capture] HTML loaded');

  // Open DevTools to separate window so they don't affect capturePage
  // win.webContents.openDevTools({ mode: 'detach' });

  // 2. Load Grid + Bot components from dist
  const { GridManager }     = require('../dist/main/grid-manager');
  const { SessionRegistry } = require('../dist/main/session-registry');
  const { BotRunner }       = require('../dist/main/bot-runner');
  const { registerIpcHandlers } = require('../dist/main/ipc-handlers');

  const gridManager = new GridManager(win);
  const registry    = new SessionRegistry();
  const botRunner   = new BotRunner(win, registry, 1.0);
  registerIpcHandlers(botRunner, async () => {}, async () => {});

  const layout = gridManager.computeLayout(PLAYERS);
  safeLog(`[dev-capture] Grid: ${layout.cols}x${layout.rows}`);
  gridManager.broadcastLayout();
  safeLog('[dev-capture] Grid layout broadcast sent');

  win.on('resize', () => gridManager.refresh(PLAYERS));

  // 3. Screenshot capture loop (async, runs in parallel)
  ensureDir(SCREENSHOT_DIR);
  const captureLoop = async () => {
    for (let i = 0; i < MAX_SCREENSHOTS; i++) {
      await new Promise(r => setTimeout(r, SCREENSHOT_INTERVAL));
      if (win.isDestroyed()) break;
      try {
        const image  = await win.capturePage();
        const png    = image.toPNG();
        const fname  = `capture-${String(i).padStart(3,'0')}-${ts()}.png`;
        fs.writeFileSync(path.join(SCREENSHOT_DIR, fname), png);
        safeLog(`[dev-capture] screenshot ${fname} (${(png.length / 1024).toFixed(1)} KB)`);
      } catch (e) { safeError('[dev-capture] screenshot err:', e.message); }
    }
  };
  const capPromise = captureLoop();

  // 4. Load bot script
  const mod    = require(path.resolve(SCRIPT_PATH));
  const script = mod.default || mod;
  safeLog(`[dev-capture] Bot script: "${script.name}" (${Object.keys(script.states).length} states)`);

  // 5. Launch bots concurrently
  const launchPromises = Array.from({ length: PLAYERS }, async (_, i) => {
    const bot = registry.createBot(i, script);
    safeLog(`[dev-capture] Launching bot #${i} (${bot.id})`);
    try {
      await botRunner.launchBrowser(bot);
      await botRunner.navigate(bot, URL);
      await botRunner.startFSM(bot);
    } catch (err) {
      safeError(`[dev-capture] Bot #${i} failed:`, err.message);
      registry.setError(bot.id, err.message);
    }
  });
  await Promise.all(launchPromises);
  safeLog(`[dev-capture] All ${PLAYERS} bots launched`);

  // 6. Auto-quit timer
  setTimeout(() => { safeLog('[dev-capture] Auto-quit'); app.quit(); }, AUTO_QUIT_MS);
  await capPromise;
});

app.on('window-all-closed', () => app.quit());

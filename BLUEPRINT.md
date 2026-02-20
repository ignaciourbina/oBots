# oTree-Bots — Technical Blueprint v1.0

---

## 1. Problem Statement

Live-testing oTree experiments is a high-friction manual process. For a game with _G_ groups × _P_ players × _R_ rounds, a researcher must open _G × P_ browser windows and manually click through _R_ rounds of each — an _O(G·P·R)_ manual workload that scales painfully. No existing tool automates this at the **real UI layer** (most oTree bot frameworks bypass the browser entirely).

### 1.1 Design Goals

| #  | Goal                                                     | Metric                                     |
| -- | -------------------------------------------------------- | ------------------------------------------ |
| G1 | Launch_N_ real browser instances from a single command | N ≥ 2 for PoC, N ≥ 24 target             |
| G2 | Visual grid — every instance visible simultaneously     | Electron shell with dynamic grid           |
| G3 | Deterministic, repeatable bot behavior                   | Finite-state-machine per bot               |
| G4 | Zero manual interaction once started                     | Full auto-play to completion               |
| G5 | Extensible to arbitrary oTree apps                       | Pluggable bot scripts                      |
| G6 | Future: IP differentiation per instance                  | Architecture supports proxy slots (pinned) |

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ELECTRON HOST SHELL                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ WebView  │ │ WebView  │ │ WebView  │ │ WebView  │  ...   │
│  │ (bot-1)  │ │ (bot-2)  │ │ (bot-3)  │ │ (bot-4)  │        │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘        │
│       │             │             │             │             │
│  ┌────▼─────────────▼─────────────▼─────────────▼──────┐     │
│  │              IPC  Bus  (Electron IPC)               │     │
│  └────┬────────────────────────────────────────────────┘     │
│       │                                                      │
│  ┌────▼──────────────────────────────────────────────────┐   │
│  │               ORCHESTRATOR  (Main Process)            │   │
│  │  ┌──────────┐ ┌────────────┐ ┌──────────────────┐    │   │
│  │  │ Grid Mgr │ │ Bot Runner │ │ Session Registry │    │   │
│  │  └──────────┘ └────────────┘ └──────────────────┘    │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌─────────┐     ┌───────────┐     ┌───────────┐
   │ Puppeteer│     │ Puppeteer │     │ Puppeteer │   ← Chromium instances
   │ Browser 1│     │ Browser 2 │     │ Browser N │     (one per bot)
   └─────────┘     └───────────┘     └───────────┘
        │                 │                 │
        ▼                 ▼                 ▼
   ┌──────────────────────────────────────────────┐
   │            oTree Server  (target)            │
   └──────────────────────────────────────────────┘
```

### 2.1 Component Inventory

| Component                        | Technology                                  | Role                                                                |
| -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| **Electron Host Shell**    | Electron 28+                                | Top-level window, renders grid of `<webview>` tags                |
| **Grid Manager**           | Electron Main Process (Node.js)             | Computes grid layout (cols × rows), creates/destroys webview slots |
| **Bot Runner**             | Node.js + Puppeteer-core                    | Launches headless-ish Chromium, attaches Puppeteer, executes FSM    |
| **State Machine Engine**   | XState v5 (or lightweight custom)           | Drives each bot through game pages deterministically                |
| **Session Registry**       | In-memory Map                               | Tracks bot-id → { browser, page, fsm, webviewId, status }          |
| **IPC Bus**                | Electron `ipcMain` / `ipcRenderer`      | Relays status, logs, commands between main ↔ renderer              |
| **CLI Launcher**           | Node.js +`yargs`                          | `npx otree-bots run --url <link> --players 4 --script mybot.js`   |
| **Bot Script (user-land)** | Plain JS/TS module exporting FSM definition | Declares states, selectors, actions, timings                        |

---

## 3. Module Decomposition

```
otree-bots/
├── package.json
├── tsconfig.json
├── electron-builder.yml          # packaging config
├── BLUEPRINT.md                  # ← this file
│
├── src/
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # Entry — creates BrowserWindow, orchestrates
│   │   ├── grid-manager.ts       # Layout math, webview lifecycle
│   │   ├── bot-runner.ts         # Spawns Puppeteer browsers, drives FSM
│   │   ├── session-registry.ts   # Central state store for all bots
│   │   ├── ipc-handlers.ts       # IPC channel definitions & handlers
│   │   └── cli.ts                # CLI argument parsing (yargs)
│   │
│   ├── renderer/                 # Electron renderer process
│   │   ├── index.html            # Shell HTML — grid container
│   │   ├── renderer.ts           # UI logic — receives IPC, updates grid
│   │   ├── styles.css            # Grid layout styles
│   │   └── components/
│   │       ├── bot-card.ts       # Single bot tile (status, label, controls)
│   │       └── toolbar.ts        # Top bar: start/stop/reset, player count
│   │
│   ├── engine/                   # Bot engine (framework-agnostic)
│   │   ├── state-machine.ts      # FSM runner — interprets bot scripts
│   │   ├── actions.ts            # Built-in Puppeteer actions (click, fill, wait…)
│   │   ├── conditions.ts         # Built-in guards (elementExists, textMatches…)
│   │   └── types.ts              # Shared TypeScript interfaces
│   │
│   └── scripts/                  # Example bot scripts (user-land format)
│       └── poc-bot.ts            # PoC: hardcoded join → play → done
│
├── test/
│   ├── unit/
│   │   ├── state-machine.test.ts
│   │   └── grid-manager.test.ts
│   └── e2e/
│       └── poc-run.test.ts
│
└── docs/
    └── writing-bot-scripts.md    # Guide for researchers
```

---

## 4. Core Abstractions & Interfaces

### 4.1 BotScript — the user-authored unit

```typescript
/**
 * A BotScript defines the finite-state-machine that drives one bot
 * through an oTree game session.
 *
 * Each state declares:
 *   - what to DO on the page  (actions)
 *   - what to WAIT for        (guard / condition)
 *   - where to go NEXT        (target state)
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

export interface Action {
  /** Built-in action type */
  type: 'click' | 'fill' | 'select' | 'wait' | 'waitForNavigation'
      | 'waitForSelector' | 'evaluate' | 'screenshot' | 'log';
  /** CSS selector (for click, fill, select, waitForSelector) */
  selector?: string;
  /** Value (for fill, select, evaluate) */
  value?: string | number | boolean;
  /** Timeout in ms */
  timeout?: number;
}

export interface Guard {
  type: 'elementExists' | 'elementNotExists' | 'urlContains'
      | 'urlEquals' | 'textContains' | 'custom';
  selector?: string;
  value?: string;
  /** For 'custom': a function serialized or referenced by name */
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
```

### 4.2 BotInstance — runtime representation

```typescript
export interface BotInstance {
  id: string;                     // uuid
  index: number;                  // 0‥N-1
  script: BotScript;
  currentState: string;
  status: 'idle' | 'running' | 'paused' | 'done' | 'error';
  browser: Browser | null;       // Puppeteer Browser
  page: Page | null;              // Puppeteer Page
  webviewId: string | null;      // Electron <webview> element id
  logs: LogEntry[];
  error?: string;
}
```

### 4.3 GridSlot — renderer data model

```typescript
export interface GridSlot {
  slotIndex: number;
  botId: string;
  label: string;
  status: BotInstance['status'];
  currentState: string;
  thumbnailDataUrl?: string;      // periodic screenshot for non-webview mode
}
```

---

## 5. Detailed Component Specifications

### 5.1 Electron Host Shell (`src/main/index.ts`)

**Responsibilities:**

1. Parse CLI args or use defaults.
2. Create a single `BrowserWindow` (frameless optional, resizable).
3. Load `renderer/index.html`.
4. Instantiate `GridManager`, `SessionRegistry`, `BotRunner`.
5. Wire IPC handlers.
6. On `app.ready` → start the run.

**Startup Sequence:**

```
app.ready
  → parseCLI()
  → createWindow(fullscreen)
  → gridManager.computeLayout(playerCount)
  → for i in 0..playerCount-1:
       registry.createBot(i, script)
       botRunner.launchBrowser(bot)
       gridManager.attachWebview(bot)
       botRunner.startFSM(bot)
  → ipc: broadcast('all-bots-started')
```

**Window Configuration:**

```typescript
const win = new BrowserWindow({
  width: 1920,
  height: 1080,
  webPreferences: {
    webviewTag: true,          // REQUIRED for <webview>
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

### 5.2 Grid Manager (`src/main/grid-manager.ts`)

**Layout Algorithm:**

Given _N_ bots and a container of _W × H_ pixels:

```
cols = ceil(sqrt(N))
rows = ceil(N / cols)
cellWidth  = floor(W / cols)
cellHeight = floor(H / rows)
```

Each cell is a positioned `<webview>` or `<div>` rendered by the renderer process. The Grid Manager sends layout descriptors over IPC:

```typescript
interface GridLayout {
  cols: number;
  rows: number;
  cells: Array<{
    slotIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}
```

The renderer lays out cells using CSS Grid:

```css
#grid-container {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  grid-template-rows: repeat(var(--rows), 1fr);
  width: 100vw;
  height: 100vh;
  gap: 2px;
  background: #1a1a2e;
}

.bot-card {
  position: relative;
  overflow: hidden;
  border: 1px solid #333;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
}

.bot-card__header {
  height: 24px;
  background: #16213e;
  color: #e2e2e2;
  font-size: 11px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bot-card__webview {
  flex: 1;
}
```

### 5.3 Bot Runner (`src/main/bot-runner.ts`)

**Browser Launch Strategy:**

Each bot gets its own Chromium instance via **Puppeteer-core** connected to the system (or bundled) Chromium. This is intentional — separate processes give true isolation (cookies, sessions, storage).

```typescript
async function launchBrowser(bot: BotInstance): Promise<void> {
  const browser = await puppeteer.launch({
    headless: false,           // we WANT visible browsers
    defaultViewport: null,     // inherit from webview size
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      `--window-size=800,600`,
      // future: `--proxy-server=${bot.script.config?.proxy}`
    ],
    executablePath: findChromium(), // system or electron's bundled
  });

  const page = (await browser.pages())[0] ?? await browser.newPage();
  bot.browser = browser;
  bot.page = page;
}
```

**FSM Execution Loop:**

```typescript
async function runFSM(bot: BotInstance): Promise<void> {
  bot.status = 'running';
  bot.currentState = bot.script.initialState;

  while (bot.status === 'running') {
    const stateDef = bot.script.states[bot.currentState];
    if (!stateDef) throw new Error(`Unknown state: ${bot.currentState}`);

    // 1. Execute onEntry actions
    for (const action of stateDef.onEntry) {
      await executeAction(bot.page!, action);
    }

    // 2. If final → done
    if (stateDef.final) {
      bot.status = 'done';
      break;
    }

    // 3. Evaluate transitions (poll until one matches)
    const nextState = await pollTransitions(bot.page!, stateDef.transitions);
    bot.currentState = nextState;

    // 4. Broadcast state change
    emitStateChange(bot);
  }
}

async function pollTransitions(page: Page, transitions: Transition[]): Promise<string> {
  while (true) {
    for (const t of transitions) {
      if (!t.guard || await evaluateGuard(page, t.guard)) {
        return t.target;
      }
    }
    await sleep(t.delay ?? 500);   // configurable poll interval
  }
}
```

### 5.4 State Machine Engine (`src/engine/state-machine.ts`)

The engine is a **pure interpreter** — it takes a `BotScript` and a Puppeteer `Page` and runs until a final state. It has no knowledge of Electron, oTree, or the grid.

**Built-in Actions** (`src/engine/actions.ts`):

| Action                | Selector     | Value          | Behavior                                      |
| --------------------- | ------------ | -------------- | --------------------------------------------- |
| `click`             | CSS selector | —             | `page.click(selector)`                      |
| `fill`              | CSS selector | string         | `page.type(selector, value)`                |
| `select`            | CSS selector | option value   | `page.select(selector, value)`              |
| `wait`              | —           | ms (number)    | `sleep(value)`                              |
| `waitForNavigation` | —           | —             | `page.waitForNavigation()`                  |
| `waitForSelector`   | CSS selector | —             | `page.waitForSelector(selector, {timeout})` |
| `evaluate`          | —           | JS string      | `page.evaluate(value)`                      |
| `screenshot`        | —           | —             | capture & attach to logs                      |
| `log`               | —           | message string | push to `bot.logs`                          |

**Built-in Guards** (`src/engine/conditions.ts`):

| Guard                | Selector | Value     | Evaluates                          |
| -------------------- | -------- | --------- | ---------------------------------- |
| `elementExists`    | CSS      | —        | `!!document.querySelector(sel)`  |
| `elementNotExists` | CSS      | —        | `!document.querySelector(sel)`   |
| `urlContains`      | —       | substring | `page.url().includes(value)`     |
| `urlEquals`        | —       | full URL  | `page.url() === value`           |
| `textContains`     | CSS      | substring | `el.textContent.includes(value)` |
| `custom`           | —       | —        | deserialize & call `fn`          |

### 5.5 Session Registry (`src/main/session-registry.ts`)

Thread-safe (event-loop-safe) central store:

```typescript
class SessionRegistry {
  private bots: Map<string, BotInstance> = new Map();

  createBot(index: number, script: BotScript): BotInstance { ... }
  getBot(id: string): BotInstance | undefined { ... }
  getAllBots(): BotInstance[] { ... }
  updateStatus(id: string, status: BotInstance['status']): void { ... }
  toJSON(): SerializedRegistry { ... } // for IPC snapshots
}
```

### 5.6 IPC Protocol

All IPC uses **typed channels** with a shared enum:

```typescript
enum IpcChannel {
  // Main → Renderer
  GRID_LAYOUT      = 'grid:layout',
  BOT_STATUS       = 'bot:status',
  BOT_STATE_CHANGE = 'bot:state-change',
  BOT_LOG          = 'bot:log',
  ALL_DONE         = 'run:all-done',

  // Renderer → Main
  CMD_START        = 'cmd:start',
  CMD_STOP         = 'cmd:stop',
  CMD_PAUSE        = 'cmd:pause-bot',
  CMD_RESUME       = 'cmd:resume-bot',
}
```

**Preload script** exposes a safe API:

```typescript
// preload.ts
contextBridge.exposeInMainWorld('otreeBots', {
  onGridLayout:   (cb: (layout: GridLayout) => void) => ipcRenderer.on(IpcChannel.GRID_LAYOUT, (_, l) => cb(l)),
  onBotStatus:    (cb: (data: {id: string, status: string}) => void) => ipcRenderer.on(IpcChannel.BOT_STATUS, (_, d) => cb(d)),
  onBotLog:       (cb: (data: {id: string, entry: LogEntry}) => void) => ipcRenderer.on(IpcChannel.BOT_LOG, (_, d) => cb(d)),
  sendCommand:    (cmd: string, payload?: any) => ipcRenderer.send(cmd, payload),
});
```

---

## 6. Rendering Strategy — Webview vs. Screenshot

Two approaches exist for showing live browser content inside the Electron grid:

| Approach                                                                                     | Pros                    | Cons                               | Chosen        |
| -------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------- | ------------- |
| **A: Puppeteer headless + periodic screenshots → `<img>` in grid**                  | Low resource, simple    | Not truly live, ~1-2 fps           | —            |
| **B: Chromium `--remote-debugging-port` → Electron `<webview>` attached via CDP** | Truly live, interactive | Higher memory, complexity          | **PoC** |
| **C: Puppeteer `headless: false` with separate windows tiled by OS**                 | Simplest code           | No unified UI, OS-dependent tiling | Fallback      |

**PoC strategy: Approach B (CDP-attached webviews)**

Each Puppeteer-launched Chromium exposes a debugging WebSocket URL. The Electron `<webview>` can load the DevTools frontend at that URL, or we can use `webview.src` set to the actual game page and control it via CDP from the main process.

**Simplified PoC alternative:** For the initial proof of concept, we use **Approach A** (screenshots) since it is fastest to implement, then graduate to Approach B.

```typescript
// Periodic screenshot pump (Approach A)
async function screenshotLoop(bot: BotInstance, intervalMs = 500) {
  while (bot.status === 'running') {
    const buf = await bot.page!.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 });
    ipcMain.emit(IpcChannel.BOT_SCREENSHOT, { id: bot.id, dataUrl: `data:image/jpeg;base64,${buf}` });
    await sleep(intervalMs);
  }
}
```

---

## 7. CLI Interface

```
otree-bots run [options]

Options:
  --url, -u        oTree session-wide link or room URL           [string] [required]
  --players, -n    Number of bot players                         [number] [default: 2]
  --script, -s     Path to bot script JS/TS file                 [string] [required]
  --cols           Force grid columns (auto-calculated if omitted)[number]
  --delay          Global action delay multiplier (1.0 = normal)  [number] [default: 1.0]
  --headless       Run without Electron UI (screenshot dumps)     [boolean][default: false]
  --debug          Verbose logging                                [boolean][default: false]
  --help           Show help                                      [boolean]

Examples:
  otree-bots run -u http://localhost:8000/join/xyzabc -n 4 -s ./bots/public-goods.js
  otree-bots run -u http://localhost:8000/room/myroom -n 8 -s ./bots/dictator.ts --cols 4
```

---

## 8. PoC Bot Script — Hardcoded Example

This is the minimal proof-of-concept bot that:

1. Navigates to the join link.
2. Waits for the page to load.
3. Clicks "Next" buttons through the game.
4. Handles simple form fills.

```typescript
// src/scripts/poc-bot.ts
import { BotScript } from '../engine/types';

const POC_BOT: BotScript = {
  name: 'PoC Simple Clicker',
  initialState: 'navigate',

  states: {
    navigate: {
      onEntry: [
        { type: 'log', value: 'Navigating to join link...' },
        // Navigation is handled by the runner setting page.goto(url)
      ],
      transitions: [
        {
          target: 'waitForPage',
          guard: { type: 'urlContains', value: '/' },
          delay: 1000,
        },
      ],
    },

    waitForPage: {
      onEntry: [
        { type: 'waitForSelector', selector: 'form, .otree-body, button.otree-btn-next', timeout: 15000 },
        { type: 'log', value: 'Page loaded.' },
      ],
      transitions: [
        {
          target: 'fillAndSubmit',
          guard: { type: 'elementExists', selector: 'form' },
        },
        {
          target: 'clickNext',
          guard: { type: 'elementExists', selector: 'button.otree-btn-next, .btn-primary' },
        },
        {
          target: 'done',
          guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
        },
      ],
    },

    fillAndSubmit: {
      onEntry: [
        { type: 'log', value: 'Filling form fields...' },
        // Fill all visible number inputs with "5"
        { type: 'evaluate', value: `
          document.querySelectorAll('input[type="number"]').forEach(el => {
            el.value = 5;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
        `},
        // Fill all visible text inputs with "test"
        { type: 'evaluate', value: `
          document.querySelectorAll('input[type="text"]:not([readonly])').forEach(el => {
            el.value = 'test';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
        `},
        // Select first option in selects
        { type: 'evaluate', value: `
          document.querySelectorAll('select').forEach(el => {
            if (el.options.length > 1) {
              el.selectedIndex = 1;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        `},
        // Click radio buttons (first of each group)
        { type: 'evaluate', value: `
          const seen = new Set();
          document.querySelectorAll('input[type="radio"]').forEach(el => {
            if (!seen.has(el.name)) {
              el.click();
              seen.add(el.name);
            }
          });
        `},
        { type: 'wait', value: 300 },
      ],
      transitions: [
        {
          target: 'clickNext',
          guard: { type: 'elementExists', selector: 'button.otree-btn-next, .btn-primary, button[type="submit"]' },
        },
      ],
    },

    clickNext: {
      onEntry: [
        { type: 'log', value: 'Clicking next...' },
        { type: 'click', selector: 'button.otree-btn-next, .btn-primary, button[type="submit"]' },
        { type: 'waitForNavigation', timeout: 15000 },
        { type: 'wait', value: 500 },
      ],
      transitions: [
        {
          target: 'waitForPage',
          guard: { type: 'elementExists', selector: 'body' },
          delay: 500,
        },
        {
          target: 'done',
          guard: { type: 'urlContains', value: 'OutOfRangeNotification' },
        },
      ],
    },

    done: {
      onEntry: [
        { type: 'log', value: 'Bot finished.' },
        { type: 'screenshot' },
      ],
      transitions: [],
      final: true,
    },
  },
};

export default POC_BOT;
```

---

## 9. Sequence Diagrams

### 9.1 Full Run Sequence

```
User                CLI              Main Process        BotRunner         Puppeteer          oTree
 │                   │                     │                 │                 │                │
 │ otree-bots run    │                     │                 │                 │                │
 │──────────────────▶│                     │                 │                 │                │
 │                   │  parse args         │                 │                 │                │
 │                   │────────────────────▶│                 │                 │                │
 │                   │                     │ createWindow()  │                 │                │
 │                   │                     │──────┐          │                 │                │
 │                   │                     │◀─────┘          │                 │                │
 │                   │                     │                 │                 │                │
 │                   │                     │ for each bot:   │                 │                │
 │                   │                     │─launchBrowser()▶│                 │                │
 │                   │                     │                 │─puppeteer.launch▶│               │
 │                   │                     │                 │◀────browser──────│               │
 │                   │                     │                 │─page.goto(url)──────────────────▶│
 │                   │                     │                 │◀──────────────────page loaded────│
 │                   │                     │                 │                 │                │
 │                   │                     │─startFSM(bot)──▶│                 │                │
 │                   │                     │                 │──run state loop──│                │
 │                   │                     │                 │  actions/guards  │                │
 │                   │                     │                 │◀──transitions───▶│◀──────────────▶│
 │                   │                     │                 │                 │                │
 │                   │                     │◀─status updates─│                 │                │
 │    grid updates   │                     │──IPC to renderer│                 │                │
 │◀──────────────────│─────────────────────│                 │                 │                │
 │                   │                     │                 │                 │                │
 │                   │                     │◀─bot.done───────│                 │                │
 │  "All bots done"  │                     │                 │                 │                │
 │◀──────────────────│─────────────────────│                 │                 │                │
```

### 9.2 FSM State Transition (per bot)

```
  ┌──────────┐
  │ navigate │
  └────┬─────┘
       │ url loaded
       ▼
  ┌─────────────┐
  │ waitForPage  │◀───────────────────────┐
  └──┬──────┬───┘                         │
     │      │                             │
     │ form │ button only                 │
     ▼      ▼                             │
┌──────────────┐   ┌───────────┐          │
│ fillAndSubmit │──▶│ clickNext │──────────┘
└──────────────┘   └─────┬─────┘
                         │ OutOfRange / end
                         ▼
                    ┌──────┐
                    │ done │
                    └──────┘
```

---

## 10. Technology Stack & Dependencies

| Package              | Version | Purpose                                              |
| -------------------- | ------- | ---------------------------------------------------- |
| `electron`         | ^28.0.0 | Host shell                                           |
| `puppeteer-core`   | ^22.0.0 | Browser automation (no bundled Chromium)             |
| `puppeteer`        | ^22.0.0 | Dev convenience (bundled Chromium for PoC)           |
| `yargs`            | ^17.0.0 | CLI parsing                                          |
| `uuid`             | ^9.0.0  | Bot instance IDs                                     |
| `typescript`       | ^5.3.0  | Type safety                                          |
| `electron-builder` | ^24.0.0 | Packaging (future)                                   |
| `@xstate/fsm`      | ^2.0.0  | Optional: formal FSM lib (can be replaced by custom) |

**Runtime requirements:**

- Node.js ≥ 18
- Chromium/Chrome/Edge available on `$PATH` (or use `puppeteer`'s bundled version)

---

## 11. Error Handling Strategy

| Layer            | Error Type             | Handling                                                             |
| ---------------- | ---------------------- | -------------------------------------------------------------------- |
| Browser launch   | Chromium not found     | Fall back to `puppeteer`'s bundled; log warning                    |
| Page navigation  | Timeout                | Retry 2× with exponential backoff; then mark bot `error`          |
| Action execution | Selector not found     | Log, screenshot, advance to next transition or retry                 |
| FSM              | No matching transition | Poll up to `maxPollTime` (default 30s); then mark `error`        |
| IPC              | Channel timeout        | Log; renderer shows "disconnected" badge                             |
| Global           | Unhandled rejection    | Catch at process level; mark affected bot `error`; continue others |

Every error is:

1. Logged to `bot.logs[]`
2. Broadcast via IPC to renderer (shown in bot card)
3. Screenshot captured at point of failure

---

## 12. Configuration Defaults

```typescript
const DEFAULTS = {
  playerCount: 2,
  gridCols: 'auto',                // computed from playerCount
  actionDelayMultiplier: 1.0,
  pollIntervalMs: 500,
  maxPollTimeMs: 30_000,
  screenshotIntervalMs: 500,
  screenshotQuality: 60,           // JPEG quality
  navigationTimeoutMs: 15_000,
  actionTimeoutMs: 10_000,
  retryCount: 2,
  retryBackoffMs: 1000,
  chromiumArgs: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-infobars',
    '--disable-extensions',
  ],
};
```

---

## 13. Security Considerations

| Concern                         | Mitigation                                                       |
| ------------------------------- | ---------------------------------------------------------------- |
| `nodeIntegration` in renderer | Disabled; use `contextIsolation: true` + preload               |
| `<webview>` tag               | Enabled only for grid display; no `nodeintegration` in webview |
| Arbitrary script execution      | Bot scripts are local files only; no remote loading              |
| Puppeteer `page.evaluate`     | Runs in Chromium sandbox; no node access                         |

---

## 14. Development Phases

### Phase 1 — PoC (Current Sprint)

- [ ] Scaffold project structure
- [ ] Electron window + CSS grid with placeholder tiles
- [ ] Launch 2 Puppeteer browsers
- [ ] Stream screenshots into grid tiles (Approach A)
- [ ] Hardcoded PoC bot script: navigate → fill → click → loop
- [ ] CLI: `--url` and `--players` flags

- **Exit criteria:** 2 bots visible in grid, auto-playing through a public goods game

### Phase 2 — FSM Engine

- [ ] Formalize BotScript interface
- [ ] Build FSM interpreter with guards
- [ ] Error handling + retry logic
- [ ] Bot status indicators in UI (running / done / error)
- [ ] Log panel per bot (expandable)

### Phase 3 — Scale & UX

- [ ] Support N ≥ 24 bots
- [ ] Dynamic grid resizing
- [ ] Toolbar: start / stop / pause individual bots
- [ ] Resource monitoring (CPU/RAM per browser)
- [ ] CDP-based live view (Approach B) replacing screenshots

### Phase 4 — Advanced (Pinned items)

- [ ] Per-bot proxy/IP spoofing
- [ ] Firefox DevEdition support via `playwright`
- [ ] Bot script hot-reload
- [ ] Recording mode: record manual clicks → generate BotScript
- [ ] Distribution as npm package + standalone Electron app

---

## 15. Naming Conventions & Code Standards

| Entity       | Convention                       | Example                      |
| ------------ | -------------------------------- | ---------------------------- |
| Files        | `kebab-case.ts`                | `bot-runner.ts`            |
| Classes      | `PascalCase`                   | `GridManager`              |
| Interfaces   | `PascalCase` (no `I` prefix) | `BotInstance`              |
| Functions    | `camelCase`                    | `launchBrowser()`          |
| Constants    | `UPPER_SNAKE`                  | `DEFAULT_POLL_INTERVAL_MS` |
| IPC channels | `noun:verb`                    | `bot:status`               |
| Enum members | `UPPER_SNAKE`                  | `IpcChannel.BOT_STATUS`    |

All code is **TypeScript strict mode** (`"strict": true`). No `any` except in Puppeteer `evaluate` callbacks.

---

## 16. Testing Strategy

| Level       | Tool                   | Scope                                                     |
| ----------- | ---------------------- | --------------------------------------------------------- |
| Unit        | `vitest`             | FSM interpreter, grid layout math, action/guard functions |
| Integration | `vitest` + Puppeteer | Bot script against a mock HTTP server                     |
| E2E         | Manual + script        | Full run against a live oTree dev server                  |

---

## 17. Glossary

| Term                              | Definition                                                 |
| --------------------------------- | ---------------------------------------------------------- |
| **Bot**                     | A single automated player instance                         |
| **BotScript**               | JSON/TS definition of a bot's FSM                          |
| **Grid**                    | The visual arrangement of bot tiles in the Electron window |
| **Tile / Card**             | One cell in the grid showing a bot's browser and status    |
| **FSM**                     | Finite State Machine driving bot behavior                  |
| **Guard**                   | Boolean condition that gates a state transition            |
| **Action**                  | Puppeteer command executed on a page                       |
| **oTree session-wide link** | URL that assigns the next available participant slot       |
| **CDP**                     | Chrome DevTools Protocol                                   |

---

_End of Blueprint v1.0 — All implementation work derives from this document._

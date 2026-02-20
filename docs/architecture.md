# oTree-Bots — System Architecture & Technical Reference

> **Version:** 2.0 — Post-BrowserView + CDP Screencast Migration
> **Last updated:** 2026-02-19

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [High-Level Architecture](#4-high-level-architecture)
5. [Process Model & Multi-Core Distribution](#5-process-model--multi-core-distribution)
6. [Component Reference](#6-component-reference)
   - 6.1 [Electron Main Process (`index.ts`)](#61-electron-main-process)
   - 6.2 [Grid Manager (`grid-manager.ts`)](#62-grid-manager)
   - 6.3 [Bot Runner (`bot-runner.ts`)](#63-bot-runner)
   - 6.4 [Session Registry (`session-registry.ts`)](#64-session-registry)
   - 6.5 [FSM Engine (`state-machine.ts`)](#65-fsm-engine)
   - 6.6 [Actions (`actions.ts`)](#66-actions)
   - 6.7 [Guards / Conditions (`conditions.ts`)](#67-guards--conditions)
   - 6.8 [Auto-Player Script (`auto-player.ts`)](#68-auto-player-script)
   - 6.9 [CLI Parser (`cli.ts`)](#69-cli-parser)
   - 6.10 [Launcher (`launcher.ts`)](#610-launcher)
   - 6.11 [Logger (`logger.ts`)](#611-logger)
7. [Rendering Architecture](#7-rendering-architecture)
   - 7.1 [Grid Tiles — BrowserView + CDP Screencast](#71-grid-tiles--browserview--cdp-screencast)
   - 7.2 [Focus Window — CDP Screencast (Full-Detail)](#72-focus-window--cdp-screencast-full-detail)
   - 7.3 [Main Renderer — Setup Form, Toolbar, Decision Log](#73-main-renderer--setup-form-toolbar-decision-log)
8. [IPC Protocol](#8-ipc-protocol)
   - 8.1 [Channel Inventory](#81-channel-inventory)
   - 8.2 [Preload Scripts](#82-preload-scripts)
   - 8.3 [Message Flow Diagrams](#83-message-flow-diagrams)
9. [Bot Strategy System](#9-bot-strategy-system)
10. [Finite State Machine (FSM)](#10-finite-state-machine-fsm)
    - 10.1 [BotScript Interface](#101-botscript-interface)
    - 10.2 [FSM Execution Loop](#102-fsm-execution-loop)
    - 10.3 [Auto-Player State Graph](#103-auto-player-state-graph)
11. [Startup & Shutdown Sequences](#11-startup--shutdown-sequences)
12. [Configuration & Defaults](#12-configuration--defaults)
13. [Build System](#13-build-system)
14. [Testing](#14-testing)
15. [Logging & Diagnostics](#15-logging--diagnostics)
16. [Security Model](#16-security-model)
17. [oTree Integration Notes](#17-otree-integration-notes)
18. [Glossary](#18-glossary)

---

## 1. Overview

**oTree-Bots** is a desktop application that automates oTree experiment sessions
by launching N real Chromium browser instances, each driven by a Finite State Machine
(FSM), and displaying their live activity in a unified visual grid.

### Problem Solved

Live-testing oTree experiments requires manually opening G×P browser windows (groups
× players) and clicking through R rounds each — an O(G·P·R) manual workload. oTree-Bots
reduces this to a single command that launches all bots, fills forms according to a
configurable strategy, and visualizes every bot's screen in real time.

### Design Goals

| # | Goal | How it's achieved |
|---|------|-------------------|
| G1 | Launch N real browser instances from one command | Puppeteer spawns N headless Chromium instances |
| G2 | Visual grid — all bots visible simultaneously | BrowserView per bot, CDP screencast for live frames |
| G3 | Deterministic, repeatable bot behavior | Finite-state-machine engine with configurable strategy |
| G4 | Zero manual interaction once started | Auto-player navigates, fills, submits autonomously |
| G5 | Extensible to arbitrary oTree apps | Game-agnostic auto-player + pluggable BotScript format |
| G6 | Multi-core utilization | BrowserView = separate renderer process per bot tile |

---

## 2. Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **App shell** | Electron | ^28.0.0 | Desktop window, BrowserView management, IPC bus |
| **Browser automation** | Puppeteer | ^22.0.0 | Headless Chromium per bot, CDP sessions |
| **Frame streaming** | CDP `Page.startScreencast` | — | Push-based JPEG frame delivery from Chromium compositor |
| **Language** | TypeScript | ^5.3.0 | Strict mode, CommonJS output, ES2022 target |
| **Module system** | CommonJS | — | `require()` in Node/Electron main process |
| **CLI** | yargs | ^17.7.0 | Argument parsing with typed output |
| **Logging** | winston + daily-rotate-file | ^3.19 / ^5.0 | Structured JSON file + coloured console |
| **IDs** | uuid v4 | ^9.0.0 | Unique bot instance identifiers |
| **Testing** | vitest | ^1.2.0 | Unit tests, Node environment, glob-based discovery |
| **Packaging** | electron-builder | ^24.0.0 | Cross-platform distribution (AppImage/dmg/nsis) |
| **Target system** | oTree | 5.x | Python behavioral experiment framework |
| **Runtime** | Node.js | ≥18.0.0 | V8 engine for main process |

---

## 3. Project Structure

```
otree-bots/
├── .env                          # OTREE_SESSION_URL, OTREE_PLAYERS
├── Makefile                      # run, dev, build, otree, up, test, clean
├── package.json                  # Scripts, dependencies
├── tsconfig.json                 # TypeScript config (strict, ES2022, CJS)
├── vitest.config.ts              # Test runner config
├── electron-builder.yml          # Packaging config
├── BLUEPRINT.md                  # Original design blueprint (v1)
│
├── src/
│   ├── engine/                   # Framework-agnostic bot engine
│   │   ├── types.ts              # All shared interfaces, enums, defaults
│   │   ├── state-machine.ts      # FSM interpreter (BotScript → execution)
│   │   ├── actions.ts            # Built-in Puppeteer action executors
│   │   └── conditions.ts         # Built-in guard evaluators
│   │
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # Entry point — window, orchestration
│   │   ├── grid-manager.ts       # BrowserView grid — layout + lifecycle
│   │   ├── bot-runner.ts         # Puppeteer launch, FSM kickoff, CDP screencasts
│   │   ├── session-registry.ts   # Central in-memory bot state store
│   │   ├── ipc-handlers.ts       # IPC command handlers (start/stop/pause/focus)
│   │   ├── cli.ts                # CLI argument parsing
│   │   ├── launcher.ts           # `otree-bots` bin entry (spawns Electron)
│   │   ├── logger.ts             # Winston logger factory
│   │   ├── preload.ts            # Preload for main renderer window
│   │   ├── bot-view-preload.ts   # Preload for per-bot BrowserView tiles
│   │   ├── focus-preload.ts      # Preload for focus (zoom) window
│   │   ├── screenshot-diag.ts    # Screenshot pipeline diagnostics (legacy)
│   │   └── screenshot-rate.ts    # Adaptive FPS computation (legacy)
│   │
│   ├── renderer/                 # Renderer process HTML/JS/CSS
│   │   ├── index.html            # Main window — setup form, toolbar, drawer
│   │   ├── renderer.ts           # Main renderer logic (form, status, log drawer)
│   │   ├── styles.css            # All main window styles
│   │   ├── bot-view.html         # Per-bot tile UI (loaded in each BrowserView)
│   │   ├── focus.html            # Focus/zoom window UI
│   │   └── components/
│   │       ├── bot-card.ts       # (Legacy) bot card component
│   │       └── toolbar.ts        # Toolbar component
│   │
│   └── scripts/                  # Bot scripts (user-land format)
│       ├── auto-player.ts        # Game-agnostic auto-player factory
│       └── poc-bot.ts            # Original PoC hardcoded bot
│
├── test/
│   ├── unit/                     # Unit tests
│   │   ├── state-machine.test.ts
│   │   ├── grid-manager.test.ts
│   │   ├── ipc-handlers.test.ts
│   │   ├── screenshot-rate.test.ts
│   │   ├── session-registry.test.ts
│   │   └── conditions.test.ts
│   └── e2e/
│       └── poc-run.test.ts       # End-to-end test
│
├── otree_project/                # Bundled oTree experiments for testing
│   ├── settings.py
│   ├── dictator/
│   ├── public_goods/
│   ├── signal_conditional_pgg/
│   ├── reshuffle_threshold_pgg/
│   └── matrix_signal_attention/
│
├── docs/                         # Documentation
│   ├── architecture.md           # ← THIS FILE
│   ├── writing-bot-scripts.md
│   └── coding-standards.md
│
└── dist/                         # Build output (gitignored)
    ├── main/                     # Compiled main process code
    └── renderer/                 # Compiled renderer + HTML/CSS assets
```

---

## 4. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          ELECTRON MAIN PROCESS                               │
│                                                                              │
│  ┌──────────────────┐  ┌────────────────┐  ┌─────────────────────────┐      │
│  │   CLI Parser      │  │  Logger        │  │  IPC Handlers           │      │
│  │   (cli.ts)        │  │  (winston)     │  │  (ipc-handlers.ts)      │      │
│  └───────┬──────────┘  └───────┬────────┘  └────────┬────────────────┘      │
│          │                     │                     │                        │
│  ┌───────▼──────────────────────▼─────────────────────▼────────────────┐      │
│  │                      ORCHESTRATOR (index.ts)                        │      │
│  │  Creates window, instantiates components, wires everything          │      │
│  └──┬────────────────┬──────────────────┬─────────────────────────────┘      │
│     │                │                  │                                     │
│  ┌──▼──────────┐  ┌──▼──────────────┐  ┌▼──────────────────────────┐        │
│  │ GridManager  │  │  BotRunner      │  │  SessionRegistry          │        │
│  │ (BrowserView │  │  (Puppeteer +   │  │  (in-memory Map)          │        │
│  │  lifecycle)  │  │   CDP + FSM)    │  │                           │        │
│  └──┬──────────┘  └──┬──────────────┘  └───────────────────────────┘        │
│     │                │                                                       │
│  ┌──▼────────────────▼──────────────────────────────────────────────────┐    │
│  │                     CDP Screencast Pipeline                          │    │
│  │  • Grid tiles: quality=60, sized to cell bounds                      │    │
│  │  • Focus window: quality=80, sized to focus window                   │    │
│  │  • Push-based frame delivery via Page.screencastFrame events         │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─ Renderer Processes (OS-level, one per BrowserView) ──────────────────┐  │
│  │                                                                        │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │  │
│  │  │ BotView  │ │ BotView  │ │ BotView  │ │ BotView  │  ... × N        │  │
│  │  │ (bot 0)  │ │ (bot 1)  │ │ (bot 2)  │ │ (bot 3)  │                 │  │
│  │  │ pid=A    │ │ pid=B    │ │ pid=C    │ │ pid=D    │ (one per core)   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘                 │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─ Main Renderer Process ───────────────────────────────────────────────┐  │
│  │  index.html + renderer.ts: Setup form, toolbar, decision log drawer   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─ Focus Window (optional, on-demand) ──────────────────────────────────┐  │
│  │  focus.html: Full-res live view of one bot + real-time log panel      │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
    ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
    │  Puppeteer    │        │  Puppeteer    │        │  Puppeteer    │
    │  Browser #0   │        │  Browser #1   │        │  Browser #N   │
    │  (headless)   │        │  (headless)   │        │  (headless)   │
    └──────┬───────┘        └──────┬───────┘        └──────┬───────┘
           │                        │                        │
           ▼                        ▼                        ▼
    ┌──────────────────────────────────────────────────────────────┐
    │              oTree Server  (localhost:8099)                   │
    │              Python / Django / WebSocket                     │
    └──────────────────────────────────────────────────────────────┘
```

---

## 5. Process Model & Multi-Core Distribution

The system exploits Chromium's multi-process architecture to distribute work across
all available CPU cores. There are three layers of process separation:

### 5.1 Electron Process Hierarchy

```
┌─────────────────────────────────────────────────┐
│ Electron Main Process (Node.js)                 │  1 process
│   Runs: index.ts, bot-runner, grid-manager,     │
│   session-registry, IPC handlers                │
├─────────────────────────────────────────────────┤
│ Main Renderer Process                           │  1 process
│   Runs: index.html + renderer.ts (setup/toolbar)│
├─────────────────────────────────────────────────┤
│ BrowserView Renderer Processes                  │  N processes
│   Each runs: bot-view.html (one per bot tile)   │  (1 per bot)
│   Each gets its own OS pid → distributed        │
│   across cores by Chromium's scheduler          │
├─────────────────────────────────────────────────┤
│ Focus Window Renderer Process                   │  0-1 process
│   Runs: focus.html (opened on demand)           │  (optional)
└─────────────────────────────────────────────────┘
```

### 5.2 Puppeteer Process Hierarchy

```
┌─────────────────────────────────────────────────┐
│ Puppeteer Browser 0  (separate Chromium binary) │  1 process tree
│   └─ Browser Process + Renderer Process         │  per bot
│       └─ Page (oTree game session)              │
├─────────────────────────────────────────────────┤
│ Puppeteer Browser 1                             │
│   └─ Browser Process + Renderer Process         │
├─────────────────────────────────────────────────┤
│ ... × N                                         │
└─────────────────────────────────────────────────┘
```

### 5.3 Total Process Count

For N bots: approximately **2 + N (BrowserViews) + 2N (Puppeteer browser+renderer)** OS processes.
Chromium automatically distributes renderer processes across available CPU cores via its
process-per-site model. No manual affinity pinning is needed.

---

## 6. Component Reference

### 6.1 Electron Main Process

**File:** `src/main/index.ts`

The entry point and orchestrator. Responsibilities:

1. **Parse CLI** — calls `parseCLI()` to extract URL, player count, strategy, etc.
2. **Create window** — single `BrowserWindow` with context-isolated preload
3. **Instantiate components** — `GridManager`, `SessionRegistry`, `BotRunner`
4. **Wire IPC** — register command handlers, forward open-drawer events
5. **Handle start/restart** — `handleStartRequest()` validates and launches bots
6. **Handle resize** — `gridManager.refresh()` repositions all BrowserViews

Key globals:
- `mainWindow` — the Electron BrowserWindow
- `gridManager` — manages BrowserView grid layout
- `registry` — central bot state store
- `botRunner` — Puppeteer + FSM orchestrator

---

### 6.2 Grid Manager

**File:** `src/main/grid-manager.ts`
**Class:** `GridManager`

Manages the grid of `BrowserView` instances — one per bot. Each BrowserView runs
in its own Chromium renderer process (multi-core distribution is automatic).

#### Layout Algorithm

Given N bots in a window of W×H pixels:

```
cols = forceCols ?? ceil(sqrt(N))
rows = ceil(N / cols)

Available height = containerH - TOOLBAR_HEIGHT(36) - gaps
cellWidth  = floor((W - CELL_GAP(2) × (cols + 1)) / cols)
cellHeight = floor((gridH - CELL_GAP(2) × (rows + 1)) / rows)

cell[i].x = CELL_GAP + (i % cols) × (cellWidth + CELL_GAP)
cell[i].y = TOOLBAR_HEIGHT + CELL_GAP + floor(i / cols) × (cellHeight + CELL_GAP)
```

#### BrowserView Lifecycle

| Method | Purpose |
|--------|---------|
| `computeLayout(count, cols?)` | Calculate grid cell positions |
| `createBotView(slot, botId)` | Create BrowserView, position it, load `bot-view.html` |
| `getBotView(botId)` | Retrieve a BotView by bot ID |
| `sendScreenshot(botId, dataUrl)` | Forward CDP screencast frame to tile |
| `sendBotInfo/Status/State()` | Forward metadata to tile |
| `refresh(count, cols?)` | Recompute layout + reposition views (on resize) |
| `broadcastLayout()` | Send layout to main renderer (toolbar status) |
| `destroyAllViews()` | Remove and destroy all BrowserViews (on restart/quit) |

---

### 6.3 Bot Runner

**File:** `src/main/bot-runner.ts`
**Class:** `BotRunner`

The core automation engine. Spawns Puppeteer browsers, navigates to oTree,
runs FSMs, and manages CDP screencasts for both grid and focus windows.

#### Browser Launch

Each bot gets its own headless Chromium instance:
- Viewport: 640×360 (optimized for grid tile streaming)
- Args: `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`
- Separate process tree per bot = full cookie/session isolation

#### CDP Screencast (Grid)

When a bot's FSM starts, `startGridScreencast()` creates a CDP session and
calls `Page.startScreencast`:

```
Page.startScreencast {
  format: "jpeg",
  quality: 60,           // lower quality for small grid tiles
  maxWidth: <cell width>,
  maxHeight: <cell height - 24>,  // minus header bar
  everyNthFrame: 1
}
```

Frames arrive as `Page.screencastFrame` events → forwarded to the bot's
BrowserView via `gridManager.sendScreenshot()`. Each frame is acknowledged
with `Page.screencastFrameAck` so CDP continues sending.

#### CDP Screencast (Focus)

When the user right-clicks a tile, `openFocusWindow()` creates a dedicated
floating window with its own CDP screencast at quality=80 and window-sized
resolution. The bot's Puppeteer viewport is resized to match the focus window
and restored when the focus window closes.

#### FSM Callbacks

The FSM runner emits events (state change, log, status change, error) which
`BotRunner` forwards to:
1. Main renderer (toolbar status, decision log)
2. Grid BrowserView (tile header updates)
3. Focus window (if open for that bot)

---

### 6.4 Session Registry

**File:** `src/main/session-registry.ts`
**Class:** `SessionRegistry`

Thread-safe (event-loop-safe) central store for all `BotInstance` objects.
Essentially a `Map<string, BotInstance>` with convenience methods:

| Method | Purpose |
|--------|---------|
| `createBot(index, script)` | Allocate UUID, initialize bot state |
| `getBot(id)` | Lookup by ID |
| `getAllBots()` | List all bots |
| `updateStatus(id, status)` | Set running/paused/done/error |
| `updateCurrentState(id, state)` | Track FSM state transitions |
| `addLog(id, entry)` | Append log entry |
| `setError(id, error)` | Mark bot as errored |
| `allFinished()` | True when all bots are done or error |
| `destroyAll()` | Close all pages/browsers with staggered cleanup (35ms gap) |
| `toJSON()` | Serializable snapshot for IPC |

---

### 6.5 FSM Engine

**File:** `src/engine/state-machine.ts`
**Class:** `StateMachineRunner`

A pure FSM interpreter with no knowledge of Electron, oTree, or the grid.
Takes a `BotScript` + Puppeteer `Page` and runs until a terminal state.

#### Execution Model

```
1. Enter state → execute onEntry actions sequentially
2. If state is final → status = "done", stop
3. Poll transitions:
   - For each transition, evaluate guard
   - First passing guard → transition to target state
   - No guard = immediate transition
   - Poll interval: configurable delay per transition (default 250ms)
   - Timeout: 120 seconds → error
4. Transition → go to step 1
```

#### Control Flow

| Method | Effect |
|--------|--------|
| `run()` | Start FSM, resolves on completion |
| `pause()` | Set status to paused, loop stops at next check |
| `resume()` | Resume from paused, re-enter run loop |
| `stop()` | Permanently stop (status = done) |

---

### 6.6 Actions

**File:** `src/engine/actions.ts`

Built-in action executors. Each takes a Puppeteer Page and an Action descriptor:

| Action Type | Parameters | Behavior |
|-------------|-----------|----------|
| `click` | `selector` | Wait for selector, click element |
| `clickAndNavigate` | `selector` | Atomic click + waitForNavigation (handles form validation gracefully) |
| `fill` | `selector`, `value` | Triple-click to select all, type new value |
| `select` | `selector`, `value` | Select dropdown option by value |
| `wait` | `value` (ms) | Static delay (multiplied by `delayMultiplier`) |
| `waitForNavigation` | — | Wait for page navigation to complete |
| `waitForSelector` | `selector` | Wait for element to appear in DOM |
| `reload` | — | Reload page (waitUntil: domcontentloaded) |
| `evaluate` | `value` (JS string) | Execute arbitrary JavaScript in page context |
| `fillFormFields` | `strategyConfig` | Discover and fill all form fields using strategy |
| `screenshot` | — | Capture screenshot, return as base64 log entry |
| `log` | `value` (message) | Return a log entry |

#### `fillFormFields` — Visible Form Filling

The key action for oTree automation. Works in two phases:

1. **Discovery** — `page.evaluate()` scans the DOM for all `<input>`, `<select>`,
   `<textarea>`, radio groups, and checkboxes. Returns an array of `DiscoveredField`
   objects with type, selector, and metadata (min/max/options/etc.).

2. **Interaction** — For each field, uses real Puppeteer methods (`page.click()`,
   `page.type()`, `page.select()`) so interactions are visible in the screencast.
   Applies the configured `BotStrategy` to determine values.

Selector priority: `#id` > `[name="..."]` > positional `nth-of-type`.

---

### 6.7 Guards / Conditions

**File:** `src/engine/conditions.ts`

Guard evaluators return boolean — used by the FSM to gate transitions:

| Guard Type | Parameters | Evaluates |
|-----------|-----------|----------|
| `elementExists` | `selector` | `page.$(selector) !== null` |
| `elementNotExists` | `selector` | `page.$(selector) === null` |
| `urlContains` | `value` | `page.url().includes(value)` |
| `urlEquals` | `value` | `page.url() === value` |
| `textContains` | `selector`, `value` | `element.textContent.includes(value)` |
| `custom` | `fn` (JS string) | `page.evaluate(fn)` → boolean |

---

### 6.8 Auto-Player Script

**File:** `src/scripts/auto-player.ts`
**Function:** `createAutoPlayer(strategy)`

Factory that generates a game-agnostic `BotScript` from a `BotStrategy`.
Works with any standard oTree experiment without game-specific code.

States: `navigate` → `waitForPage` → `handleWaitPage` | `queueNextRound` | `fillAndSubmit` → `clickNext` → loop → `done`

See [Section 10.3](#103-auto-player-state-graph) for the full state diagram.

---

### 6.9 CLI Parser

**File:** `src/main/cli.ts`

Parses `process.argv` using yargs. Supports args after `--` separator (Electron compatibility).

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--url` | `-u` | string | `""` | oTree session URL |
| `--players` | `-n` | number | 2 | Number of bot players |
| `--script` | `-s` | string | `poc-bot.js` | Path to bot script |
| `--cols` | — | number | auto | Force grid columns |
| `--delay` | — | number | 1.0 | Global action delay multiplier |
| `--strategy` | — | string | `random` | Strategy preset name |
| `--headless` | — | boolean | false | Skip UI, start immediately |
| `--verbose` | `-v` | boolean | false | Debug-level logging |

---

### 6.10 Launcher

**File:** `src/main/launcher.ts`

The `otree-bots` npm bin entry point. Resolves the Electron binary path and
spawns it with `index.js` as the main script, forwarding user arguments after `--`.

---

### 6.11 Logger

**File:** `src/main/logger.ts`

Centralized logging via Winston:

| Transport | Format | Level | Rotation |
|-----------|--------|-------|----------|
| Console | Coloured, human-readable | info (debug in verbose) | — |
| File | JSON lines | debug | Daily, 20MB max, 14-day retention |
| Error file | JSON lines | error | Daily, 10MB max, 30-day retention |

Child loggers created via `createChildLogger('component-name')` scope all
messages to a named component (e.g., `[bot-runner]`, `[grid-mgr]`, `[main]`).

Log directory: `<electron-userData>/logs/` (or `./logs/` during development).

---

## 7. Rendering Architecture

The rendering system uses three distinct patterns, all based on CDP screencast:

### 7.1 Grid Tiles — BrowserView + CDP Screencast

Each bot gets its own Electron `BrowserView` — a lightweight embedded browser
that runs in a separate OS-level renderer process.

```
                  Puppeteer Browser (bot N)
                           │
                     CDP Session
                           │
    Page.startScreencast(jpeg, q=60, w×h)
                           │
                  ┌────────▼────────┐
                  │ Page.screencast │
                  │ Frame event     │──── data: base64 JPEG
                  └────────┬────────┘
                           │
                  Page.screencastFrameAck
                           │
              ┌────────────▼────────────┐
              │   gridManager           │
              │ .sendScreenshot(id, url)│
              └────────────┬────────────┘
                           │
                  IPC to BrowserView
                 (botview:screenshot)
                           │
              ┌────────────▼────────────┐
              │   bot-view.html         │
              │   img.src = dataUrl     │
              └─────────────────────────┘
```

**Key properties:**
- **Push-based** — Chromium's compositor decides when to send frames
- **No polling** — eliminates the frame starvation that plagued the old screenshot loop
- **Multi-process** — each BrowserView tile runs in its own renderer process
- **CPU-distributed** — Chromium scheduler spreads renderer processes across cores

### 7.2 Focus Window — CDP Screencast (Full-Detail)

Right-clicking a grid tile opens a floating window with a higher-quality screencast:

| Aspect | Grid Tile | Focus Window |
|--------|-----------|-------------|
| Quality | 60 (JPEG) | 80 (JPEG) |
| Resolution | Cell size (~300×200) | Window size (~900×700) |
| Viewport | Default (640×360) | Resized to match window |
| Extras | Status dot, state label | Log panel, pause/resume buttons |

The focus window resizes the bot's Puppeteer viewport to match the window dimensions.
On close, the viewport is restored to its original size.

### 7.3 Main Renderer — Setup Form, Toolbar, Decision Log

**File:** `src/renderer/renderer.ts` + `src/renderer/index.html`

The main renderer does NOT display bot screenshots (that's handled by BrowserViews).
It provides:

1. **Setup screen** — URL input, player count, strategy preset selector with
   detailed field-by-field customization, speed slider
2. **Toolbar** — app title, logs button, status counter, restart/stop buttons
3. **Decision log drawer** — chronological log of all bot actions and state transitions,
   filterable by bot with tab + dropdown navigation

---

## 8. IPC Protocol

### 8.1 Channel Inventory

All IPC uses typed channels defined in the `IpcChannel` enum (`src/engine/types.ts`):

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `grid:layout` | Main → Renderer | `GridLayout` | Grid dimensions for status tracking |
| `bot:status` | Main → Renderer | `{id, index, status}` | Bot status updates (toolbar) |
| `bot:state-change` | Main → Renderer | `{id, index, state}` | FSM state transitions (log) |
| `bot:log` | Main → Renderer | `{id, index, entry}` | Decision log entries |
| `run:all-done` | Main → Renderer | — | All bots finished signal |
| `cmd:start` | Renderer → Main | `{url, playerCount, strategy}` | Start run request |
| `cmd:stop` | Renderer → Main | — | Stop all bots |
| `cmd:restart` | Renderer → Main | — | Reset to setup screen |
| `cmd:pause-bot` | Renderer → Main | `{id}` | Pause specific bot |
| `cmd:resume-bot` | Renderer → Main | `{id}` | Resume specific bot |
| `cmd:focus-bot` | BotView → Main | `{id}` | Open focus window (right-click) |
| `cmd:open-drawer` | BotView → Main → Renderer | `{id, index}` | Open log drawer for bot (left-click) |
| `botview:screenshot` | Main → BotView | `dataUrl` | CDP screencast frame |
| `botview:info` | Main → BotView | `{id, index, status, state}` | Initial bot identity |
| `botview:status` | Main → BotView | `status` | Status change |
| `botview:state` | Main → BotView | `state` | FSM state change |
| `focus:screenshot` | Main → Focus | `dataUrl` | CDP screencast frame |
| `focus:bot-info` | Main → Focus | `{id, index, status, state, logs}` | Initial identity + log backfill |
| `focus:bot-log` | Main → Focus | `LogEntry` | Incremental log entry |
| `focus:bot-status` | Main → Focus | `status` | Status change |
| `focus:bot-state` | Main → Focus | `state` | FSM state change |
| `open-drawer-for-bot` | Main → Renderer | `{id, index}` | Forwarded from BotView click |

### 8.2 Preload Scripts

Three preload scripts, each exposing a minimal API via `contextBridge.exposeInMainWorld()`:

| Preload | Exposed As | Target | Channels |
|---------|-----------|--------|----------|
| `preload.ts` | `window.otreeBots` | Main renderer | grid:layout, bot:status/state/log, all-done, open-drawer, sendCommand |
| `bot-view-preload.ts` | `window.botViewApi` | Per-bot BrowserView | botview:screenshot/info/status/state, sendCommand |
| `focus-preload.ts` | `window.focusApi` | Focus window | focus:screenshot/info/log/status/state, sendCommand |

All preloads use inline channel strings (not imported from types.ts) because
Electron 28+ sandboxes preload scripts.

### 8.3 Message Flow Diagrams

#### Bot Launch Flow

```
Renderer (setup form)          Main Process              Puppeteer           oTree
       │                           │                        │                  │
       │ cmd:start {url,n,strat}   │                        │                  │
       │──────────────────────────▶│                        │                  │
       │                           │ computeLayout(n)       │                  │
       │                           │ createBotView(×N)      │                  │
       │                           │──puppeteer.launch()───▶│                  │
       │                           │◀──browser──────────────│                  │
       │                           │──page.goto(url)────────│─────────────────▶│
       │                           │◀──page loaded──────────│◀────────────────│
       │                           │──startFSM(bot)         │                  │
       │                           │──startGridScreencast()─│                  │
       │                           │                        │                  │
       │◀──grid:layout─────────────│                        │                  │
 BrowserView                       │                        │                  │
       │◀──botview:info────────────│                        │                  │
       │◀──botview:screenshot──────│◀──screencastFrame──────│                  │
       │◀──botview:screenshot──────│◀──screencastFrame──────│                  │
       │  (continuous push-based)  │  (continuous push)     │                  │
```

#### Focus Window Flow

```
Bot Tile (BrowserView)    Main Process        Focus Window       Puppeteer
       │                      │                    │                 │
       │ cmd:focus-bot {id}   │                    │                 │
       │─────────────────────▶│                    │                 │
       │                      │ createBrowserWindow│                 │
       │                      │ loadFile(focus.html)                 │
       │                      │───────────────────▶│                 │
       │                      │ setViewport(w,h)   │                 │
       │                      │────────────────────│────────────────▶│
       │                      │ Page.startScreencast(q=80)          │
       │                      │────────────────────│────────────────▶│
       │                      │◀───screencastFrame─│◀───────────────│
       │                      │──focus:screenshot──▶│                │
       │                      │  (continuous)       │                │
```

---

## 9. Bot Strategy System

Strategies configure how the auto-player fills form fields. This makes the system
game-agnostic — the same bot works for any oTree experiment.

### Strategy Interface

```typescript
interface BotStrategy {
  name: string;
  numberStrategy: 'min' | 'max' | 'midpoint' | 'random' | 'fixed';
  numberFixedValue: number;
  textValue: string;
  selectStrategy: 'first' | 'last' | 'random';
  radioStrategy: 'first' | 'last' | 'random';
  checkboxStrategy: 'all' | 'none' | 'random';
  submitDelay: number;        // ms before clicking submit
  actionDelayMs: number;      // ms between field interactions
}
```

### Built-in Presets

| Preset | Numbers | Text | Select | Radio | Checkbox | Speed |
|--------|---------|------|--------|-------|----------|-------|
| **Random** | Random in [min,max] | "test" | Random | Random | Random | 300ms |
| **Minimum** | min | "a" | First | First | None | 300ms |
| **Maximum** | max | "test response" | Last | Last | All | 300ms |
| **Midpoint** | (min+max)/2 | "test" | First | First | All | 300ms |
| **Fixed** | Clamped fixed value | "test" | First | First | All | 300ms |

The setup form allows custom configuration of each dimension independently,
plus a speed slider (0–1000ms between field interactions, 0 = instant).

---

## 10. Finite State Machine (FSM)

### 10.1 BotScript Interface

```typescript
interface BotScript {
  name: string;                              // Display name
  initialState: string;                      // Starting state ID
  states: Record<string, StateDefinition>;   // State definitions
  config?: BotConfig;                        // Viewport/proxy overrides
}

interface StateDefinition {
  onEntry: Action[];       // Actions executed sequentially on entry
  transitions: Transition[];  // Evaluated in order; first passing guard wins
  final?: boolean;         // Terminal state — bot stops here
}

interface Transition {
  target: string;          // Target state ID
  guard?: Guard;           // Optional condition (no guard = immediate)
  delay?: number;          // Poll interval in ms
}
```

### 10.2 FSM Execution Loop

```
┌─────── run() ──────────────────────────────────────────────┐
│                                                             │
│  status = "running"                                         │
│                                                             │
│  while (status === "running"):                              │
│    state = script.states[currentState]                      │
│                                                             │
│    ┌─ Execute onEntry Actions ───────────────────────┐      │
│    │ for action in state.onEntry:                     │      │
│    │   log action description                         │      │
│    │   executeAction(page, action)                    │      │
│    │   if actionDelayMs > 0: sleep(actionDelayMs)     │      │
│    └──────────────────────────────────────────────────┘      │
│                                                             │
│    if state.final: status = "done", return                  │
│                                                             │
│    ┌─ Poll Transitions ──────────────────────────────┐      │
│    │ while (status === "running"):                    │      │
│    │   for t in state.transitions:                    │      │
│    │     if !t.guard OR evaluateGuard(page, t.guard): │      │
│    │       currentState = t.target                    │      │
│    │       emit stateChange                           │      │
│    │       break → next iteration of outer loop       │      │
│    │   sleep(pollInterval)                            │      │
│    │   if elapsed > maxPollTime: throw timeout        │      │
│    └──────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 10.3 Auto-Player State Graph

```
                    ┌───────────┐
                    │ navigate  │
                    └─────┬─────┘
                          │ url loaded
                          ▼
                  ┌───────────────┐
           ┌──────│ waitForPage   │◀──────────────────────┐
           │      └─┬───┬───┬──┬─┘                        │
           │        │   │   │  │                           │
  WaitPage │   queue│   │   │  │ button only               │
           │        │   │   │  │                           │
           ▼        ▼   │   │  ▼                           │
  ┌────────────┐ ┌──────┴──┐│ ┌───────────┐               │
  │ handleWait │ │ queue   ││ │ clickNext │───────────────┘
  │ Page       │ │ NextRnd ││ └───────────┘
  └──────┬─────┘ └────┬────┘│
         │             │     │ form fields
         │ no longer   │     ▼
         │ wait page   │ ┌──────────────┐
         └─────────────┘ │fillAndSubmit │
                         └──────┬───────┘
                                │
              OutOfRangeNotification at any point
                                │
                                ▼
                          ┌──────┐
                          │ done │
                          └──────┘
```

**WaitPage handling:** The bot does NOT reload. oTree WaitPages include built-in
JavaScript (`waitForRedirect`) that auto-redirects when the group is ready.
The bot simply loops with 3-second sleeps until the redirect occurs.

---

## 11. Startup & Shutdown Sequences

### Startup

```
1. app.whenReady()
2. parseCLI() → AppConfig
3. setVerbose(config.debug)
4. createWindow(config) → BrowserWindow
   └─ Loads index.html with query params (defaultUrl, defaultPlayers)
   └─ Renderer shows setup form
5. Instantiate GridManager, SessionRegistry, BotRunner
6. botRunner.setGridManager(gridManager)
7. registerIpcHandlers(botRunner, handleStart, handleRestart)
8. Register CMD_OPEN_DRAWER forwarding
9. Register window resize handler
10. If headless: handleStartRequest() immediately
    Otherwise: wait for user to submit setup form

>>> User submits setup form >>>

11. handleStartRequest(payload)
    a. normalizeStartPayload() → validate URL and player count
    b. Build BotStrategy from form values or CLI preset
    c. launchBots(config):
       i.   gridManager.computeLayout(N)
       ii.  gridManager.broadcastLayout()
       iii. For each bot (0..N-1):
            - registry.createBot(i, script)
            - gridManager.createBotView(i, botId)
       iv.  For each bot (concurrent):
            - botRunner.launchBrowser(bot)
            - botRunner.navigate(bot, url)
            - botRunner.startFSM(bot, actionDelayMs)
              └─ startGridScreencast(bot)
              └─ runner.run() (async background)
```

### Shutdown

```
1. botRunner.stopAll():
   a. Stop all grid screencasts (Page.stopScreencast + CDP detach)
   b. Stop all FSM runners (.stop())
   c. Close all focus windows + their screencasts
   d. gridManager.destroyAllViews()
   e. registry.destroyAll():
      └─ For each bot (sequential, 35ms stagger):
         - page.close({ runBeforeUnload: true })
         - browser.close()
      └─ Clear registry Map
2. app.quit()
```

---

## 12. Configuration & Defaults

Defined in `src/engine/types.ts` → `DEFAULTS`:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `playerCount` | 2 | Default number of bots |
| `pollIntervalMs` | 250 | FSM transition poll interval |
| `maxPollTimeMs` | 120,000 | Max time waiting for a transition guard |
| `navigationTimeoutMs` | 30,000 | Page navigation timeout |
| `actionTimeoutMs` | 10,000 | Individual action timeout |
| `retryCount` | 2 | Action retry attempts |
| `retryBackoffMs` | 1,000 | Backoff between retries |
| `screenshotQuality` | 40 | JPEG quality for log screenshots |
| `captureViewportWidth` | 640 | Default bot viewport width |
| `captureViewportHeight` | 360 | Default bot viewport height |

**CDP Screencast Quality:**
- Grid tiles: 60 (small, don't need high detail)
- Focus window: 80 (full resolution, user is inspecting)

**Environment variables** (`.env`):
- `OTREE_SESSION_URL` — Default session URL
- `OTREE_PLAYERS` — Default player count

---

## 13. Build System

### TypeScript Compilation

```json
{
  "target": "ES2022",
  "module": "commonjs",
  "strict": true,
  "rootDir": "./src",
  "outDir": "./dist",
  "sourceMap": true,
  "declaration": true
}
```

### Scripts

| Command | Action |
|---------|--------|
| `npm run build` | `tsc` + copy HTML/CSS to `dist/renderer/` |
| `npm run dev` | Build + launch Electron with `--verbose` |
| `npm run watch` | TypeScript watch mode |
| `npm run test` | Run all vitest tests |
| `npm run test:unit` | Run unit tests only |
| `npm run clean` | Remove `dist/` |
| `npm run rebuild` | Clean + build |
| `npm run package` | Build distributable via electron-builder |

### Makefile Targets

| Target | Description |
|--------|-------------|
| `make run` | Build + launch with `.env` config |
| `make dev` | Build + launch with verbose logging |
| `make otree` | Start oTree devserver on port 8099 |
| `make up` | Start oTree + launch Electron (auto-stops oTree on exit) |
| `make test` | Run tests |
| `make clean` | Remove build artifacts |

### Build Output

```
dist/
├── main/
│   ├── index.js          # Electron entry point
│   ├── bot-runner.js
│   ├── grid-manager.js
│   ├── session-registry.js
│   ├── ipc-handlers.js
│   ├── cli.js
│   ├── launcher.js       # otree-bots bin
│   ├── logger.js
│   ├── preload.js
│   ├── bot-view-preload.js
│   ├── focus-preload.js
│   └── ...
├── renderer/
│   ├── index.html
│   ├── styles.css
│   ├── renderer.js
│   ├── bot-view.html
│   └── focus.html
├── engine/
│   ├── types.js
│   ├── state-machine.js
│   ├── actions.js
│   └── conditions.js
└── scripts/
    ├── auto-player.js
    └── poc-bot.js
```

---

## 14. Testing

**Framework:** vitest v1.2.0, Node environment, 30-second timeout

| Test File | Coverage |
|-----------|----------|
| `state-machine.test.ts` | FSM execution, state transitions, pause/resume, timeouts |
| `grid-manager.test.ts` | Layout computation (cell positions, gaps, toolbar offset) |
| `ipc-handlers.test.ts` | Channel registration counts, cleanup |
| `session-registry.test.ts` | Bot CRUD, status updates, serialization, destroy |
| `conditions.test.ts` | Guard evaluation (all 6 guard types) |
| `screenshot-rate.test.ts` | Adaptive FPS budget calculation |

Run:
```bash
npm run test           # All tests
npm run test:unit      # Unit tests only
npm run test:watch     # Watch mode
```

---

## 15. Logging & Diagnostics

### Runtime Logs

| Log File | Contents | Retention |
|----------|----------|-----------|
| `otree-bots-YYYY-MM-DD.log` | All events (debug+), JSON lines | 14 days, 20MB max |
| `otree-bots-error-YYYY-MM-DD.log` | Errors only, JSON lines | 30 days, 10MB max |
| Console | Coloured human-readable, info+ (debug in verbose) | — |

### Log Components

Each logger is scoped to a component:
`[main]`, `[bot-runner]`, `[grid-mgr]`, `[registry]`, `[ipc]`, `[renderer]`, `[fsm]`

### Screenshot Diagnostics (Legacy)

`screenshot-diag.ts` and `screenshot-rate.ts` remain in the codebase from the
pre-screencast era. They provided diagnostic logging for the polling-based
screenshot pipeline. The grid no longer uses them — frames arrive via CDP
screencast events. These files are retained for potential future diagnostic use.

---

## 16. Security Model

| Concern | Mitigation |
|---------|-----------|
| `nodeIntegration` in renderers | Disabled — all windows use `contextIsolation: true` |
| `sandbox` | Set to `false` only to allow `require('electron')` in preload |
| Preload API surface | Minimal — only specific IPC channels exposed |
| `<webview>` tag | Enabled in main window but not used (BrowserViews used instead) |
| `page.evaluate()` | Runs in Chromium sandbox; no node access |
| Bot scripts | Local files only; no remote loading |
| CSP | `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'` |
| Puppeteer Chromium args | `--no-sandbox` (required for containerized environments) |

---

## 17. oTree Integration Notes

### Session URLs

oTree provides two URL types:
- **Session-wide link** — `http://host:port/join/<code>` — assigns next available participant slot
- **Room URL** — `http://host:port/room/<name>` — persistent participant slots

Bots navigate to the session-wide link. Each bot gets a unique participant ID
because each call to the URL assigns the next slot.

### WaitPage Handling

oTree WaitPages include inline JavaScript that polls the server and auto-redirects
when all group members are ready (`waitForRedirect`). The bot does NOT reload or
navigate — it simply waits for the built-in redirect. This is critical because
reloading would destroy the JavaScript context and miss the redirect signal.

### Form Detection

The `fillFormFields` action detects all standard oTree form widgets:
- `<input type="number">` with `min`/`max`/`step` attributes
- `<input type="text">`, `<textarea>`
- `<select>` dropdowns (skips blank placeholder options)
- `<input type="radio">` grouped by `name`
- `<input type="checkbox">`

### Game Completion

The bot detects game completion via `OutOfRangeNotification` in the URL —
this is the standard oTree behavior when a participant tries to access a page
beyond the experiment's defined sequence.

### Bundled Experiments

The `otree_project/` directory includes several oTree apps for testing:
- `dictator` — Basic dictator game
- `public_goods` — Public goods contribution game
- `signal_conditional_pgg` — Signal + conditional PGG
- `reshuffle_threshold_pgg` — Reshuffle threshold PGG
- `matrix_signal_attention` — Matrix game with attention checks

---

## 18. Glossary

| Term | Definition |
|------|-----------|
| **Bot** | A single automated player instance (Puppeteer browser + FSM) |
| **BotScript** | TypeScript/JSON definition of a bot's FSM (states, actions, guards) |
| **BotStrategy** | Configuration for how form fields are filled (game-agnostic) |
| **BrowserView** | Electron API for embedding a separate renderer process in a window |
| **CDP** | Chrome DevTools Protocol — the wire protocol for browser automation |
| **CDP Screencast** | `Page.startScreencast` — push-based JPEG frame streaming from Chromium |
| **FSM** | Finite State Machine — drives bot behavior through sequential states |
| **Grid** | The visual arrangement of bot tiles in the Electron window |
| **Grid Manager** | Component managing BrowserView layout, creation, and IPC forwarding |
| **Guard** | Boolean condition that gates an FSM state transition |
| **Action** | Puppeteer command executed on a page (click, fill, wait, etc.) |
| **Focus Window** | On-demand floating window showing one bot at full resolution |
| **Decision Log** | Chronological record of all bot actions and state transitions |
| **Tile / Card** | One cell in the grid showing a bot's live screenshot and status |
| **oTree session-wide link** | URL that assigns the next available participant slot |
| **SessionRegistry** | In-memory store tracking all bot instances and their state |
| **Preload** | Electron script that bridges main ↔ renderer via `contextBridge` |
| **WaitPage** | oTree page where players wait for group members (auto-redirects) |

---

*End of Architecture Documentation v2.0*

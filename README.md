# oBots — Open Bot Online Testing Suite

> Spawn a fleet of live bots, watch them play your oTree experiment in real time, across multiple screens, simultaneously.

oBots is an open-source Electron desktop app that lets researchers stress-test, pilot, and observe any [oTree](https://www.otree.org/) behavioral experiment by running fully automated bot players — no modifications to your experiment code required.

---

## What it does

You point oBots at your oTree session URL, set a player count, choose a behavior strategy, and hit **Start**. oBots spawns that many headless Chromium browsers, navigates each one to your experiment, and drives them autonomously through every page — filling forms, clicking buttons, handling wait pages — while streaming live video of each bot's screen into a real-time grid you can watch and interact with.

---

## Features

### Live bot grid
Every bot gets its own tile in the window. Each tile streams a **live CDP screencast** — not polling, not periodic screenshots — so you see exactly what the bot sees as it happens. The grid auto-computes a square-ish layout for any number of bots and reflows when you resize the window.

### Focus window
Click any bot tile to pop open a **full-size focus window** with a live, adaptive screencast. The viewport resizes with the window and the screencast restarts seamlessly. Backfilled logs appear immediately on open.

### Run overview
Open a **separate overview window** that shows the status, current FSM state, log count, and any errors for every bot in the run, updated every second.

### Game-agnostic auto-player
The built-in auto-player works with **any standard oTree experiment** without game-specific configuration. It detects and handles:

- **Form pages** — fills all inputs and submits
- **WaitPages** — waits for the group, nudges oTree's JS polling hooks, and recovers from stuck or stale wait pages automatically
- **Named-button decision pages** — e.g. Prisoner's Dilemma "Choice A / Choice B" (`<button name="field" value="x">`)
- **Results / next pages** — clicks through automatically
- **Terminal pages** — detects game-over via URL (`OutOfRangeNotification`) or page content and stops cleanly

### Configurable behavior strategies
Five built-in strategy presets control how every form field is filled:

| Strategy | Numbers | Dropdowns | Radios | Checkboxes |
|----------|---------|-----------|--------|-----------|
| **Random** | Random in `[min, max]` | Random option | Random | Random |
| **Minimum** | `min` | First option | First | None |
| **Maximum** | `max` | Last option | Last | All |
| **Midpoint** | `(min + max) / 2` | First option | First | All |
| **Fixed** | Fixed value (clamped to range) | First option | First | All |

All strategies support configurable **action delay** and **random jitter** to produce human-like timing, and an optional **submit delay** before clicking next.

### Repeat rounds
Set a repeat count and oBots will automatically run the full experiment N times back-to-back, tearing down and re-launching between rounds without any manual intervention.

### URL injection
For Prolific-style experiments, oBots can inject per-bot URL parameters automatically using templates:

```
participantId: participant-{runTs}-{bot}-{rand}
assignmentId:  assignment-{runTs}-{bot}
projectId:     project-{runTs}
```

Available template variables: `{bot}` (1-based index), `{bot0}` (0-based), `{runTs}` (run timestamp), `{runRand}` (run-scoped random token), `{ts}` (per-bot timestamp), `{rand}` (per-bot random token).

### Per-bot controls
- **Pause / Resume** any individual bot mid-run
- **Log drawer** — slide out a per-bot log panel without leaving the grid view
- **Stop** the entire run and reset back to the setup screen

### Automatic retry and recovery
- Retries navigation on transient network errors (`ERR_CONNECTION_REFUSED`, `ERR_CONNECTION_RESET`, etc.) with exponential backoff
- Recovers from Chromium "site can't be reached" error pages with up to 10 refresh attempts
- WaitPage stuck recovery: if all participants are ready but the page hasn't redirected, performs a controlled refresh to rebind oTree's polling
- WaitPage stale recovery: if readiness hasn't progressed in 25 seconds, refreshes once to resync the WebSocket session

### Custom bot scripts
Beyond the built-in auto-player, you can write your own FSM bot scripts in TypeScript or JavaScript and load them via CLI:

```typescript
import { BotScript } from './src/engine/types';

const myBot: BotScript = {
  name: 'Public Goods Bot',
  initialState: 'waitForPage',
  states: {
    waitForPage: {
      onEntry: [{ type: 'waitForSelector', selector: 'body', timeout: 10000 }],
      transitions: [
        { target: 'done',      guard: { type: 'urlContains', value: 'OutOfRange' } },
        { target: 'contribute', guard: { type: 'elementExists', selector: '#id_contribution' } },
        { target: 'clickNext',  guard: { type: 'elementExists', selector: '.otree-btn-next' } },
        { target: 'waitForPage', delay: 2000 },
      ],
    },
    contribute: {
      onEntry: [
        { type: 'fill', selector: '#id_contribution', value: '5' },
        { type: 'wait', value: 200 },
      ],
      transitions: [{ target: 'clickNext' }],
    },
    clickNext: {
      onEntry: [
        { type: 'clickAndNavigate', selector: '.otree-btn-next', timeout: 15000 },
      ],
      transitions: [{ target: 'waitForPage' }],
    },
    done: {
      onEntry: [{ type: 'log', value: 'Game complete!' }],
      transitions: [],
      final: true,
    },
  },
};

export default myBot;
```

**Available actions:** `click`, `clickAndNavigate`, `fill`, `select`, `wait`, `waitForSelector`, `waitForNavigation`, `reload`, `evaluate`, `fillFormFields`, `clickNamedFormButton`, `screenshot`, `log`

**Available guards:** `elementExists`, `elementNotExists`, `urlContains`, `urlEquals`, `textContains`, `custom` (arbitrary JS evaluated in page context)

See [`docs/writing-bot-scripts.md`](docs/writing-bot-scripts.md) for the full reference.

---

## Getting started

### Prerequisites
- Node.js ≥ 18
- An oTree server running and accessible

### Install & run

```bash
git clone https://github.com/your-org/obots.git
cd obots
npm install
npm start
```

The GUI will open. Enter your oTree session URL, set the number of players, pick a strategy, and click **Start**.

### CLI / headless mode

```bash
npm run build
npx otree-bots --url http://localhost:8000/join/abc123 --players 4 --headless
```

| Flag | Description |
|------|-------------|
| `--url` | oTree session join URL |
| `--players` | Number of bots to spawn |
| `--script` | Path to a custom bot script (`.js` / `.ts`) |
| `--headless` | Skip the setup GUI and start immediately |
| `--cols` | Force number of grid columns |
| `--verbose` | Enable debug logging |

### Build a distributable

```bash
npm run dist          # platform-native package (deb / AppImage / exe / dmg)
```

---

## Architecture

oBots is built on **Electron + Puppeteer**:

- Each bot runs in its own **headless Chromium** instance managed by Puppeteer
- Each bot tile in the grid is a native **BrowserView** running in its own renderer process — Chromium distributes these across CPU cores automatically
- Bot behavior is driven by a **finite-state machine (FSM)** engine — states, transitions, and guards are evaluated against the live page
- Live video is streamed via the **Chrome DevTools Protocol (CDP) `Page.startScreencast`** — push-based, no polling

---

## License

MIT

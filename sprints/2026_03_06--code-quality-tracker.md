# Code Quality Sprint — Progress Tracker

Started: 2026-03-06
Source: `sprints/2026_03_06--code-quality-sprint.md`

---

## Phase 1 — Critical (broken / stuck on unhappy paths)

### [x] #1 + #3 — Spinner with no escape on start failure + runRequested never clears

**Files:** `ipc-handlers.ts`, `types.ts`, `preload.ts`, `renderer.ts`, `index.ts`

Steps:
- [x] Add `IpcChannel.EVT_START_FAILED` to `types.ts`
- [x] `ipc-handlers.ts:48-50` — on `onStart` rejection, send `EVT_START_FAILED` with the error message back to the renderer
- [x] `ipc-handlers.ts` — accept `mainWindow` param to send IPC back; `index.ts` passes it
- [x] `preload.ts` — expose an `onStartFailed` listener via the `oBots` bridge
- [x] `renderer.ts` — listen for `onStartFailed`: call `resetToSetupScreen()` (clears `runRequested`) and display error in `setupError`

### [x] #2 — focusBotCard is silently broken

**Files:** `renderer.ts`, `styles.css`

Steps:
- [x] `renderer.ts:499-513` — gut `focusBotCard()` body (DOM lookup targets elements that don't exist; tiles are BrowserViews)
- [x] `styles.css` — removed `.bot-card--active-focus` rule (along with all dead bot-card CSS in Phase 3)

---

## Phase 2 — Quick wins (one-liner fixes)

### [x] #4 — Toolbar status color leaks across runs

**Files:** `renderer.ts`

Steps:
- [x] `resetToSetupScreen()` — add `toolbarStatus.style.color = '';`

### [x] #10 — `input type="url"` fights app validation

**Files:** `index.html`

Steps:
- [x] Line 20 — change `type="url"` to `type="text"` (app validates in `readSetupPayload()`)

---

## Phase 3 — Dead code removal

### [x] #11 — Dead bot-card CSS

**Files:** `styles.css`

Steps:
- [x] Remove `.bot-card`, `.bot-card__header`, `.bot-card__body`, `.bot-card__screenshot`, `.bot-card__placeholder`, and status modifiers (`--running`, `--done`, `--error`, `--paused`)
- [x] Remove `.bot-card__status-dot` variants and `@keyframes pulse`
- [x] Remove `.bot-card__label`, `.bot-card__state`
- [x] Remove `.bot-card--active-focus`
- [x] Confirmed no remaining references in renderer code

---

## Phase 4 — Loading overlay fix

### [x] #8 — Loading overlay covers the toolbar

**Files:** `styles.css`

Steps:
- [x] `#loading` — change `inset: 0` to `inset: 36px 0 0 0` so toolbar Stop/Restart buttons remain accessible

---

## Phase 5 — Drawer navigation simplification

### [x] #9 — Triple-redundant drawer navigation

**Files:** `index.html`, `renderer.ts`, `styles.css`

Steps:
- [x] `index.html` — remove `.log-drawer__tabs` container
- [x] `renderer.ts` — remove `logDrawerTabs` DOM ref; gut `refreshDrawerTabs()` to only update dropdown + buttons; simplify `switchDrawerTab()` to not touch tab DOM
- [x] `styles.css` — remove `.log-drawer__tabs` and `.log-drawer__tab` rules

---

## Phase 6 — Focus window: dead URL bar

### [x] #6 — Focus window URL bar is dead UI

**Files:** `focus.html`

Steps:
- [x] Remove the `#url-bar` element, its CSS, and its JS reference

---

## Phase 7 — Focus window: finished-bot polish

### [x] #5 + #13 — "Waiting for screenshot..." when bot is done / no finished state

**Files:** `focus.html`

Steps:
- [x] Store last received screenshot frame in `lastFrameUrl` variable
- [x] On status `done`/`error`: display last frame (or a "No frames received." message), show a "Session Complete" overlay badge
- [x] Dim the screenshot via semi-transparent overlay
- [x] Disable Pause/Resume buttons when done (already handled by existing `setStatus` logic)

---

## Phase 8 — Bot tile affordances

### [x] #7 — Undiscoverable bot tile click affordances

**Files:** `bot-view.html`

Steps:
- [x] Add `title="Left-click: open logs / Right-click: focus window"` to the clickable area
- [x] Change cursor from `context-menu` to `pointer` for clearer interactivity hint

---

## Phase 9 — Overview KPI cleanup

### [x] #12 — "Observed Bots" vs "Expected Bots" always equal

**Files:** `overview.html`

Steps:
- [x] Replace "Observed Bots" KPI with "Errors" — shows `status.error` count instead

---

## Summary

| Phase | Issues | Status |
|-------|--------|--------|
| 1 — Critical          | #1, #2, #3   | [x] |
| 2 — Quick wins        | #4, #10      | [x] |
| 3 — Dead code         | #11          | [x] |
| 4 — Loading overlay   | #8           | [x] |
| 5 — Drawer nav        | #9           | [x] |
| 6 — Dead URL bar      | #6           | [x] |
| 7 — Focus window      | #5, #13      | [x] |
| 8 — Tile affordances  | #7           | [x] |
| 9 — Overview KPI      | #12          | [x] |

Diagnostics:

---
  Critical — broken or stuck on unhappy paths

  1. Spinner with no escape on start failure
  src/main/ipc-handlers.ts:48-50 — when onStart throws, the error is logged but nothing is sent back to the renderer. The loading overlay
  (z-index: 1000) covers the entire window including the toolbar. The user sees an infinite spinner with no way to escape without killing
  the app. There's no "start failed" IPC channel.

  2. focusBotCard is silently broken
  src/renderer/renderer.ts:499-513 — this function does document.getElementById('bot-card-${state.index}') but no elements with those IDs
  exist. Bot tiles are native BrowserViews, not DOM elements. The "scroll into view and flash-highlight when switching drawer tabs"
  feature never executes. The .bot-card--active-focus CSS class exists but is never applied.

  3. runRequested flag never clears on error
  src/renderer/renderer.ts:745 — once a run is requested, runRequested = true and the only reset is via resetToSetupScreen(). If the start
   fails (stuck spinner), the user can't resubmit the form even after somehow escaping — the submit handler bails out silently.

  ---
  Significant — friction, confusion, or stale state

  4. Toolbar status color leaks across runs
  src/renderer/renderer.ts:377,381 — toolbarStatus.style.color is set inline to orange and green but resetToSetupScreen() never clears it.
   The next run's "Starting run…" status text inherits the previous run's color (e.g., bright green from a completed run).

  5. Focus window shows "Waiting for screenshot…" when bot is done
  src/renderer/focus.html:267,337-339 — the CDP screencast stops when the bot finishes. If you open a focus window after completion, the
  placeholder "Waiting for screenshot…" shows indefinitely. No last-frame is retained, no "bot has finished" state is shown. You see a
  blank screen with disabled Pause/Resume and no explanation.

  6. Focus window URL bar is dead UI
  src/renderer/focus.html:245 — #url-bar always shows "—". Nothing in the focus window's script or preload ever updates it. It takes up
  space and implies live URL tracking that doesn't exist.

  7. Undiscoverable bot tile click affordances
  src/renderer/bot-view.html:155-166 — left-click opens the log drawer, right-click opens the focus window. Neither has a tooltip, hover
  state, or any visual affordance. cursor: context-menu hints at right-click only. A user trying to "zoom in" on a bot by left-clicking
  gets the log drawer instead, which is surprising.

  ---
  Moderate — rough edges under normal use

  8. Loading overlay covers the toolbar
  src/renderer/styles.css:589-598 — #loading is z-index: 1000, toolbar is z-index: 100. While bots are launching, the Stop and Restart
  buttons are invisible and unreachable. On a slow/unreachable server, there's no way to abort.

  9. Triple-redundant drawer navigation
  src/renderer/index.html:166-176 — the log drawer has tabs (horizontal scroll), a dropdown <select>, and prev/next arrow buttons — all
  for the same operation (switch active bot). For large bot counts (16, 32) the tab bar collapses into a tiny horizontal scroll mess while
   the dropdown does the same job cleanly. The tabs and dropdown fight each other for space and attention.

  10. input type="url" on the game URL field
  src/renderer/index.html:20 — browser-native URL validation fires before app-level validation and shows a generic browser tooltip
  ("Please enter a URL") rather than the app's error message. It will reject URLs that don't match the browser's URL grammar but are valid
   for this app's purposes (e.g., missing protocol, non-standard ports).

  ---
  Minor — cosmetic or low-frequency issues

  11. Bot-card CSS in styles.css is mostly dead
  .bot-card, .bot-card__header, .bot-card__body, .bot-card__screenshot — extensive CSS for a DOM-based grid that was replaced by
  BrowserViews. Only .bot-card--active-focus survives in live code (but is also broken per point 2). The rest is never applied.

  12. Overview "Observed Bots" vs "Expected Bots" KPI is always equal
  src/renderer/overview.html:394-395 — bots are created synchronously before any BrowserView renders, so these two numbers are always the
  same after the first snapshot. This KPI reads as noise.

  13. Focus window has no "bot finished" state
  When status === 'done', the header dot turns blue and the status text says "done", but no visual treatment signals that the window is
  now a frozen snapshot rather than a live feed. Users naturally expect a live window to stay live.

  ---
  The two most worth fixing first are #1 (stuck 
// src/renderer/renderer.ts
// ──────────────────────────────────────────────────────────────
// Renderer process — receives IPC events from main process and
// updates the DOM grid. Runs in the browser context with the
// preload-exposed `window.otreeBots` API.
// ──────────────────────────────────────────────────────────────

// Type declarations for the preload-exposed API
interface OtreeBotsApi {
  onGridLayout: (cb: (layout: GridLayout) => void) => void;
  onBotStatus: (cb: (data: { id: string; index: number; status: string }) => void) => void;
  onBotStateChange: (cb: (data: { id: string; index: number; state: string }) => void) => void;
  onBotLog: (cb: (data: { id: string; index: number; entry: LogEntry }) => void) => void;
  onAllDone: (cb: () => void) => void;
  onOpenDrawer: (cb: (data: { id: string; index: number }) => void) => void;
  sendCommand: (cmd: string, payload?: unknown) => void;
}

interface StrategyPayload {
  name: string;
  numberStrategy: string;
  numberFixedValue: number;
  textValue: string;
  selectStrategy: string;
  radioStrategy: string;
  checkboxStrategy: string;
  submitDelay: number;
  actionDelayMs: number;
  actionJitterMs: number;
}

interface StartCommandPayload {
  url: string;
  playerCount: number;
  strategy: StrategyPayload;
}

interface GridLayout {
  cols: number;
  rows: number;
  cells: Array<{ slotIndex: number; x: number; y: number; width: number; height: number }>;
}

interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  screenshotDataUrl?: string;
}

// Extend Window type for preload API
interface Window {
  otreeBots: OtreeBotsApi;
}

// ── State ───────────────────────────────────────────────────

interface BotCardState {
  id: string;
  index: number;
  status: string;
  currentState: string;
}

const botCards: Map<string, BotCardState> = new Map();
let finishedCount = 0;
let totalCount = 0;

// ── Decision Log State ──────────────────────────────────────

interface DrawerLogEntry {
  botId: string;
  botIndex: number;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'state';
  message: string;
}

/** Per-bot log storage */
const botLogs: Map<string, DrawerLogEntry[]> = new Map();
/** Currently selected tab in the drawer (first bot, or empty) */
let drawerActiveTab = '';
/** Whether the drawer is currently open */
let drawerOpen = false;

// ── DOM References ──────────────────────────────────────────

const gridContainer = document.getElementById('grid-container') as HTMLDivElement;
const loadingOverlay = document.getElementById('loading') as HTMLDivElement;
const loadingText = loadingOverlay.querySelector('.loading__text') as HTMLDivElement;
const toolbarStatus = document.getElementById('toolbar-status') as HTMLSpanElement;
const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const setupScreen = document.getElementById('setup-screen') as HTMLDivElement;
const setupForm = document.getElementById('setup-form') as HTMLFormElement;
const setupUrlInput = document.getElementById('setup-url') as HTMLInputElement;
const setupPlayersInput = document.getElementById('setup-players') as HTMLInputElement;
const setupStrategySelect = document.getElementById('setup-strategy') as HTMLSelectElement;
const strategyDetails = document.getElementById('strategy-details') as HTMLDivElement;
const stratNumberSelect = document.getElementById('strat-number') as HTMLSelectElement;
const stratNumberFixed = document.getElementById('strat-number-fixed') as HTMLInputElement;
const stratRadioSelect = document.getElementById('strat-radio') as HTMLSelectElement;
const stratSelectSelect = document.getElementById('strat-select') as HTMLSelectElement;
const stratCheckboxSelect = document.getElementById('strat-checkbox') as HTMLSelectElement;
const stratTextInput = document.getElementById('strat-text') as HTMLInputElement;
const stratSpeedSlider = document.getElementById('strat-speed') as HTMLInputElement;
const stratSpeedLabel = document.getElementById('strat-speed-label') as HTMLSpanElement;
const stratJitterSlider = document.getElementById('strat-jitter') as HTMLInputElement;
const stratJitterLabel = document.getElementById('strat-jitter-label') as HTMLSpanElement;
const setupError = document.getElementById('setup-error') as HTMLParagraphElement;

// ── Log Drawer DOM References ───────────────────────────────
const logDrawer = document.getElementById('log-drawer') as HTMLDivElement;
const logDrawerTabs = document.getElementById('log-drawer-tabs') as HTMLDivElement;
const logDrawerBody = document.getElementById('log-drawer-body') as HTMLDivElement;
const logBotSelect = document.getElementById('log-bot-select') as HTMLSelectElement;
const btnLogBotPrev = document.getElementById('log-bot-prev') as HTMLButtonElement;
const btnLogBotNext = document.getElementById('log-bot-next') as HTMLButtonElement;
const btnLogs = document.getElementById('btn-logs') as HTMLButtonElement;
const btnDrawerClose = document.getElementById('log-drawer-close') as HTMLButtonElement;
const btnOverview = document.getElementById('btn-overview') as HTMLButtonElement;

let runRequested = false;

/**
 * Read initial setup defaults injected via main-window query params.
 */
/** Strategy presets — mirrors STRATEGY_PRESETS from types.ts */
const PRESETS: Record<string, Omit<StrategyPayload, 'name'>> = {
  random:   { numberStrategy: 'random',   numberFixedValue: 5,   textValue: 'test',          selectStrategy: 'random', radioStrategy: 'random', checkboxStrategy: 'random', submitDelay: 0, actionDelayMs: 300, actionJitterMs: 0 },
  minimum:  { numberStrategy: 'min',      numberFixedValue: 0,   textValue: 'a',             selectStrategy: 'first',  radioStrategy: 'first',  checkboxStrategy: 'none',   submitDelay: 0, actionDelayMs: 300, actionJitterMs: 0 },
  maximum:  { numberStrategy: 'max',      numberFixedValue: 100, textValue: 'test response',  selectStrategy: 'last',   radioStrategy: 'last',   checkboxStrategy: 'all',    submitDelay: 0, actionDelayMs: 300, actionJitterMs: 0 },
  midpoint: { numberStrategy: 'midpoint', numberFixedValue: 50,  textValue: 'test',          selectStrategy: 'first',  radioStrategy: 'first',  checkboxStrategy: 'all',    submitDelay: 0, actionDelayMs: 300, actionJitterMs: 0 },
  fixed:    { numberStrategy: 'fixed',    numberFixedValue: 5,   textValue: 'test',          selectStrategy: 'first',  radioStrategy: 'first',  checkboxStrategy: 'all',    submitDelay: 0, actionDelayMs: 300, actionJitterMs: 0 },
};

/** Apply a preset's values to the strategy detail controls */
function applyPreset(key: string): void {
  const preset = PRESETS[key];
  if (!preset) return;
  stratNumberSelect.value = preset.numberStrategy;
  stratNumberFixed.value = String(preset.numberFixedValue);
  stratRadioSelect.value = preset.radioStrategy;
  stratSelectSelect.value = preset.selectStrategy;
  stratCheckboxSelect.value = preset.checkboxStrategy;
  stratTextInput.value = preset.textValue;
  stratSpeedSlider.value = String(preset.actionDelayMs);
  stratSpeedLabel.textContent = `${preset.actionDelayMs} ms`;
  stratJitterSlider.value = String(preset.actionJitterMs);
  stratJitterLabel.textContent = `${preset.actionJitterMs} ms`;
}

/** Read the full strategy object from the detail controls */
function readStrategy(): StrategyPayload {
  const presetKey = setupStrategySelect.value;
  const label = presetKey === 'custom' ? 'Custom' : (presetKey.charAt(0).toUpperCase() + presetKey.slice(1));
  return {
    name: label,
    numberStrategy: stratNumberSelect.value,
    numberFixedValue: Number(stratNumberFixed.value) || 5,
    textValue: stratTextInput.value || 'test',
    selectStrategy: stratSelectSelect.value,
    radioStrategy: stratRadioSelect.value,
    checkboxStrategy: stratCheckboxSelect.value,
    submitDelay: 0,
    actionDelayMs: Number(stratSpeedSlider.value) || 0,
    actionJitterMs: Number(stratJitterSlider.value) || 0,
  };
}

function getSetupDefaults(): { url: string; playerCount: number } {
  const params = new URLSearchParams(window.location.search);
  const defaultUrl = (params.get('defaultUrl') ?? '').trim();
  const parsedPlayers = Number(params.get('defaultPlayers') ?? '2');
  const playerCount = Number.isInteger(parsedPlayers) && parsedPlayers > 0 ? parsedPlayers : 2;
  return { url: defaultUrl, playerCount };
}

/**
 * Show a setup validation error message.
 */
function showSetupError(message: string): void {
  setupError.textContent = message;
}

/**
 * Switch UI to loading state after user submits setup.
 */
function showLaunchingState(): void {
  setupScreen.classList.add('hidden');
  loadingText.textContent = 'Launching bots…';
  loadingOverlay.classList.remove('hidden');
  toolbarStatus.textContent = 'Starting run…';
  btnRestart.disabled = false;
  btnStop.disabled = false;
  updateOverviewButton();
}

/**
 * Return renderer UI/state back to the setup screen so a new run can start.
 */
function resetToSetupScreen(): void {
  runRequested = false;

  finishedCount = 0;
  totalCount = 0;
  botCards.clear();

  botLogs.clear();
  drawerActiveTab = '';
  toggleDrawer(false);
  refreshDrawerTabs();
  renderDrawerBody();

  gridContainer.innerHTML = '';
  gridContainer.style.setProperty('--cols', '2');
  gridContainer.style.setProperty('--rows', '1');

  loadingOverlay.classList.add('hidden');
  setupScreen.classList.remove('hidden');
  setupError.textContent = '';
  toolbarStatus.textContent = 'Configure run and click Launch Run';
  btnRestart.disabled = true;
  btnStop.disabled = true;
  updateOverviewButton();
}

/**
 * Validate setup fields and convert to a start command payload.
 */
function readSetupPayload(): StartCommandPayload | null {
  const url = setupUrlInput.value.trim();
  const playerCount = Number(setupPlayersInput.value);

  if (!url) {
    showSetupError('Game URL is required.');
    return null;
  }
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    showSetupError('Number of bots must be an integer >= 1.');
    return null;
  }

  showSetupError('');
  return { url, playerCount, strategy: readStrategy() };
}

/**
 * Populate setup form defaults from main process values.
 */
function initializeSetupForm(): void {
  const defaults = getSetupDefaults();
  setupUrlInput.value = defaults.url;
  setupPlayersInput.value = String(defaults.playerCount);
  btnRestart.disabled = true;
  btnStop.disabled = true;
  toolbarStatus.textContent = 'Configure run and click Launch Run';

  // Initialize strategy details from default preset
  applyPreset('random');

  // When preset changes, populate detail fields (and auto-switch to "custom" on manual edit)
  setupStrategySelect.addEventListener('change', () => {
    const key = setupStrategySelect.value;
    if (key !== 'custom') {
      applyPreset(key);
    }
  });

  // Auto-switch preset dropdown to "Custom" when any detail field is changed manually
  const detailFields = [stratNumberSelect, stratNumberFixed, stratRadioSelect, stratSelectSelect, stratCheckboxSelect, stratTextInput];
  for (const field of detailFields) {
    field.addEventListener('change', () => { setupStrategySelect.value = 'custom'; });
    field.addEventListener('input', () => { setupStrategySelect.value = 'custom'; });
  }

  // Speed slider label sync (does NOT trigger custom switch — speed is independent)
  stratSpeedSlider.addEventListener('input', () => {
    stratSpeedLabel.textContent = `${stratSpeedSlider.value} ms`;
  });

  // Jitter slider label sync
  stratJitterSlider.addEventListener('input', () => {
    stratJitterLabel.textContent = `${stratJitterSlider.value} ms`;
  });
}

// ── Grid Layout ─────────────────────────────────────────────

function applyGridLayout(layout: GridLayout): void {
  // Grid tiles are now BrowserViews managed by the main process.
  // We just track the count for toolbar status.
  totalCount = layout.cells.length;

  // Hide loading overlay
  loadingOverlay.classList.add('hidden');
  updateToolbarStatus();
}

// ── Update Functions ────────────────────────────────────────

function updateBotStatus(id: string, status: string, realIndex?: number): void {
  const state = findOrCreateState(id, realIndex);
  const oldStatus = state.status;
  state.status = status;

  // Track finished count
  if ((status === 'done' || status === 'error') && oldStatus !== 'done' && oldStatus !== 'error') {
    finishedCount++;
  }

  updateToolbarStatus();
}

function updateBotState(id: string, stateName: string, realIndex?: number): void {
  const state = findOrCreateState(id, realIndex);
  state.currentState = stateName;
}

function updateToolbarStatus(): void {
  if (totalCount === 0) {
    toolbarStatus.textContent = 'Waiting…';
  } else if (finishedCount === totalCount) {
    toolbarStatus.textContent = `All ${totalCount} bots finished`;
  } else {
    toolbarStatus.textContent = `${finishedCount}/${totalCount} finished`;
  }
  updateOverviewButton();
}

function handleAllDone(): void {
  toolbarStatus.textContent = `✓ All ${totalCount} bots finished`;
  toolbarStatus.style.color = '#4caf50';
  updateOverviewButton();
}

// ── Helpers ─────────────────────────────────────────────────

/** Map bot id → card state. Index comes from the main process (bot.index). */

function findOrCreateState(id: string, realIndex?: number): BotCardState {
  let state = botCards.get(id);
  if (!state) {
    state = {
      id,
      index: realIndex ?? 0,
      status: 'idle',
      currentState: '',
    };
    botCards.set(id, state);
    refreshDrawerTabs();
  } else if (realIndex !== undefined && state.index !== realIndex) {
    // Correct the index if it was initially wrong
    state.index = realIndex;
  }
  return state;
}

  // ── Event Wiring ────────────────────────────────────────────

// ── Decision Log Drawer ─────────────────────────────────────

/** Toggle the drawer open/closed */
function toggleDrawer(forceOpen?: boolean): void {
  drawerOpen = forceOpen !== undefined ? forceOpen : !drawerOpen;
  logDrawer.classList.toggle('log-drawer--open', drawerOpen);
  btnLogs.classList.toggle('toolbar__btn--active', drawerOpen);
  // Tell main process so it can shrink BrowserView grid to avoid overlap
  api?.sendCommand('cmd:drawer-toggle', { open: drawerOpen });
}

/** Format a timestamp to HH:MM:SS.mmm */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Record a log entry for a given bot */
function recordLogEntry(botId: string, level: 'info' | 'warn' | 'error' | 'state', message: string): void {
  const state = botCards.get(botId);
  const botIndex = state ? state.index : -1;
  const entry: DrawerLogEntry = {
    botId,
    botIndex,
    timestamp: Date.now(),
    level,
    message,
  };

  // Store per-bot
  if (!botLogs.has(botId)) {
    botLogs.set(botId, []);
    refreshDrawerTabs();
  }
  botLogs.get(botId)!.push(entry);

  // If drawer is open and this entry belongs to the active tab, append it
  if (drawerOpen && drawerActiveTab === botId) {
    appendLogEntryDOM(entry);
  }
}

/**
 * Return known bot ids sorted by their grid index.
 */
function getSortedBotIds(): string[] {
  const knownIds = new Set<string>([...botCards.keys(), ...botLogs.keys()]);
  return [...knownIds].sort((a, b) => {
    const sa = botCards.get(a);
    const sb = botCards.get(b);
    return (sa?.index ?? Number.MAX_SAFE_INTEGER) - (sb?.index ?? Number.MAX_SAFE_INTEGER);
  });
}

/**
 * Render the dropdown selector used for quick bot navigation.
 */
function refreshDrawerNavigator(): void {
  const sortedIds = getSortedBotIds();
  logBotSelect.innerHTML = '';

  for (const botId of sortedIds) {
    const state = botCards.get(botId);
    const option = document.createElement('option');
    option.value = botId;
    option.textContent = state ? `Bot #${state.index}` : botId;
    logBotSelect.appendChild(option);
  }

  logBotSelect.value = drawerActiveTab;
}

/**
 * Enable/disable quick navigation buttons based on current context.
 */
function refreshDrawerNavigatorButtons(): void {
  const sortedIds = getSortedBotIds();
  const hasBots = sortedIds.length > 0;
  btnLogBotPrev.disabled = !hasBots;
  btnLogBotNext.disabled = !hasBots;
}

/**
 * Scroll to and highlight the selected bot card in the grid.
 */
function focusBotCard(botId: string): void {
  const state = botCards.get(botId);
  if (!state) return;

  const card = document.getElementById(`bot-card-${state.index}`) as HTMLDivElement | null;
  if (!card) return;

  card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  card.classList.remove('bot-card--active-focus');
  // Force restart of highlight animation if repeatedly selecting the same bot.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  card.offsetHeight;
  card.classList.add('bot-card--active-focus');
  window.setTimeout(() => card.classList.remove('bot-card--active-focus'), 900);
}

/**
 * Move to the previous/next bot tab from the current active selection.
 */
function moveDrawerBotSelection(direction: -1 | 1): void {
  const sortedIds = getSortedBotIds();
  if (sortedIds.length === 0) return;

  const currentIndex = sortedIds.indexOf(drawerActiveTab);
  if (currentIndex === -1) {
    switchDrawerTab(sortedIds[0]);
    return;
  }

  const nextIndex = (currentIndex + direction + sortedIds.length) % sortedIds.length;
  switchDrawerTab(sortedIds[nextIndex]);
}

/** Rebuild the tab bar to reflect all known bots */
function refreshDrawerTabs(): void {
  const sortedIds = getSortedBotIds();
  if (drawerActiveTab && !sortedIds.includes(drawerActiveTab)) {
    drawerActiveTab = sortedIds[0] ?? '';
  }
  if (!drawerActiveTab && sortedIds.length > 0) {
    drawerActiveTab = sortedIds[0];
  }

  logDrawerTabs.innerHTML = '';

  for (const botId of sortedIds) {
    const botState = botCards.get(botId);
    const label = botState ? `Bot #${botState.index}` : botId;
    const tab = document.createElement('button');
    tab.className = `log-drawer__tab${drawerActiveTab === botId ? ' log-drawer__tab--active' : ''}`;
    tab.dataset.bot = botId;
    tab.textContent = label;
    tab.addEventListener('click', () => switchDrawerTab(botId));
    logDrawerTabs.appendChild(tab);
  }

  refreshDrawerNavigator();
  refreshDrawerNavigatorButtons();
}

/** Switch the active drawer tab and re-render log entries */
function switchDrawerTab(tabId: string): void {
  drawerActiveTab = tabId;
  // Highlight active tab
  logDrawerTabs.querySelectorAll('.log-drawer__tab').forEach((t) => {
    (t as HTMLElement).classList.toggle('log-drawer__tab--active', (t as HTMLElement).dataset.bot === tabId);
  });
  logBotSelect.value = tabId;
  refreshDrawerNavigatorButtons();
  focusBotCard(tabId);
  renderDrawerBody();
}

/** Render the full body of log entries for the active tab */
function renderDrawerBody(): void {
  logDrawerBody.innerHTML = '';
  const entries = botLogs.get(drawerActiveTab) ?? [];

  if (entries.length === 0) {
    logDrawerBody.innerHTML = '<div class="log-drawer__empty">No log entries yet.</div>';
    return;
  }

  for (const entry of entries) {
    appendLogEntryDOM(entry);
  }
}

/** Append a single log entry DOM element to the drawer body, and auto-scroll */
function appendLogEntryDOM(entry: DrawerLogEntry): void {
  // Remove "empty" placeholder if present
  const empty = logDrawerBody.querySelector('.log-drawer__empty');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = `log-entry log-entry--${entry.level}`;

  el.innerHTML = `
    <div class="log-entry__meta">
      <span class="log-entry__time">${fmtTime(entry.timestamp)}</span>
    </div>
    <div class="log-entry__msg">${escapeHtml(entry.message)}</div>
  `;

  logDrawerBody.appendChild(el);

  // Auto-scroll to bottom
  logDrawerBody.scrollTop = logDrawerBody.scrollHeight;
}

/** Escape HTML entities in log messages */
function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (c) => map[c] || c);
}

function updateOverviewButton(): void {
  if (totalCount > 0) {
    btnOverview.textContent = `Overview ${finishedCount}/${totalCount}`;
  } else {
    btnOverview.textContent = 'Overview';
  }
}

/** Open the drawer with a specific bot's tab selected */
function openDrawerForBot(botId: string): void {
  if (!botLogs.has(botId)) {
    botLogs.set(botId, []);
    refreshDrawerTabs();
  }
  switchDrawerTab(botId);
  toggleDrawer(true);
}

// ── Event Wiring ────────────────────────────────────────────

console.log('[renderer] renderer.js executing…');
console.log('[renderer] window.otreeBots =', typeof (window as any).otreeBots);

const api = (window as any).otreeBots as OtreeBotsApi | undefined;

if (!api) {
  console.error('[renderer] FATAL: window.otreeBots is undefined — preload did not run!');
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'color:red;padding:40px;font-size:18px;text-align:center;';
  errDiv.textContent = 'ERROR: Preload bridge not available. Check console.';
  document.body.prepend(errDiv);
} else {
  console.log('[renderer] API bridge found, registering IPC listeners…');
  initializeSetupForm();

  // ── Drawer toggle wiring ──────────────────────────────────
  btnLogs.addEventListener('click', () => {
    toggleDrawer();
    if (drawerOpen) renderDrawerBody();
  });
  btnOverview.addEventListener('click', () => api.sendCommand('cmd:open-overview'));
  btnDrawerClose.addEventListener('click', () => toggleDrawer(false));
  logBotSelect.addEventListener('change', () => switchDrawerTab(logBotSelect.value));
  btnLogBotPrev.addEventListener('click', () => moveDrawerBotSelection(-1));
  btnLogBotNext.addEventListener('click', () => moveDrawerBotSelection(1));
  window.addEventListener('keydown', (event) => {
    if (!drawerOpen) return;
    if (event.key === '[') {
      event.preventDefault();
      moveDrawerBotSelection(-1);
    } else if (event.key === ']') {
      event.preventDefault();
      moveDrawerBotSelection(1);
    }
  });
  refreshDrawerTabs();
  updateOverviewButton();

  api.onGridLayout((layout: GridLayout) => {
    console.log('[renderer] grid:layout received', JSON.stringify(layout));
    applyGridLayout(layout);
  });

  api.onBotStatus((data: { id: string; index: number; status: string }) => {
    console.log(`[renderer] bot:status ${data.id} → ${data.status}`);
    updateBotStatus(data.id, data.status, data.index);
  });

  api.onBotStateChange((data: { id: string; index: number; state: string }) => {
    console.log(`[renderer] bot:state-change ${data.id} → ${data.state}`);
    updateBotState(data.id, data.state, data.index);
    recordLogEntry(data.id, 'state', `State → ${data.state}`);
  });

  api.onBotLog((data: { id: string; entry: LogEntry }) => {
    const entry = data.entry;
    if (entry.level === 'error') {
      console.error(`[Bot ${data.id}]`, entry.message);
    } else {
      console.log(`[Bot ${data.id}]`, entry.message);
    }
    recordLogEntry(data.id, entry.level, entry.message);
  });

  api.onAllDone(() => {
    console.log('[renderer] run:all-done received');
    handleAllDone();
  });

  // Open drawer when requested from a BrowserView (bot tile click)
  api.onOpenDrawer((data: { id: string; index: number }) => {
    console.log(`[renderer] open-drawer-for-bot ${data.id}`);
    findOrCreateState(data.id, data.index);
    openDrawerForBot(data.id);
  });

  // ── Toolbar Buttons ─────────────────────────────────────────

  setupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (runRequested) {
      return;
    }

    const payload = readSetupPayload();
    if (!payload) {
      return;
    }

    runRequested = true;
    showLaunchingState();
    api.sendCommand('cmd:start', payload);
  });

  btnStop.addEventListener('click', () => {
    if (btnStop.disabled) {
      return;
    }
    api.sendCommand('cmd:stop');
    toolbarStatus.textContent = 'Stopping…';
  });

  btnRestart.addEventListener('click', () => {
    api.sendCommand('cmd:restart');
    toolbarStatus.textContent = 'Restarting…';
    resetToSetupScreen();
  });

  console.log('[renderer] All IPC listeners registered, waiting for grid layout…');
}

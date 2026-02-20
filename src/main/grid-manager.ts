// src/main/grid-manager.ts
// ──────────────────────────────────────────────────────────────
// Manages a grid of BrowserView instances — one per bot.
// Each BrowserView runs in its own renderer process (naturally
// distributed across CPU cores by Chromium's multi-process model).
// Uses CDP Page.startScreencast to push live frames to each view.
// ──────────────────────────────────────────────────────────────

import path from 'path';
import { BrowserWindow, BrowserView } from 'electron';
import { GridLayout, GridCell, IpcChannel } from '../engine/types';
import { createChildLogger } from './logger';

const log = createChildLogger('grid-mgr');

/** Toolbar height in pixels (must match styles.css #toolbar height). */
const TOOLBAR_HEIGHT = 36;
/** Gap between cells in pixels. */
const CELL_GAP = 2;

export interface BotView {
  slotIndex: number;
  botId: string;
  view: BrowserView;
}

export class GridManager {
  private layout: GridLayout | null = null;
  private botViews: Map<string, BotView> = new Map();      // botId → BotView
  private slotViews: Map<number, BotView> = new Map();      // slotIndex → BotView
  private viewsVisible = true;

  /** Pixels reserved on the right for the log drawer (0 when closed). */
  private drawerOffset = 0;

  constructor(private readonly win: BrowserWindow) {}

  /** Set the drawer offset (width in px) and return it for reference. */
  setDrawerOffset(px: number): void {
    this.drawerOffset = px;
  }

  /** Show/hide all BrowserViews (used for DOM overlays that must be on top). */
  setViewsVisible(visible: boolean): void {
    if (this.viewsVisible === visible) return;
    this.viewsVisible = visible;
    this.repositionAllViews();
  }

  // ── Layout computation ────────────────────────────────

  /**
   * Compute a grid layout for N bots within the window's content bounds,
   * accounting for the toolbar height.
   */
  computeLayout(botCount: number, forceCols?: number): GridLayout {
    const safeBotCount = Math.max(0, botCount);
    if (safeBotCount === 0) {
      this.layout = { cols: 1, rows: 1, cells: [] };
      return this.layout;
    }

    const [rawW, containerH] = this.win.getContentSize();
    const containerW = Math.max(1, rawW - this.drawerOffset);
    const gridH = Math.max(1, containerH - TOOLBAR_HEIGHT);

    const cols = Math.max(1, forceCols ?? Math.ceil(Math.sqrt(safeBotCount)));
    const rows = Math.max(1, Math.ceil(safeBotCount / cols));

    // Keep bounds valid even for tiny windows / large drawer offsets.
    const availableW = Math.max(cols, containerW - CELL_GAP * (cols + 1));
    const availableH = Math.max(rows, gridH - CELL_GAP * (rows + 1));

    const cellWidth = Math.floor(availableW / cols);
    const cellHeight = Math.floor(availableH / rows);

    const cells: GridCell[] = [];
    for (let i = 0; i < safeBotCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      cells.push({
        slotIndex: i,
        x: CELL_GAP + col * (cellWidth + CELL_GAP),
        y: TOOLBAR_HEIGHT + CELL_GAP + row * (cellHeight + CELL_GAP),
        width: cellWidth,
        height: cellHeight,
      });
    }

    this.layout = { cols, rows, cells };
    return this.layout;
  }

  getLayout(): GridLayout | null {
    return this.layout;
  }

  // ── BrowserView lifecycle ─────────────────────────────

  /**
   * Create a BrowserView for a bot slot and attach it to the main window.
   * Returns the created BotView descriptor.
   */
  async createBotView(slotIndex: number, botId: string): Promise<BotView> {
    if (this.botViews.has(botId)) {
      return this.botViews.get(botId)!;
    }

    const preloadPath = path.join(__dirname, 'bot-view-preload.js');
    const view = new BrowserView({
      webPreferences: {
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
      },
    });

    this.win.addBrowserView(view);

    // Position the view in its grid cell
    const cell = this.layout?.cells[slotIndex];
    if (cell) {
      view.setBounds({
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
      });
      view.setAutoResize({ width: false, height: false });
    }

    // Load the per-bot HTML
    const htmlPath = path.join(__dirname, '..', 'renderer', 'bot-view.html');
    await view.webContents.loadFile(htmlPath);

    const botView: BotView = { slotIndex, botId, view };
    this.botViews.set(botId, botView);
    this.slotViews.set(slotIndex, botView);

    log.info('BrowserView created for bot #%d (%s) — pid %d',
      slotIndex, botId, view.webContents.getOSProcessId());

    return botView;
  }

  /**
   * Get the BotView for a given botId (null if not found).
   */
  getBotView(botId: string): BotView | undefined {
    return this.botViews.get(botId);
  }

  /**
   * Send bot identity info to its BrowserView once it's ready.
   */
  sendBotInfo(botId: string, info: {
    id: string;
    index: number;
    status: string;
    currentState: string;
  }): void {
    const bv = this.botViews.get(botId);
    if (bv && !bv.view.webContents.isDestroyed()) {
      bv.view.webContents.send(IpcChannel.BOTVIEW_INFO, info);
    }
  }

  /**
   * Send a status update to a bot's BrowserView.
   */
  sendBotStatus(botId: string, status: string): void {
    const bv = this.botViews.get(botId);
    if (bv && !bv.view.webContents.isDestroyed()) {
      bv.view.webContents.send(IpcChannel.BOTVIEW_STATUS, status);
    }
  }

  /**
   * Send a state change to a bot's BrowserView.
   */
  sendBotState(botId: string, state: string): void {
    const bv = this.botViews.get(botId);
    if (bv && !bv.view.webContents.isDestroyed()) {
      bv.view.webContents.send(IpcChannel.BOTVIEW_STATE, state);
    }
  }

  /**
   * Send a screencast frame to a bot's BrowserView.
   */
  sendScreenshot(botId: string, dataUrl: string): void {
    const bv = this.botViews.get(botId);
    if (bv && !bv.view.webContents.isDestroyed()) {
      bv.view.webContents.send(IpcChannel.BOTVIEW_SCREENSHOT, dataUrl);
    }
  }

  // ── Resize handling ───────────────────────────────────

  /**
   * Recompute layout and reposition all existing BrowserViews.
   */
  refresh(botCount: number, forceCols?: number): void {
    this.computeLayout(botCount, forceCols);
    this.repositionAllViews();
    // Also broadcast to main renderer so it can adjust
    this.broadcastLayout();
  }

  /**
   * Reposition all BrowserViews to match the current layout.
   */
  private repositionAllViews(): void {
    if (!this.layout) return;
    for (const cell of this.layout.cells) {
      const bv = this.slotViews.get(cell.slotIndex);
      if (bv && !bv.view.webContents.isDestroyed()) {
        if (!this.viewsVisible) {
          // BrowserViews are native layers above renderer DOM.
          // Collapse them while overlays are open so DOM panels stay visible/clickable.
          bv.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } else {
          bv.view.setBounds({
            x: cell.x,
            y: cell.y,
            width: cell.width,
            height: cell.height,
          });
        }
      }
    }
  }

  /**
   * Broadcast layout to the main renderer (for toolbar status, drawer, etc.).
   */
  broadcastLayout(): void {
    if (!this.layout) return;
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(IpcChannel.GRID_LAYOUT, this.layout);
    }
  }

  // ── Cleanup ───────────────────────────────────────────

  /**
   * Remove and destroy all BrowserViews (e.g. on restart).
   */
  destroyAllViews(): void {
    for (const bv of this.botViews.values()) {
      try {
        this.win.removeBrowserView(bv.view);
        // Electron 28: webContents.close() may not exist; destroy via removeBrowserView
        if (!(bv.view.webContents as any).isDestroyed()) {
          (bv.view.webContents as any).close?.();
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    this.botViews.clear();
    this.slotViews.clear();
    this.layout = null;
    log.info('All BrowserViews destroyed');
  }
}

import { describe, it, expect, vi } from 'vitest';
import { GridManager } from '../../src/main/grid-manager';
import { IpcChannel } from '../../src/engine/types';

// Toolbar height = 36, cell gap = 2 (must match grid-manager.ts constants)
const TOOLBAR_H = 36;
const GAP = 2;

function makeWindow(width = 1200, height = 800): any {
  return {
    getContentSize: vi.fn(() => [width, height]),
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
    },
    addBrowserView: vi.fn(),
    removeBrowserView: vi.fn(),
  };
}

describe('GridManager', () => {
  it('computes expected layout geometry with toolbar offset and gaps', () => {
    const win = makeWindow(1000, 800);
    const manager = new GridManager(win);

    const layout = manager.computeLayout(6);

    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(2);
    expect(layout.cells).toHaveLength(6);

    const gridH = 800 - TOOLBAR_H;
    const cellW = Math.floor((1000 - GAP * 4) / 3);
    const cellH = Math.floor((gridH - GAP * 3) / 2);

    // Cell at col=1, row=1 (slotIndex 4)
    expect(layout.cells[4]).toEqual({
      slotIndex: 4,
      x: GAP + 1 * (cellW + GAP),
      y: TOOLBAR_H + GAP + 1 * (cellH + GAP),
      width: cellW,
      height: cellH,
    });
    expect(manager.getLayout()).toEqual(layout);
  });

  it('respects forced columns', () => {
    const win = makeWindow(900, 600);
    const manager = new GridManager(win);

    const layout = manager.computeLayout(5, 2);
    expect(layout.cols).toBe(2);
    expect(layout.rows).toBe(3);
    // Cell at col=1, row=1 (slotIndex=3)
    const gridH = 600 - TOOLBAR_H;
    const cellW = Math.floor((900 - GAP * 3) / 2);
    const cellH = Math.floor((gridH - GAP * 4) / 3);
    expect(layout.cells[3]).toMatchObject({
      x: GAP + 1 * (cellW + GAP),
      y: TOOLBAR_H + GAP + 1 * (cellH + GAP),
    });
  });

  it('broadcasts layout through IPC', () => {
    const win = makeWindow(1200, 800);
    const manager = new GridManager(win);
    const layout = manager.computeLayout(4);

    manager.broadcastLayout();

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith(IpcChannel.GRID_LAYOUT, layout);
  });

  it('broadcastLayout is a no-op when no layout computed', () => {
    const win = makeWindow();
    const manager = new GridManager(win);

    // Should not throw, just silently return
    manager.broadcastLayout();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('refresh recomputes and broadcasts', () => {
    const win = makeWindow(1200, 600);
    const manager = new GridManager(win);

    manager.refresh(9);

    expect(win.getContentSize).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    const payload = win.webContents.send.mock.calls[0][1];
    expect(payload.cols).toBe(3);
    expect(payload.rows).toBe(3);
    expect(payload.cells).toHaveLength(9);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../src/engine/types';

const ipcMainMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    handlers,
    on: vi.fn((channel: string, cb: (...args: any[]) => any) => {
      handlers.set(channel, cb);
    }),
    removeAllListeners: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };
});

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

import { registerIpcHandlers, removeIpcHandlers } from '../../src/main/ipc-handlers';

function getHandler(channel: IpcChannel): (...args: any[]) => any {
  const handler = ipcMainMock.handlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  return handler;
}

describe('ipc-handlers', () => {
  const runner = {
    stopAll: vi.fn(async () => undefined),
    pauseBot: vi.fn(),
    resumeBot: vi.fn(),
    openFocusWindow: vi.fn(),
  } as any;

  const onStart = vi.fn(async () => undefined);
  const onRestart = vi.fn(async () => undefined);

  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  } as any;

  const uiDeps = {
    onDrawerToggle: vi.fn(),
    onOverviewToggle: vi.fn(),
    openOverviewWindow: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    ipcMainMock.handlers.clear();
    ipcMainMock.on.mockClear();
    ipcMainMock.removeAllListeners.mockClear();
    vi.clearAllMocks();
  });

  it('registers all command handlers and dispatches to runner/actions', async () => {
    registerIpcHandlers(runner, onStart, onRestart, mainWindow, uiDeps);

    expect(ipcMainMock.on).toHaveBeenCalledTimes(11);

    const payload = { url: 'http://localhost/join/x', playerCount: 4 };
    getHandler(IpcChannel.CMD_START)({}, payload);
    await Promise.resolve();
    expect(onStart).toHaveBeenCalledWith(payload);

    await getHandler(IpcChannel.CMD_STOP)({});
    expect(runner.stopAll).toHaveBeenCalledTimes(1);

    getHandler(IpcChannel.CMD_RESTART)({});
    await Promise.resolve();
    expect(onRestart).toHaveBeenCalledTimes(1);

    getHandler(IpcChannel.CMD_PAUSE)({}, { id: 'bot-1' });
    expect(runner.pauseBot).toHaveBeenCalledWith('bot-1');

    getHandler(IpcChannel.CMD_RESUME)({}, { id: 'bot-2' });
    expect(runner.resumeBot).toHaveBeenCalledWith('bot-2');

    getHandler(IpcChannel.CMD_FOCUS)({}, { id: 'bot-3' });
    expect(runner.openFocusWindow).toHaveBeenCalledWith('bot-3');
  });

  it('forwards open-drawer to mainWindow', () => {
    registerIpcHandlers(runner, onStart, onRestart, mainWindow, uiDeps);

    const payload = { id: 'bot-1', index: 0 };
    getHandler(IpcChannel.CMD_OPEN_DRAWER)({}, payload);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('open-drawer-for-bot', payload);
  });

  it('delegates drawer toggle to uiDeps', () => {
    registerIpcHandlers(runner, onStart, onRestart, mainWindow, uiDeps);

    getHandler(IpcChannel.CMD_DRAWER_TOGGLE)({}, { open: true });
    expect(uiDeps.onDrawerToggle).toHaveBeenCalledWith(true);
  });

  it('delegates open-overview to uiDeps', () => {
    registerIpcHandlers(runner, onStart, onRestart, mainWindow, uiDeps);

    getHandler(IpcChannel.CMD_OPEN_OVERVIEW)({});
    expect(uiDeps.openOverviewWindow).toHaveBeenCalledTimes(1);
  });

  it('delegates overview toggle to uiDeps', () => {
    registerIpcHandlers(runner, onStart, onRestart, mainWindow, uiDeps);

    getHandler(IpcChannel.CMD_OVERVIEW_TOGGLE)({}, { open: true });
    expect(uiDeps.onOverviewToggle).toHaveBeenCalledWith(true);
  });

  it('removes all registered listeners', () => {
    removeIpcHandlers();

    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledTimes(11);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_START);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_STOP);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_RESTART);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_PAUSE);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_RESUME);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_FOCUS);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.SCREENSHOT_DIAG);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_OPEN_DRAWER);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_DRAWER_TOGGLE);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_OPEN_OVERVIEW);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_OVERVIEW_TOGGLE);
  });
});

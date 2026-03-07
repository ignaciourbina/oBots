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
  beforeEach(() => {
    ipcMainMock.handlers.clear();
    ipcMainMock.on.mockClear();
    ipcMainMock.removeAllListeners.mockClear();
  });

  it('registers all command handlers and dispatches to runner/actions', async () => {
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

    registerIpcHandlers(runner, onStart, onRestart, mainWindow);

    expect(ipcMainMock.on).toHaveBeenCalledTimes(7);

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

  it('removes all registered listeners', () => {
    removeIpcHandlers();

    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledTimes(9);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_START);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_STOP);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_RESTART);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_PAUSE);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_RESUME);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_FOCUS);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_OPEN_DRAWER);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_DRAWER_TOGGLE);
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(IpcChannel.CMD_OVERVIEW_TOGGLE);
  });
});

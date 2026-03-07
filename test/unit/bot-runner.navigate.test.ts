import { describe, it, expect, vi } from 'vitest';
import { BotRunner } from '../../src/main/bot-runner';
import { SessionRegistry } from '../../src/main/session-registry';
import { BotInstance, BotScript } from '../../src/engine/types';

function makeWindow(): any {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
  };
}

const TEST_SCRIPT: BotScript = {
  name: 'test-script',
  initialState: 'start',
  states: {
    start: {
      transitions: [],
    },
  },
};

function makeBot(page: any): BotInstance {
  return {
    id: 'bot-1',
    index: 0,
    script: TEST_SCRIPT,
    currentState: TEST_SCRIPT.initialState,
    status: 'idle',
    browser: null,
    page,
    webviewId: 'webview-0',
    logs: [],
  };
}

describe('BotRunner.navigate', () => {
  it('retries transient navigation failures before succeeding', async () => {
    const runner = new BotRunner(makeWindow(), new SessionRegistry());
    (runner as any).sleep = vi.fn(async () => {});

    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))
      .mockResolvedValue(undefined);

    const page = {
      goto,
      reload: vi.fn(),
      url: vi.fn(() => 'http://localhost:8000/room'),
      evaluate: vi.fn(async () => ({
        title: 'ok',
        bodyText: 'ok',
      })),
    };

    const bot = makeBot(page);
    await runner.navigate(bot, 'http://localhost:8000/room');

    expect(goto).toHaveBeenCalledTimes(2);
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('refreshes when Chromium shows the unreachable-site page', async () => {
    const runner = new BotRunner(makeWindow(), new SessionRegistry());
    (runner as any).sleep = vi.fn(async () => {});

    let unreachable = true;
    const page = {
      goto: vi.fn(async () => {}),
      reload: vi.fn(async () => {
        unreachable = false;
      }),
      url: vi.fn(() => (unreachable ? 'chrome-error://chromewebdata/' : 'http://localhost:8000/room')),
      evaluate: vi.fn(async () => ({
        title: unreachable ? 'This site can\'t be reached' : 'oTree',
        bodyText: unreachable ? 'ERR_CONNECTION_REFUSED' : 'page loaded',
      })),
    };

    const bot = makeBot(page);
    await runner.navigate(bot, 'http://localhost:8000/room');

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.reload).toHaveBeenCalledTimes(1);
  });
});

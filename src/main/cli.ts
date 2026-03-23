// src/main/cli.ts
// ──────────────────────────────────────────────────────────────
// CLI argument parsing using yargs.
// Parses process.argv and returns a typed AppConfig.
// ──────────────────────────────────────────────────────────────

import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { AppConfig, DEFAULTS, DEFAULT_STRATEGY, STRATEGY_PRESETS } from '../engine/types';

/**
 * Parse CLI arguments and return an AppConfig.
 * Called from the main process entry point.
 */
export function parseCLI(argv?: string[]): AppConfig {
  // When launched via the launcher, args come after '--' to prevent
  // Electron/Chromium from interpreting them. Extract those.
  const raw = argv ?? process.argv;
  const dashDashIdx = raw.indexOf('--');
  const effectiveArgv = dashDashIdx !== -1
    ? raw.slice(dashDashIdx + 1)   // everything after '--'
    : hideBin(raw);                // normal invocation

  const args = yargs(effectiveArgv)
    .scriptName('obots')
    .usage('$0 [run] [options]')
    .command('run', 'Launch bot players against a behavioral experiment session')
    .command('$0', '(default) Launch bot players', () => {}, () => {})
    .option('url', {
      alias: 'u',
      type: 'string',
      description: 'Session-wide link or room URL',
      demandOption: false,
      default: '',
    })
    .option('players', {
      alias: 'n',
      type: 'number',
      description: 'Number of bot players',
      default: DEFAULTS.playerCount,
    })
    .option('dropout-rate', {
      type: 'number',
      description: 'Percent of bots to randomly drop during each run (0-100)',
      default: DEFAULTS.dropoutRatePercent,
    })
    .option('script', {
      alias: 's',
      type: 'string',
      description: 'Path to bot script JS/TS file (defaults to built-in poc-bot)',
    })
    .option('cols', {
      type: 'number',
      description: 'Force grid columns (auto-calculated if omitted)',
    })
    .option('delay', {
      type: 'number',
      description: 'Global action delay multiplier (1.0 = normal)',
      default: DEFAULTS.actionDelayMultiplier,
    })
    .option('strategy', {
      type: 'string',
      description: 'Bot strategy preset (random, minimum, maximum, midpoint, fixed)',
      default: 'random',
      choices: Object.keys(STRATEGY_PRESETS),
    })
    .option('headless', {
      type: 'boolean',
      description: 'Run without Electron UI (screenshot dumps)',
      default: false,
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      description: 'Verbose logging',
      default: false,
    })
    .option('devtools', {
      type: 'boolean',
      description: 'Open Electron DevTools on launch',
      default: false,
    })
    .example(
      '$0 run -u http://localhost:8000/join/xyzabc -n 4 -s ./bots/public-goods.js',
      'Run 4 bots with a bot script',
    )
    .help()
    .parseSync();

  // Default script to built-in poc-bot
  const scriptPath = (args.script as string | undefined)
    ?? path.join(__dirname, '..', 'scripts', 'poc-bot.js');

  if ((args.headless as boolean) && !(args.url as string)) {
    throw new Error('--headless requires --url because the setup UI is not shown.');
  }

  const dropoutRate = Number(args['dropout-rate']);
  if (!Number.isFinite(dropoutRate) || dropoutRate < 0 || dropoutRate > 100) {
    throw new Error('--dropout-rate must be a number between 0 and 100.');
  }

  const strategyKey = (args.strategy as string) ?? 'random';
  const strategy = STRATEGY_PRESETS[strategyKey] ?? DEFAULT_STRATEGY;

  return {
    url: args.url as string,
    playerCount: args.players as number,
    dropoutRatePercent: dropoutRate,
    scriptPath,
    cols: args.cols as number | undefined,
    delayMultiplier: args.delay as number,
    headless: args.headless as boolean,
    debug: args.verbose as boolean,
    devtools: args.devtools as boolean,
    strategy,
    botMaxRuntimeMs: DEFAULTS.botMaxRuntimeMs,
  };
}

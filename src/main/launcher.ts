#!/usr/bin/env node
// src/main/launcher.ts
// ──────────────────────────────────────────────────────────────
// CLI entry point — spawns Electron with the main process.
// This is the `obots` bin command.
// ──────────────────────────────────────────────────────────────

import { spawn } from 'child_process';
import path from 'path';

// Resolve the electron binary
let electronPath: string;
try {
  // electron exports the path to its binary
  electronPath = require('electron') as unknown as string;
} catch {
  console.error(
    'Error: electron package not found.\n' +
    'Run: npm install electron'
  );
  process.exit(1);
}

// The Electron main process entry point
const mainScript = path.join(__dirname, 'index.js');

// Forward CLI args to Electron, but wrap them after '--' so
// Electron/Chromium doesn't interpret them as its own flags.
const userArgs = process.argv.slice(2);

const child = spawn(electronPath, [mainScript, '--', ...userArgs], {
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Failed to start Electron:', err.message);
  process.exit(1);
});

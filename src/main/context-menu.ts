// src/main/context-menu.ts
// ──────────────────────────────────────────────────────────────
// Attaches a native right-click context menu (Copy / Select All)
// to any Electron WebContents.  Call once per window or view.
// ──────────────────────────────────────────────────────────────

import { Menu, type WebContents } from 'electron';

/**
 * Attach a right-click context menu with Copy / Cut / Paste / Select All
 * to the given webContents.  Safe to call multiple times — idempotent
 * because each webContents has its own event listeners.
 */
export function attachContextMenu(wc: WebContents): void {
  wc.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];

    if (params.isEditable) {
      items.push(
        { role: 'cut' },
        { role: 'paste' },
      );
    }

    if (params.selectionText) {
      items.push({ role: 'copy' });
    }

    items.push({ role: 'selectAll' });

    if (items.length > 0) {
      Menu.buildFromTemplate(items).popup();
    }
  });
}

// src/renderer/toolbar.ts
// ──────────────────────────────────────────────────────────────
// Toolbar component — top bar with controls and status display.
// ──────────────────────────────────────────────────────────────

/** Callback hooks for toolbar button actions. */
export interface ToolbarCallbacks {
  onStop: () => void;
}

/**
 * Initialize toolbar event listeners.
 */
export function initToolbar(callbacks: ToolbarCallbacks): void {
  const btnStop = document.getElementById('btn-stop');
  if (btnStop) {
    btnStop.addEventListener('click', () => {
      callbacks.onStop();
    });
  }
}

/**
 * Update the toolbar status text.
 */
export function setToolbarStatus(text: string, color?: string): void {
  const statusEl = document.getElementById('toolbar-status');
  if (statusEl) {
    statusEl.textContent = text;
    if (color) {
      statusEl.style.color = color;
    }
  }
}

/**
 * Disable all toolbar buttons (e.g. after stop).
 */
export function disableToolbarButtons(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.toolbar__btn');
  buttons.forEach((btn) => {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  });
}

// src/renderer/bot-card.ts
// ──────────────────────────────────────────────────────────────
// Bot Card component — encapsulates creation and update logic
// for a single bot tile in the grid.
// ──────────────────────────────────────────────────────────────

// NOTE: renderer files run with nodeIntegration:false — no require() available.
function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (c) => map[c] || c);
}

/** Data required to create or update a bot card tile in the grid. */
export interface BotCardData {
  index: number;
  botId: string;
  label: string;
  status: string;
  currentState: string;
  screenshotDataUrl?: string;
}

/**
 * Create a bot card DOM element.
 */
export function createBotCardElement(data: BotCardData): HTMLDivElement {
  const card = document.createElement('div');
  card.className = `bot-card bot-card--${data.status}`;
  card.id = `bot-card-${data.index}`;
  card.dataset.botId = data.botId;
  card.dataset.index = String(data.index);

  card.innerHTML = `
    <div class="bot-card__header">
      <span class="bot-card__status-dot bot-card__status-dot--${data.status}"></span>
      <span class="bot-card__label">${escapeHtml(data.label)}</span>
      <span class="bot-card__state">${escapeHtml(data.currentState || 'idle')}</span>
    </div>
    <div class="bot-card__body">
      <img class="bot-card__screenshot"
           style="display:${data.screenshotDataUrl ? 'block' : 'none'};"
           src="${data.screenshotDataUrl ?? ''}"
           alt="Bot screenshot" />
      <div class="bot-card__placeholder"
           style="display:${data.screenshotDataUrl ? 'none' : 'block'};">
        Waiting…
      </div>
    </div>
  `;

  return card;
}

/**
 * Update an existing bot card's status.
 */
export function updateBotCardStatus(card: HTMLElement, status: string): void {
  // Update card class
  card.className = `bot-card bot-card--${status}`;

  // Update status dot
  const dot = card.querySelector('.bot-card__status-dot') as HTMLElement | null;
  if (dot) {
    dot.className = `bot-card__status-dot bot-card__status-dot--${status}`;
  }
}

/**
 * Update an existing bot card's FSM state label.
 */
export function updateBotCardState(card: HTMLElement, stateName: string): void {
  const stateEl = card.querySelector('.bot-card__state') as HTMLElement | null;
  if (stateEl) {
    stateEl.textContent = stateName;
  }
}

/**
 * Update an existing bot card's screenshot.
 */
export function updateBotCardScreenshot(card: HTMLElement, dataUrl: string): void {
  const img = card.querySelector('.bot-card__screenshot') as HTMLImageElement | null;
  const placeholder = card.querySelector('.bot-card__placeholder') as HTMLElement | null;

  if (img) {
    img.src = dataUrl;
    img.style.display = 'block';
  }
  if (placeholder) {
    placeholder.style.display = 'none';
  }
}

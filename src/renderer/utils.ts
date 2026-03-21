// src/renderer/utils.ts
// ──────────────────────────────────────────────────────────────
// Shared renderer utilities.
// ──────────────────────────────────────────────────────────────

/** Escape HTML entities in user-provided strings to prevent XSS. */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (c) => map[c] || c);
}

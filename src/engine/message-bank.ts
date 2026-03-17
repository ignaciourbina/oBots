// src/engine/message-bank.ts
// ──────────────────────────────────────────────────────────────
// Pre-written message bank for bots to use in free-form text
// and textarea fields. Pure data module — zero dependencies.
// ──────────────────────────────────────────────────────────────

export type MessageCategory = 'cooperative' | 'competitive' | 'neutral' | 'conditional' | 'blank';

export const MESSAGE_CATEGORIES: readonly MessageCategory[] = [
  'cooperative',
  'competitive',
  'neutral',
  'conditional',
  'blank',
] as const;

export const MESSAGE_CATEGORY_LABELS: Record<MessageCategory, string> = {
  cooperative: 'Cooperative',
  competitive: 'Competitive / Self-interested',
  neutral: 'Neutral / Ambiguous',
  conditional: 'Conditional / Reciprocal',
  blank: 'Blank / Minimal',
};

export const MESSAGE_BANK: Record<MessageCategory, readonly string[]> = {
  cooperative: [
    'I want us both to do well.',
    "I'll go with whatever benefits us both.",
    "Let's coordinate. I'll match you.",
    "I'm going for the joint best outcome.",
    "I trust you. Let's work together.",
  ],
  competitive: [
    "I'm going to pick what's best for me.",
    "I'm looking out for myself here.",
    "Don't expect me to play nice.",
    "I'll do what maximizes my own payoff.",
    'Nothing personal, just going with my best option.',
  ],
  neutral: [
    "Not sure what I'll do yet.",
    "I'm still thinking about it.",
    'Good luck to both of us.',
    'Interesting setup.',
    "Let's see what happens.",
  ],
  conditional: [
    "I'll cooperate if you do.",
    'Match me and we both win.',
    "I'll go high if you go high.",
    'If you play fair, I will too.',
    'Your move sets mine.',
  ],
  blank: [
    '',
    'Hi.',
    'Ok.',
  ],
};

/**
 * Flatten selected categories into a single pool of messages.
 * Returns `null` if no categories are enabled.
 */
export function buildMessagePool(enabledCategories: readonly MessageCategory[]): string[] | null {
  if (!enabledCategories || enabledCategories.length === 0) return null;

  const pool: string[] = [];
  for (const cat of enabledCategories) {
    const messages = MESSAGE_BANK[cat];
    if (messages) {
      pool.push(...messages);
    }
  }
  return pool.length > 0 ? pool : null;
}

/**
 * Pick one random message from the enabled categories.
 * Returns `null` if no categories are enabled (caller falls back to `textValue`).
 */
export function pickRandomMessage(enabledCategories: readonly MessageCategory[]): string | null {
  const pool = buildMessagePool(enabledCategories);
  if (!pool) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

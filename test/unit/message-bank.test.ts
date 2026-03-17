// test/unit/message-bank.test.ts
// ──────────────────────────────────────────────────────────────
// Unit tests for the message bank module.
// ──────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  MESSAGE_BANK,
  MESSAGE_CATEGORIES,
  MESSAGE_CATEGORY_LABELS,
  buildMessagePool,
  pickRandomMessage,
  type MessageCategory,
} from '../../src/engine/message-bank';

// ── Data integrity ──────────────────────────────────────────

describe('message bank data integrity', () => {
  it('every category has at least one message', () => {
    for (const cat of MESSAGE_CATEGORIES) {
      expect(MESSAGE_BANK[cat].length).toBeGreaterThan(0);
    }
  });

  it('every category has a human-readable label', () => {
    for (const cat of MESSAGE_CATEGORIES) {
      expect(typeof MESSAGE_CATEGORY_LABELS[cat]).toBe('string');
      expect(MESSAGE_CATEGORY_LABELS[cat].length).toBeGreaterThan(0);
    }
  });

  it('MESSAGE_CATEGORIES lists all keys in MESSAGE_BANK', () => {
    const bankKeys = Object.keys(MESSAGE_BANK).sort();
    const catKeys = [...MESSAGE_CATEGORIES].sort();
    expect(catKeys).toEqual(bankKeys);
  });
});

// ── buildMessagePool ────────────────────────────────────────

describe('buildMessagePool', () => {
  it('returns null for empty array', () => {
    expect(buildMessagePool([])).toBeNull();
  });

  it('returns null for undefined-like input', () => {
    expect(buildMessagePool(undefined as unknown as MessageCategory[])).toBeNull();
  });

  it('returns correct flat array for a single category', () => {
    const pool = buildMessagePool(['cooperative']);
    expect(pool).toEqual([...MESSAGE_BANK.cooperative]);
  });

  it('returns combined array for multiple categories', () => {
    const pool = buildMessagePool(['cooperative', 'neutral']);
    expect(pool).not.toBeNull();
    expect(pool!.length).toBe(MESSAGE_BANK.cooperative.length + MESSAGE_BANK.neutral.length);
    for (const msg of MESSAGE_BANK.cooperative) {
      expect(pool).toContain(msg);
    }
    for (const msg of MESSAGE_BANK.neutral) {
      expect(pool).toContain(msg);
    }
  });

  it('returns all messages when all categories enabled', () => {
    const pool = buildMessagePool([...MESSAGE_CATEGORIES]);
    const totalMessages = MESSAGE_CATEGORIES.reduce(
      (sum, cat) => sum + MESSAGE_BANK[cat].length,
      0,
    );
    expect(pool).not.toBeNull();
    expect(pool!.length).toBe(totalMessages);
  });
});

// ── pickRandomMessage ───────────────────────────────────────

describe('pickRandomMessage', () => {
  it('returns null when no categories enabled', () => {
    expect(pickRandomMessage([])).toBeNull();
  });

  it('returns a message from the correct pool', () => {
    const category: MessageCategory = 'competitive';
    const result = pickRandomMessage([category]);
    expect(result).not.toBeNull();
    expect(MESSAGE_BANK[category]).toContain(result);
  });

  it('returns messages only from enabled categories', () => {
    const enabled: MessageCategory[] = ['cooperative', 'conditional'];
    const allowedMessages = [
      ...MESSAGE_BANK.cooperative,
      ...MESSAGE_BANK.conditional,
    ];
    // Run multiple times to increase confidence
    for (let i = 0; i < 50; i++) {
      const result = pickRandomMessage(enabled);
      expect(result).not.toBeNull();
      expect(allowedMessages).toContain(result);
    }
  });
});

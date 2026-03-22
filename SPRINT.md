# SPRINT: Custom Message List

**Branch:** `message-list-edit`
**Goal:** Allow users to define a custom list of messages in the settings GUI. When enabled, bots randomly sample from this list instead of using the static `textValue` or the built-in message bank.

---

## Priority & Selection Logic

The text-selection priority chain in `actions.ts` becomes:

```
customMessages (non-empty array)  →  messageBankCategories  →  textValue fallback
```

If the user enables **custom messages**, that takes priority.
If disabled, the existing message bank / textValue logic is unchanged.

---

## Phase 1 — Data Model & Engine

Add `customMessages` to the strategy type and wire it through the message-bank module.

### Tasks

- [ ] **1.1** Add `customMessages?: string[]` field to `BotStrategy` in `src/engine/types.ts` (line ~264, before `messageBankCategories`)
- [ ] **1.2** Add `customMessages?: string[]` to all five entries in `STRATEGY_PRESETS` (default: `undefined`)
- [ ] **1.3** Add helper `pickRandomCustomMessage(messages: string[]): string | null` to `src/engine/message-bank.ts`
  - Returns `null` if array is empty or undefined
  - Returns a random element otherwise
- [ ] **1.4** Update `fillFormFieldsVisible` in `src/engine/actions.ts` — for `case 'text'` (line 299) and `case 'textarea'` (line 308):
  - Try `pickRandomCustomMessage(strategy.customMessages)` first
  - Then fall back to `pickRandomMessage(strategy.messageBankCategories)`
  - Then fall back to `strategy.textValue`

### Acceptance Criteria

- `BotStrategy.customMessages` is an optional `string[]`
- When `customMessages` is `['hello', 'world']`, `fillFormFieldsVisible` types one of those two strings
- When `customMessages` is `undefined` or `[]`, existing behavior is unchanged
- TypeScript compiles with no errors (`npm run typecheck`)

### Tests

- [ ] **T1.1** `pickRandomCustomMessage([])` returns `null`
- [ ] **T1.2** `pickRandomCustomMessage(undefined)` returns `null`
- [ ] **T1.3** `pickRandomCustomMessage(['a', 'b', 'c'])` returns an element from the array (run 50 times)
- [ ] **T1.4** Priority chain: when both `customMessages` and `messageBankCategories` are set, custom messages win

---

## Phase 2 — IPC Payload

Thread `customMessages` through the IPC boundary from renderer to main.

### Tasks

- [ ] **2.1** Add `customMessages?: string[]` to `StrategyPayload` in `src/main/ipc-handlers.ts` (line ~31)
- [ ] **2.2** Add normalization in `src/main/index.ts` (line ~324, alongside `messageBankCategories`):
  ```ts
  customMessages: Array.isArray(start.strategy.customMessages)
    ? start.strategy.customMessages.filter((m: unknown) => typeof m === 'string')
    : undefined,
  ```

### Acceptance Criteria

- A `StartPayload` with `strategy.customMessages: ['x', 'y']` produces a `BotStrategy` with `customMessages: ['x', 'y']`
- Non-string values in the array are filtered out
- Missing field produces `undefined` (not empty array)
- TypeScript compiles with no errors

### Tests

- [ ] **T2.1** Normalization passes through a valid `customMessages` array
- [ ] **T2.2** Normalization filters non-string entries
- [ ] **T2.3** Normalization produces `undefined` when field is absent

---

## Phase 3 — Renderer UI

Add the "Custom message list" option to the settings form. This is a mutually-exclusive third mode for text input strategy.

**Constraint:** No `import` statements — all logic is inlined (renderer is sandboxed).

### Tasks

- [ ] **3.1** Add HTML controls in `src/renderer/index.html` after the message-bank section (line ~159):
  - Checkbox: `#custom-msg-enabled` — "Use custom message list"
  - Textarea: `#custom-msg-list` — placeholder "One message per line", hidden by default
  - Hint text explaining the feature
- [ ] **3.2** Add DOM references and toggle logic in `src/renderer/renderer.ts`:
  - Grab `#custom-msg-enabled` and `#custom-msg-list` elements
  - On checkbox change: show/hide textarea, disable the other text options (message bank checkbox and static text input) when custom is active — and vice versa
  - Make custom messages and message bank mutually exclusive (enabling one disables the other)
- [ ] **3.3** Update `readStrategy()` in `src/renderer/renderer.ts` (line ~218):
  - If `#custom-msg-enabled` is checked, parse textarea into `string[]` (split by newline, trim, filter empty)
  - Add `customMessages` field to the returned payload
- [ ] **3.4** Update `applyPreset()` to reset the custom message controls (uncheck, clear textarea, hide)

### Acceptance Criteria

- When "Use custom message list" is unchecked, textarea is hidden and `customMessages` is `undefined` in payload
- When checked, textarea is visible and payload contains the parsed message array
- Enabling custom messages disables the message bank checkbox (and vice versa)
- Preset selection resets custom message controls
- Empty lines and whitespace-only lines are filtered out
- The compiled `dist/renderer/renderer.js` contains zero `require()` calls

### Tests (manual verification)

- [ ] **T3.1** `npm run build` — verify `dist/renderer/renderer.js` has no `require()` calls
- [ ] **T3.2** `npm start` — toggle custom messages on/off, verify textarea shows/hides
- [ ] **T3.3** `npm start` — enable custom messages, then enable message bank — verify they are mutually exclusive
- [ ] **T3.4** `npm start` — select a preset while custom messages are active — verify controls reset

---

## Phase 4 — Integration & End-to-End

Verify the full pipeline works: UI → IPC → main → engine → page action.

### Tasks

- [ ] **4.1** Run `npm run typecheck` — zero errors
- [ ] **4.2** Run `npm test` — all existing + new unit tests pass
- [ ] **4.3** Build and launch: `npm run build && npm start`
  - Configure 2 bots with custom messages `["I cooperate", "I defect", "No comment"]`
  - Run against a local oTree session with a chat/text field
  - Verify each bot types one of the three messages (not `"test"`)
- [ ] **4.4** Verify fallback: disable custom messages, verify bots use `textValue` or message bank as before

### Acceptance Criteria

- All unit tests green
- Type checker clean
- App launches without renderer crash
- Bots sample from custom list when enabled
- Bots use existing behavior when disabled
- No regressions to message bank or textValue features

---

## Files Modified (summary)

| File | Changes |
|---|---|
| `src/engine/types.ts` | Add `customMessages` to `BotStrategy` + presets |
| `src/engine/message-bank.ts` | Add `pickRandomCustomMessage()` helper |
| `src/engine/actions.ts` | Update text/textarea cases with custom message priority |
| `src/main/ipc-handlers.ts` | Add `customMessages` to `StrategyPayload` |
| `src/main/index.ts` | Normalize `customMessages` in strategy builder |
| `src/renderer/index.html` | Add checkbox + textarea UI controls |
| `src/renderer/renderer.ts` | Toggle logic, `readStrategy()`, `applyPreset()` |
| `test/unit/message-bank.test.ts` | Tests for `pickRandomCustomMessage()` |

---

## Risk Notes

1. **Renderer sandbox** — No `import` in renderer files. All helpers must be inlined. Verify compiled JS for `require()` after build.
2. **Mutual exclusivity** — Custom messages and message bank are mutually exclusive in the UI, but the engine supports both. The priority chain handles the case defensively if both arrive.
3. **Empty textarea** — If user enables custom messages but leaves textarea empty, the engine falls through to message bank / textValue. No crash, no empty string typed.

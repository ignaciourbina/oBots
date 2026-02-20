# Writing Bot Scripts

Bot scripts define the behavior of automated players in oTree experiments. Each script is a TypeScript/JavaScript module that exports a `BotScript` object — a finite-state-machine (FSM) definition.

## Quick Start

```typescript
import { BotScript } from '../engine/types';

const myBot: BotScript = {
  name: 'My Bot',
  initialState: 'start',
  states: {
    start: {
      onEntry: [
        { type: 'log', value: 'Bot started!' },
      ],
      transitions: [
        { target: 'done' },
      ],
    },
    done: {
      onEntry: [{ type: 'log', value: 'Done.' }],
      transitions: [],
      final: true,
    },
  },
};

export default myBot;
```

## Concepts

### States

Each state has:
- **`onEntry`** — a list of actions executed sequentially when the bot enters this state.
- **`transitions`** — a list of possible next states, each gated by an optional guard condition.
- **`final`** — if `true`, the bot stops here.

### Actions

Actions are commands executed on the Puppeteer page:

| Type | Selector | Value | Description |
|------|----------|-------|-------------|
| `click` | CSS selector | — | Click an element |
| `fill` | CSS selector | string | Type text into an input |
| `select` | CSS selector | option value | Select a dropdown option |
| `wait` | — | ms (number) | Static delay |
| `waitForNavigation` | — | — | Wait for page navigation |
| `waitForSelector` | CSS selector | — | Wait until an element appears |
| `evaluate` | — | JS code string | Run arbitrary JavaScript in the page |
| `screenshot` | — | — | Capture a screenshot |
| `log` | — | message | Log a message |

### Guards

Guards are boolean conditions that gate transitions:

| Type | Selector | Value | Description |
|------|----------|-------|-------------|
| `elementExists` | CSS | — | Element is present in DOM |
| `elementNotExists` | CSS | — | Element is NOT in DOM |
| `urlContains` | — | substring | Current URL contains value |
| `urlEquals` | — | full URL | Current URL equals value |
| `textContains` | CSS | substring | Element's text contains value |
| `custom` | — | — | Custom JS function (use `fn` field) |

### Transitions

Transitions are evaluated in order. The **first** whose guard passes wins. If no guard is specified, the transition fires immediately.

```typescript
transitions: [
  // Checked first: if the URL indicates game over, go to done
  { target: 'done', guard: { type: 'urlContains', value: 'OutOfRange' } },
  // Checked second: if there's a form, fill it
  { target: 'fillForm', guard: { type: 'elementExists', selector: 'form' } },
  // Fallback: wait and re-check
  { target: 'waitForPage', delay: 2000 },
]
```

## Example: Public Goods Game Bot

```typescript
import { BotScript } from '../engine/types';

const publicGoodsBot: BotScript = {
  name: 'Public Goods Bot',
  initialState: 'waitForPage',
  states: {
    waitForPage: {
      onEntry: [
        { type: 'waitForSelector', selector: 'body', timeout: 10000 },
      ],
      transitions: [
        { target: 'done', guard: { type: 'urlContains', value: 'OutOfRange' } },
        { target: 'contribute', guard: { type: 'elementExists', selector: '#id_contribution' } },
        { target: 'clickNext', guard: { type: 'elementExists', selector: '.otree-btn-next' } },
        { target: 'waitForPage', delay: 2000 },
      ],
    },
    contribute: {
      onEntry: [
        { type: 'fill', selector: '#id_contribution', value: '5' },
        { type: 'wait', value: 200 },
      ],
      transitions: [
        { target: 'clickNext' },
      ],
    },
    clickNext: {
      onEntry: [
        { type: 'click', selector: '.otree-btn-next, .btn-primary, button[type="submit"]' },
        { type: 'waitForNavigation', timeout: 15000 },
        { type: 'wait', value: 300 },
      ],
      transitions: [
        { target: 'waitForPage' },
      ],
    },
    done: {
      onEntry: [{ type: 'log', value: 'Game complete!' }],
      transitions: [],
      final: true,
    },
  },
};

export default publicGoodsBot;
```

## Running

```bash
otree-bots run -u http://localhost:8000/join/abc123 -n 3 -s ./bots/public-goods.js
```

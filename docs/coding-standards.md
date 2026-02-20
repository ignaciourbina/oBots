# Coding Standards

This document defines the default coding standards for the `otree-bots` codebase.

## Goals

- Keep code readable, discoverable, and safe to change.
- Make behavior explicit at API boundaries.
- Prevent architecture drift by centralizing recurring logic.

## 1) Documentation Is Required

All functions must include documentation comments.

- TypeScript/JavaScript functions: use TSDoc (`/** ... */`).
- Include doc comments for:
  - exported functions
  - class methods
  - non-trivial internal helpers
- At minimum, every function comment should describe:
  - purpose
  - parameters (`@param`)
  - return value (`@returns`) when not obvious
  - side effects and thrown errors when relevant

Example:

```ts
/**
 * Starts all bot instances for a run and registers runtime state.
 *
 * @param config Runtime configuration for this execution.
 * @returns The IDs of all created bot instances.
 * @throws Error if a browser cannot be launched.
 */
export async function startRun(config: RunConfig): Promise<string[]> {
  // ...
}
```

## 2) Prefer Reusable `utils` and `libs`

If logic is repeated or likely to be reused, move it to a shared module instead of duplicating it.

- Put small, pure, cross-cutting helpers in `utils/`.
- Put larger domain or infrastructure building blocks in `libs/`.
- Do not copy-paste selector parsing, retry logic, state transitions, IPC payload shaping, or validation logic across files.

Rule of thumb:

- Second use of similar logic: extract it.
- Third use: extraction is mandatory.

This keeps system behavior consistent and avoids system design drift.

## 3) Function Design

- Keep functions focused on one responsibility.
- Favor explicit inputs/outputs over hidden global state.
- Prefer small composable functions over large procedural blocks.
- Avoid boolean-flag-heavy signatures; use typed option objects for clarity.

## 4) Types and Contracts

- Avoid `any`; use concrete types or `unknown` with narrowing.
- Export shared types from canonical type modules (for example, engine types).
- Validate external inputs at boundaries (CLI args, IPC payloads, user scripts).

## 5) Errors and Logging

- Throw typed or structured errors with actionable messages.
- Do not swallow errors silently.
- Add contextual logging at orchestration boundaries (bot ID, state, action).

## 6) Testing Expectations

- Add or update tests for every behavior change.
- Unit tests for extracted `utils`/`libs` logic.
- Integration/e2e coverage for execution flow changes.
- Keep tests deterministic: avoid arbitrary sleeps when explicit waits/assertions are possible.

## 7) Review Checklist

Before merging, confirm:

- Every new/changed function has TSDoc/docstrings.
- Repeated logic has been extracted into `utils` or `libs`.
- Public interfaces and shared types are documented.
- Error handling and tests cover the changed paths.


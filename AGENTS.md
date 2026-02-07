# Agent Working Rules

## Required Project Context

- Read `ARCHITECTURE.md` and `FEATURE_LIST.md` before making architectural or feature changes.
- Treat `ARCHITECTURE.md` as the source of truth for module boundaries and responsibilities.
- Treat `FEATURE_LIST.md` as the source of truth for roadmap phase status.
- When you materially change architecture, module ownership, or phase completion, update `ARCHITECTURE.md` and/or `FEATURE_LIST.md` in the same change.

## Code Quality Rules

- Prioritize deterministic behavior. Avoid non-seeded randomness in generation code.
- Prefer small, single-purpose modules over large multi-responsibility files.
- Keep APIs explicit. Pass config/dependencies directly rather than using hidden globals.
- Reuse existing utilities and types before introducing new abstractions.
- Avoid duplication. If logic is reused across systems, extract a shared helper/module.
- Make the smallest correct change that preserves behavior unless a larger refactor is requested.

## Comments and Readability

- Do not add comments for obvious code.
- Add comments only when the code expresses a non-obvious constraint, bug workaround, or unusual algorithmic tradeoff.
- Prefer clear naming and structure over explanatory comments.

## Safety and Change Discipline

- Do not perform destructive git/file operations unless explicitly asked.
- Do not revert user changes unrelated to the task.
- Keep edits scoped to the request.
- If validation cannot be run locally (missing tools), state that clearly in the final summary.

## Implementation Workflow

- For each task: gather context, implement, validate when possible, and update docs/checklists if needed.
- Keep renderer and generation concerns separated; avoid coupling runtime orchestration with low-level drawing logic.
- Preserve existing visual style direction unless the task requests a style shift.

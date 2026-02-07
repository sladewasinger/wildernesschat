# Session Resume Plan

This file is the handoff checkpoint for the next coding session.

## Current State (as of this handoff)

- V2 stages implemented in code:
  - Stage 0: terrain only
  - Stage 1: single anchor house + trunk road per village site
  - Stage 2: iterative houses + drives along trunk
  - Stage 3: branch roads + constrained shortcuts
  - Stage 4: inter-village connector pass + branch reuse heuristic
- Stage 3 now includes deterministic per-site growth profiles (`sparse`, `normal`, `dense`, `burst`) to allow occasional high-road-count villages.
- `src/v2/config.ts` is now stage-structured (`siting`, `roads`, `housing`, `stage2`, `stage3`, `stage4`) instead of one flat settlement object.
- V2 generator refactor completed:
  - `src/v2/generator.ts` is now an orchestrator/facade.
  - Generation logic is split across focused modules:
    - `src/v2/generator/site-selection.ts`
    - `src/v2/generator/trunk.ts`
    - `src/v2/generator/housing.ts`
    - `src/v2/generator/branching.ts`
    - `src/v2/generator/shortcuts.ts`
    - `src/v2/generator/inter-village.ts`
    - `src/v2/generator/geometry.ts`
- Stage observability added to HUD:
  - Per visible site counters: `b` (branches), `s` (shortcuts), `c` (inter-village connectors).
  - Visible aggregate counters for branches/shortcuts/connectors.
- Build validation status:
  - TypeScript check passes via `node ./node_modules/typescript/bin/tsc --noEmit`.
  - Production build passes via `node ./node_modules/vite/bin/vite.js build`.
  - `npm run build` currently fails in this environment because `tsc` resolves to a non-executable shim (`Permission denied`).

## User Feedback Carried Forward

1. Stage 3 visual quality improved but still needs stronger branch quantity/length in some seeds.
2. Stage 4 previously looked inactive in normal play.
3. Stage 1-3 are not yet "done" from product quality perspective.

## Stage 4 Visibility Status

- Stage 4 behavior is active and now observable in HUD via per-site `c` connector counts.
- In many view windows connector count can still be low/zero due deterministic pair distance/probability filters.
- The difference from Stage 3 is now explicit instead of implicit.

## Priority Resume Order (Next Session)

1. **Stage 1-3 quality pass (highest priority)**
   - Reduce duplicate near-parallel branch outcomes.
   - Reduce local road tangles/tight triangle artifacts.
   - Keep house-road spacing stable and non-clipping.
   - Capture a fixed regression seed set and verify visual stability.

2. **Stage 4 redesign decision (planning first)**
   - Decide whether Stage 4 should remain purely inter-village linking, or include multi-anchor settlement seeding.
   - Document deterministic rules in config before implementation.

3. **Promotion planning**
   - Identify V2 systems ready for incremental adoption into main pipeline.

## Acceptance Criteria for Next "Resume Complete"

- Stage 1-3 pass fixed regression seeds without obvious duplicate-parallel branch failures or local tangles.
- House-road spacing behavior remains stable after branch-quality changes.
- Stage 4 design direction is selected and documented before coding.

## Quick Resume Commands

```bash
npm run dev
```

If build verification is needed and `npm run build` still fails with `tsc: Permission denied`:

```bash
node ./node_modules/typescript/bin/tsc --noEmit
node ./node_modules/vite/bin/vite.js build
```

Open:

- `http://localhost:5173/v2.html?seed=v2-seed-001&stage=3`
- `http://localhost:5173/v2.html?seed=v2-seed-001&stage=4`

Compare same viewport and review per-site HUD counters (`b/s/c`).

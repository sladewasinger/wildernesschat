# Session Resume Plan

This file is the handoff checkpoint for the next coding session.

## Current State (as of this handoff)

- V2 stages currently implemented in code:
  - Stage 0: terrain only
  - Stage 1: single anchor house + trunk road per village site
  - Stage 2: iterative houses + drives along trunk
  - Stage 3: branch roads + constrained shortcuts
  - Stage 4: inter-village connector pass + branch reuse heuristic
- Road rendering is unified and looks correct (single material + single outline).
- Build is currently passing (`npm run build`).

## User Feedback Captured

1. Stage 3 is now visually much better.
2. Stage 4 appears to have little/no visible effect in normal play.
3. Stages 1-3 are still not "done" from a product perspective. -- Stage 3 appears to have good results, but not enough roads are splitting off (and not long enough).
4. `src/v2/generator.ts` is too large and violates maintainability expectations in `AGENTS.md` (single-purpose modules, clean separation of concerns).
5. Request for this handoff:
  - Document exactly what to resume next.
  - Include findings on why Stage 4 appears inactive.
  - Include concrete refactor plan for V2 module split.

## Findings: Why Stage 4 Looks Inactive

- Stage 4 is active in code, but its visible impact can be low because:
  - It only adds connectors when nearby village-site pairs pass deterministic distance/probability filters.
  - In many view windows there may be no eligible pair, or connectors may be off-screen.
  - Stage 1 currently creates one anchor per site, so visual "new anchors" are not introduced by Stage 4 itself.
- This means Stage 4 behavior is present but often subtle; current UX does not make Stage 4 effects obvious.

## Important Clarification About Stage 1

- Stage 1 is currently "one anchor house per village site", not "one anchor for entire view/world".
- Multiple village sites can exist simultaneously in bounds, but each site only starts with one anchor house.
- User request for future design direction:
  - Keep possibility of multiple villages visible/active in view.
  - Consider evolving Stage 1 definition toward "settlement seed set" (multiple anchors per local cluster) before applying later stages.
- Do not implement this yet; plan it first.

## Priority Resume Order (Next Session)

1. **Refactor first (required before more feature growth)**
   - Split `src/v2/generator.ts` into focused modules:
   - `src/v2/generator/site-selection.ts`
   - `src/v2/generator/trunk.ts`
   - `src/v2/generator/housing.ts`
   - `src/v2/generator/branching.ts`
   - `src/v2/generator/shortcuts.ts`
   - `src/v2/generator/inter-village.ts`
   - `src/v2/generator/geometry.ts`
   - Keep `src/v2/generator.ts` as thin orchestrator/facade.

2. **Add observability for stage effects**
   - HUD counters per visible site:
   - branch count
   - shortcut count
   - inter-village connector count
   - This makes Stage 3 vs Stage 4 differences explicit and testable.

3. **Finish Stage 1-3 quality pass**
   - Formalize acceptance checks:
   - No near-parallel duplicate roads inside one village.
   - No local road tangles/triangles with tiny spacing.
   - Consistent house-road spacing and non-clipping.
   - Keep current strong rendering style.

4. **Stage 4 redesign planning (not immediate implementation)**
   - Decide whether Stage 4 should include:
   - multi-anchor seeding per local settlement cluster, or
   - purely inter-village linking on existing anchors.
   - Pick one and define deterministic rules in config.

## Acceptance Criteria for "Resume Complete"

- `src/v2/generator.ts` is no longer a large monolith and only coordinates modules.
- Stage counters in HUD clearly show why Stage 4 differs from Stage 3 for the same seed/location.
- For a fixed regression seed set, no obvious local duplicate-parallel branch cases remain.
- All docs updated in same change (`FEATURE_LIST.md`, `ARCHITECTURE.md`, this file).
- Build passes.

## Quick Resume Command

```bash
npm run dev
```

Open:

- `http://localhost:5173/v2.html?seed=v2-seed-001&stage=3`
- `http://localhost:5173/v2.html?seed=v2-seed-001&stage=4`

Compare with the same viewport and HUD counters.

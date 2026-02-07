# Session Resume Plan

This file is the handoff checkpoint for the next coding session.

## Current State (as of this handoff)

- V2 stages implemented in code:
  - Stage 0: terrain only
  - Stage 1: single anchor house + trunk road per village site
  - Stage 2: iterative houses + drives along trunk
  - Stage 3: branch roads + constrained shortcuts
  - Stage 4: nearest-village connector targeting + fallback extension/outbound roads
- V2 generator refactor is complete (`src/v2/generator.ts` facade + focused submodules).
- V2 config is stage-structured (`siting`, `roads`, `housing`, `stage2`, `stage3`, `stage4`).
- HUD observability exists (`b/s/c` counts).

## Blocking Reality Check

- User still reports no visible practical difference between Stage 3 and Stage 4 during runtime testing, even after multiple Stage 4 strategy changes and config tuning.
- Most likely issue: current Stage 4 model is still too dependent on nearby settlement availability/discovery and per-view generation context.
- Current Stage 4 implementation direction is therefore not matching product vision.

## Product Direction (User-Confirmed)

- Pivot toward a **road-first continuity model**:
  - Long roads should continue as player travels.
  - Roads should rarely all dead-end.
  - Settlement linking should emerge from the road network, not be the only source of long roads.
- Visual goal: obvious long inter-settlement road continuity in normal exploration.

## Priority Resume Order (Next Session)

1. **Design pivot spec first (no blind tuning pass)**
   - Define road-first Stage 4 rules independent of already-visible village neighbors.
   - Decide persistence unit (cell/supercell) for long-road stubs so continuity survives panning.
   - Define deterministic continuation rules at road endpoints (forward growth, branching budget, merge opportunities).

2. **Implement road-first Stage 4 prototype**
   - Generate long-road skeleton first in area around player using deterministic cell seeds.
   - Allow villages to attach to this skeleton, rather than only village-to-village linking.
   - Keep houses off long connectors by default to preserve visual readability.

3. **Acceptance check for pivot**
   - For fixed seeds and wide panning paths, Stage 4 should visibly add persistent long roads beyond Stage 3.
   - Roads should not collapse into isolated dead-end clusters in normal travel.

## Technical Notes for Resume

- Current Stage 4 code to revisit or replace:
  - `src/v2/generator/inter-village.ts`
  - `src/v2/config.ts` (`stage4` block)
- Existing checks that should remain in any pivot:
  - Parallel suppression
  - Road spacing checks
  - House clearance checks

## Build Validation Status

- TypeScript check passes via:
  - `node ./node_modules/typescript/bin/tsc --noEmit`
- Production build passes via:
  - `node ./node_modules/vite/bin/vite.js build`
- `npm run build` currently fails in this environment due `tsc` executable permission issue.

## Quick Resume Commands

```bash
npm run dev
```

Open and compare:

- `http://localhost:5173/v2.html?seed=v2-seed-001&stage=3`
- `http://localhost:5173/v2.html?seed=v2-seed-001&stage=4`


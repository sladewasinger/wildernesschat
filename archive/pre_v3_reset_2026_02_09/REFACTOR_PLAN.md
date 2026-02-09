# Refactor Plan

## Objective

Bring the generator output closer to the target village-map style (Watabou-like procedural 2D cartography): coherent settlement structure, clear land-use, bold outlines, and stable real-time performance.

## Status

- [x] Phase 1 foundation pass completed:
  - `SettlementLayout` artifact introduced.
  - Road hierarchy metadata integrated into settlement generation.
  - Template-driven local street generation integrated.
  - Road graph with bridge-node semantics integrated.
- [x] Phase 1.5 visual-structure pass completed:
  - Local streets switched to trunk-road-first village synthesis.
  - Branch growth constrained with deterministic intersection/overlap guards.
  - Hierarchy-specific road rendering pass applied for clearer arterial/collector/lane/path separation.
- [x] Parallel V2 sandbox track started:
  - Separate `v2.html` entrypoint created.
  - Stage-based prototype flow added for visual verification (`terrain -> anchor trunk -> iterative growth -> Y/shortcut`).
- [ ] Phase 2+ pending.

This plan avoids a full rewrite first. It uses a staged re-architecture so we can preserve working systems (determinism, chunking, caches) while replacing the parts causing style drift.

## Current Gap Summary

1. Over-coupled generation and stylization decisions.
2. Roads are generated with insufficient hierarchy constraints (regional/local intent can blur).
3. Settlement composition is not driven strongly enough by a clear village structure model.
4. Rendering style is partly procedural-symbolic, but not fully rule-consistent across features.
5. Performance spikes still occur during chunk boundary traversal.

## Additional Reference Insights (River Village)

1. Bridges are primary topology anchors, not decorative overlays.
2. Roads converge to bridges as chokepoints; bridge placement shapes village structure.
3. Roofs use a globally consistent sun model (one roof face lit, one shaded) with directional cast shadow.
4. River-to-water joins are visually seamless because water is treated as one continuous rendered medium.
5. Forest rendering has two scales:
   - large canopy masses for dense interior
   - individual crowns at boundaries and corridors.

## Recommendation: Re-Architecture, Not Full Rewrite

Do not restart from scratch yet. Keep:

1. Seeded determinism model.
2. Chunk streaming/cache framework.
3. Existing modular folders (`src/gen/*`, `src/world/render/*`).

Replace/refactor:

1. Settlement layout logic and constraints.
2. Style pipeline so rendering is rule-based and layered from explicit feature masks.
3. Generation scheduling to eliminate travel hitching.

If this staged approach fails quality gates by the end of Phase 3 below, then trigger a targeted rewrite of settlement generation only (not world runtime).

## Target Architecture (High-Level)

1. **Layout Model Layer** (`src/gen/layout/*`)
   - Produces canonical map primitives only: water bodies/channels, roads, parcels, building footprints, vegetation regions.
   - No drawing-style concerns.
2. **Constraint Solvers Layer** (`src/gen/constraints/*`)
   - Enforces topological rules:
   - Rivers connect to water network.
   - Road graph hierarchy and crossing policy.
   - Building/parcel validity and spacing.
3. **Style Layer** (`src/world/style/*`)
   - Converts primitives into render-ready styles (stroke/fill, symbol variants, contour/noise overlays).
   - Centralized art direction profiles.
4. **Renderer Layer** (`src/world/render/*`)
   - Raster/vector compositing only.
   - No generation decisions.

## Execution Phases

## Phase 0: Baseline and Visual Contract

1. Freeze a reference seed set (10-20 seeds) and capture screenshots for comparison.
2. Define acceptance rubric:
   - Road coherence
   - Village legibility
   - Water continuity
   - Field readability
   - Forest silhouette quality
   - Frame stability while moving
3. Add a simple “visual regression checklist” document tied to the seed set.

Deliverable:

1. `docs/VISUAL_CONTRACT.md` with explicit pass/fail checks.

## Phase 1: Settlement Graph Refactor

1. Introduce explicit road hierarchy graph:
   - `arterial`, `collector`, `lane`, `path`.
2. Refactor local roads to be generated from village structure templates:
   - Lakeside village
   - Crossroad village
   - Linear roadside hamlet
3. Generate parcels from graph edges by hierarchy rules (not uniform lotting everywhere).
4. Enforce deterministic rule ordering and stable IDs at each step.
5. Add bridge-node semantics in the road graph so crossings are first-class constraints.

Deliverable:

1. New `layout` module producing a deterministic `SettlementLayout` artifact.

## Phase 2: Water Network Refactor

1. Promote water to a first-class network artifact:
   - Lake polygons (or masks)
   - River polylines/channels
   - Connection graph
2. Build all crossings from explicit road-water intersections:
   - Bridge placement policy by road hierarchy and span limits.
3. Remove any renderer-only hacks that hide invalid topology.
4. Ensure river mouths merge into lake/ocean water regions in the same raster/vector water layer.

Deliverable:

1. Single source of truth for water geometry consumed by both generation and rendering.

## Phase 3: Style System Refactor

1. Create style profile config (`CartographicStyleProfile`):
   - Stroke widths by feature class
   - Color ramps
   - Symbol families (trees, roofs, fields)
   - Global sun vector and shadow projection model
2. Make dense forest rendering rule-driven:
   - canopy mass interiors
   - boundary individual crowns
3. Ensure houses/fields/roads share consistent outline language.
4. Use a deterministic roof-face lighting split from sun direction and building angle.

Deliverable:

1. Swappable style profile with one locked “target look”.

## Phase 4: Performance Hardening

1. Add directional prefetch metrics in HUD/logs:
   - pending queue depth
   - chunk build duration percentile
2. Split chunk generation budget by stage:
   - terrain
   - layout
   - style render
3. Precompute/cache expensive region artifacts (layout and water network) before entering viewport.

Deliverable:

1. Hitch budget target met (no visible movement stutter in baseline seed set on target hardware).

## Phase 5: Validation + Cleanup

1. Determinism checks across OS/runtime combinations.
2. Visual checklist pass on baseline seeds.
3. Remove deprecated code paths and legacy fallback logic.

Deliverable:

1. Updated `FEATURE_LIST.md` and `ARCHITECTURE.md` reflecting final boundaries and completed phases.

## Immediate First Tasks (No Rewrite Trigger Yet)

1. Add `docs/VISUAL_CONTRACT.md` and seed list.
2. Define `SettlementLayout` schema and adopt it in one pilot region.
3. Add road hierarchy enums and convert current road generator to output them.
4. Move all stroke/fill constants into a style profile object.
5. Add bridge-node constraints to settlement templates (river village as first template).

## Rewrite Trigger Conditions

Escalate to “settlement generator rewrite” only if either condition is true after Phase 3:

1. Visual contract fails for more than 30% of baseline seeds.
2. Required constraints force repeated renderer-level patching instead of layout-level fixes.

## Risks

1. Incremental migration can temporarily duplicate logic.
2. Style consistency may regress while two pipelines coexist.
3. Performance may dip before cache partitioning is complete.

Mitigations:

1. Keep old and new pipeline behind feature flag during migration.
2. Require baseline-seed screenshot review for each phase.
3. Track frame-time and pending-chunk metrics each milestone.

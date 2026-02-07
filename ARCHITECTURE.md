# Architecture

This project uses deterministic procedural generation with clear module boundaries.

## Runtime Layers

- `src/main.ts`
  - Parses URL config overrides and boots the app.
- `v2.html` + `src/v2/main.ts`
  - Parallel sandbox entrypoint for staged village-generation prototyping.
  - Isolated from the main world pipeline to allow fast visual iteration.
- `src/game.ts`
  - Camera/input loop and HUD.
- `src/world/world.ts`
  - Chunk cache + top-level world orchestration.
  - Frame-budgeted chunk generation queue and seam validation hooks.
  - Movement-direction chunk prefetch and queue prioritization for visible chunks.
  - Wires generation systems and render modules.

## Rendering Modules

- `src/world/render/chunk-renderer.ts`
  - Per-chunk render orchestration and canvas lifecycle.
- `src/world/render/terrain-surface-renderer.ts`
  - Terrain rasterization (full-res + block sampling with shoreline AA).
  - Unified water raster composition (terrain water + river channel mask in one pass).
- `src/world/render/color-sampler.ts`
  - Terrain/water/debug color policy and shoreline edge styling.
- `src/world/render/land-use-blender.ts`
  - Land-use suitability blending for forest/field placement around roads and villages.
  - Coefficient-driven tuning layer for visual readability (field rings, forest pullback near settlements).
- `src/world/render/feature-overlay-renderer.ts`
  - Rivers, forests, fields, roads, villages, parcels, and houses overlays.
  - Applies outline-first cartographic styling, bridge rendering at river crossings, and river-mouth blending.
  - Uses hierarchy-specific road stroke/fill language for arterial/collector/lane/path readability.
  - Renders dense canopy masses for forests with individual edge trees.
- `src/world/render/superchunk-feature-cache.ts`
  - Superchunk-scoped settlement feature cache with eviction.
- `src/world/render/chunk-seam-validator.ts`
  - Optional seam checks between generated neighbor chunk edges.

## Style Modules

- `src/world/style/cartographic-style.ts`
  - Central art-direction constants (sun direction, shadow offsets, roof palette families).

## Generation Modules

- `src/gen/terrain.ts`
  - Elevation/moisture/water sampling.
- `src/gen/rivers.ts`
  - Deterministic river tracing and region cache.
  - Enforces water-connected river termination and anti-loop safeguards.
- `src/gen/settlement/system.ts`
  - Settlement aggregate pipeline and region cache.
  - Composes generators through `SettlementLayoutBuilder`, then exposes render-facing `SettlementFeatures`.
- `src/gen/layout/settlement-layout-builder.ts`
  - Builds deterministic per-region `SettlementLayout` artifacts.
  - Produces first-class road graph metadata (`roadNodes`/`roadEdges`) with bridge-node semantics.
- `src/gen/determinism-suite.ts`
  - Determinism report and repeat-run consistency checks.

## Settlement Submodules

- `src/gen/settlement/village-generator.ts`
  - Village siting (suitability + spacing) and deterministic village template selection.
- `src/gen/settlement/road-generator.ts`
  - Regional + local roads with explicit hierarchy metadata (`arterial`, `collector`, `lane`, `path`).
  - Local streets are template-driven (`lakeside`, `crossroad`, `linear`) with trunk-road-first layout.
  - Deterministic branch growth runs off trunk corridors with intersection/overlap guards.
  - Controlled regional connectors attach villages to nearby regional roads through trunk anchors.
  - Regional routing reserves bridgeable water spans for downstream bridge rendering.
- `src/gen/settlement/parcel-generator.ts`
  - Lot/parcel generation along roads with hierarchy-aware frontage density rules.
- `src/gen/settlement/house-generator.ts`
  - House placement from parcels with hierarchy-aware occupancy.
- `src/gen/settlement/types.ts`
  - Shared settlement domain types, including `SettlementLayout` and road graph primitives.
- `src/gen/settlement/geometry.ts`
  - Shared geometry helpers.
- `src/gen/settlement/stable-ids.ts`
  - Canonical deterministic IDs for villages/roads/parcels/houses and road graph nodes/edges.

## Multiplayer Readiness

- `src/net/handshake.ts`
  - Canonical seed + generation config handshake format with stable config hash.

## Design Principles

- Deterministic by seed:
  - Every feature stage uses hash-based deterministic randomness.
- Config-first:
  - Tuning lives in `src/gen/config.ts`.
- Cached by region/chunk:
  - World, river, and settlement pipelines cache generated results.
- Readable over clever:
  - Narrow, single-purpose modules instead of one monolithic generator file.

## Experimental Sandbox

- `src/v2/config.ts`
  - Centralized V2 constants (zoom limits, contour sampling step, stage bounds, settlement sizing/clearances).
- `src/v2/terrain.ts`
  - Terrain-only elevation/slope prototype sampler (no water dependency).
- `src/v2/generator.ts`
  - Stepwise settlement prototype generator:
  - Stage 0 terrain-only
  - Stage 1 anchor house + trunk road
  - Stage 2 iterative house growth from trunk
  - Stage 3 Y-branches + shortcuts
- `src/v2/app.ts`
  - Rendering and stage controls (`1-4` or `[ ]`) for visual verification.

## Legacy

- Legacy WFC modules have been removed from the active codebase.

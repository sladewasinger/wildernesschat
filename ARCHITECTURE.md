# Architecture

This project uses deterministic procedural generation with clear module boundaries.

## Runtime Layers

- `src/main.ts`
  - Parses URL config overrides and boots the app.
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
  - Renders dense canopy masses for forests with individual edge trees.
- `src/world/render/superchunk-feature-cache.ts`
  - Superchunk-scoped settlement feature cache with eviction.
- `src/world/render/chunk-seam-validator.ts`
  - Optional seam checks between generated neighbor chunk edges.

## Generation Modules

- `src/gen/terrain.ts`
  - Elevation/moisture/water sampling.
- `src/gen/rivers.ts`
  - Deterministic river tracing and region cache.
  - Enforces water-connected river termination and anti-loop safeguards.
- `src/gen/settlement/system.ts`
  - Settlement aggregate pipeline and region cache.
  - Composition root for settlement submodules.
- `src/gen/determinism-suite.ts`
  - Determinism report and repeat-run consistency checks.

## Settlement Submodules

- `src/gen/settlement/village-generator.ts`
  - Village siting (suitability + spacing).
- `src/gen/settlement/road-generator.ts`
  - Regional + local roads.
  - Local streets are village-axis-aligned bands with controlled connectors to nearby regional roads.
  - Regional routing reserves bridgeable water spans for downstream bridge rendering.
- `src/gen/settlement/parcel-generator.ts`
  - Lot/parcel generation along roads.
- `src/gen/settlement/house-generator.ts`
  - House placement from parcels.
- `src/gen/settlement/types.ts`
  - Shared settlement domain types.
- `src/gen/settlement/geometry.ts`
  - Shared geometry helpers.
- `src/gen/settlement/stable-ids.ts`
  - Canonical deterministic IDs for villages/roads/parcels/houses.

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

## Legacy

- `src/wfc/*` remains for historical reference only and is not used by the active runtime.

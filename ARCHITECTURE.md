# Architecture

This project uses deterministic procedural generation with clear module boundaries.

## Runtime Layers

- `src/main.ts`
  - Parses URL config overrides and boots the app.
- `src/game.ts`
  - Camera/input loop and HUD.
- `src/world/world.ts`
  - Chunk cache + rendering orchestration.
  - Delegates generation to `src/gen/*`.

## Generation Modules

- `src/gen/terrain.ts`
  - Elevation/moisture/water sampling.
- `src/gen/rivers.ts`
  - Deterministic river tracing and region cache.
- `src/gen/settlement/system.ts`
  - Settlement aggregate pipeline and region cache.
  - Composition root for settlement submodules.

## Settlement Submodules

- `src/gen/settlement/village-generator.ts`
  - Village siting (suitability + spacing).
- `src/gen/settlement/road-generator.ts`
  - Regional + local roads.
- `src/gen/settlement/parcel-generator.ts`
  - Lot/parcel generation along roads.
- `src/gen/settlement/house-generator.ts`
  - House placement from parcels.
- `src/gen/settlement/types.ts`
  - Shared settlement domain types.
- `src/gen/settlement/geometry.ts`
  - Shared geometry helpers.

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


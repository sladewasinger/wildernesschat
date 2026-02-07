# Organic Village Generator (Pivot In Progress)

This repo is now running an organic terrain/water/settlement generator with phase 5-7 systems in place (land-use blending, streaming/perf controls, determinism tooling) toward a Watabou-style village/countryside map.

## Current Run Command

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Parallel sandbox prototype:

- `http://localhost:5173/v2.html`
- Optional params: `seed`, `stage` (`0..3`)

## Query Params

- `seed` (default `watabou-like-prototype`)
- `chunkSize` in pixels (default `320`, allowed `180..640`)
- `seaLevel` (default from config, allowed `0.3..0.68`)
- `sampleStep` terrain sampling step (default `2`, allowed `1..8`; higher is faster/blockier)
- `superchunkSpan` settlement superchunk width in chunks (default from config, allowed `1..8`)
- `genBudgetMs` chunk generation budget per frame in milliseconds (default from config, allowed `0.5..24`)
- `maxChunkBuilds` max chunks generated per frame (default from config, allowed `1..8`)
- `prefetchLookahead` ahead-of-player chunk distance to prefetch (default from config, allowed `0..8`)
- `prefetchLateral` side padding in chunks for prefetch (default from config, allowed `0..6`)
- `seamValidation` seam validator toggle (`1`/`0` or `true`/`false`)
- `determinism` run determinism suite once at startup and log report (`1`/`0`)
- `determinismRuns` repeat count when determinism suite is enabled (default `3`)

Example:

`http://localhost:5173/?seed=coastal-village&chunkSize=320&seaLevel=0.51&sampleStep=2`

## Runtime Controls

- Move: `WASD` / Arrow Keys

## Current Generator Layers

- Terrain: domain-warped elevation + moisture
- Water: unified raster layer from sea-level mask + river channels
- Settlements: deterministic suitability scoring + spacing
- Roads: regional graph (MST + loop edges) with curved routing
- Local streets: trunk-road-first synthesis with deterministic branch constraints
- Parcels: roadside lot generation for village blocks/frontage
- Houses: parcel-based placement aligned to road-facing lots
- Fields: deterministic village-outskirt agricultural patches (first pass)
- Forests: top-down stylized tree canopies + dense canopy mass rendering
- Land-use blending: tuned forest/field pressure from village and road proximity
- Water/Road styling: bold outline-first rendering with river-width hierarchy and bridge spans at crossings
- Streaming: queued chunk generation with frame-budget throttling + superchunk feature caching + directional prefetch
- Multiplayer prep: canonical seed/config handshake hash + deterministic stable feature IDs

Notes:

- Moisture is an ecological scalar used by forests/settlements, not a direct water depth indicator.
- Determinism suite can be run via URL (`?determinism=1`) and compared across machines using reported hashes.

## Structure

See `ARCHITECTURE.md` for module boundaries and generation pipeline organization.

The sandbox rebuild track lives under `src/v2/*` and is intentionally isolated from the main world pipeline.

## Pivot Plan

See `FEATURE_LIST.md` for:

- selected algorithms (terrain, villages, roads, buildings, forests, fields)
- deterministic chunking strategy for infinite worlds
- implementation phases and progress checklist

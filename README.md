# Organic Village Generator (Pivot In Progress)

This repo is now running an organic terrain/water/settlement generator with phase 5-7 systems in place (land-use blending, streaming/perf controls, determinism tooling) toward a Watabou-style village/countryside map.

The old image-trained WFC modules are still in `src/wfc/*` as legacy reference, but they are no longer used by runtime.

## Current Run Command

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Query Params

- `seed` (default `watabou-like-prototype`)
- `chunkSize` in pixels (default `320`, allowed `180..640`)
- `seaLevel` (default from config, allowed `0.3..0.68`)
- `sampleStep` terrain sampling step (default `2`, allowed `1..8`; higher is faster/blockier)
- `superchunkSpan` settlement superchunk width in chunks (default from config, allowed `1..8`)
- `genBudgetMs` chunk generation budget per frame in milliseconds (default from config, allowed `0.5..24`)
- `maxChunkBuilds` max chunks generated per frame (default from config, allowed `1..8`)
- `seamValidation` seam validator toggle (`1`/`0` or `true`/`false`)
- `determinism` run determinism suite once at startup and log report (`1`/`0`)
- `determinismRuns` repeat count when determinism suite is enabled (default `3`)

Example:

`http://localhost:5173/?seed=coastal-village&chunkSize=320&seaLevel=0.51&sampleStep=2`

## Runtime Controls

- Move: `WASD` / Arrow Keys
- Debug overlays:
- `1` water mask
- `2` moisture
- `3` forest mask
- `4` contours
- `5` rivers
- `6` roads
- `7` village markers
- `8` houses
- `9` parcels

## Current Generator Layers

- Terrain: domain-warped elevation + moisture
- Water: sea-level masking + rivers
- Settlements: deterministic suitability scoring + spacing
- Roads: regional graph (MST + loop edges) with curved routing
- Local streets: village-axis-guided lanes and cross streets with reduced overlap
- Parcels: roadside lot generation for village blocks/frontage
- Houses: parcel-based placement aligned to road-facing lots
- Fields: deterministic village-outskirt agricultural patches (first pass)
- Forests: density-driven clustered tree rendering (stylized tree symbols)
- Land-use blending: tuned forest/field pressure from village and road proximity
- Water/Road styling: bold outline-first rendering with river-width hierarchy and road-near-river culling
- Streaming: queued chunk generation with frame-budget throttling + superchunk feature caching
- Multiplayer prep: canonical seed/config handshake hash + deterministic stable feature IDs

Notes:

- Contours are optional styling; toggle with `4`.
- Moisture is an ecological scalar used by forests/settlements, not a direct water depth indicator.
- When any mask view is active (`1`/`2`/`3`), decorative layers (roads/parcels/houses/trees) are hidden so the mask reads clearly.
- Determinism suite can be run via URL (`?determinism=1`) and compared across machines using reported hashes.

## Structure

See `ARCHITECTURE.md` for module boundaries and generation pipeline organization.

## Pivot Plan

See `FEATURE_LIST.md` for:

- selected algorithms (terrain, villages, roads, buildings, forests, fields)
- deterministic chunking strategy for infinite worlds
- implementation phases and progress checklist

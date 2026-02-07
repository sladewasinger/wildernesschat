# Organic Village Generator (Pivot In Progress)

This repo is now running an organic terrain/water/settlement generator (Phase 0-3) toward a Watabou-style village/countryside map.

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

Example:

`http://localhost:5173/?seed=coastal-village&chunkSize=320&seaLevel=0.51`

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

## Current Generator Layers

- Terrain: domain-warped elevation + moisture
- Water: sea-level masking + rivers
- Settlements: deterministic suitability scoring + spacing
- Roads: regional graph (MST + loop edges) with curved routing
- Houses: procedural roadside footprints aligned to road tangents

Notes:

- Contours are optional styling; toggle with `4`.
- Moisture is an ecological scalar used by forests/settlements, not a direct water depth indicator.

## Pivot Plan

See `FEATURE_LIST.md` for:

- selected algorithms (terrain, villages, roads, buildings, forests, fields)
- deterministic chunking strategy for infinite worlds
- implementation phases and progress checklist

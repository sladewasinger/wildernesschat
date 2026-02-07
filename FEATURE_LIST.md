# Organic Village Generator Feature List

This document tracks the pivot from the current WFC prototype to an organic, non-grid village and countryside generator.

## Goals

- Deterministic generation from a single seed.
- Infinite streaming world via chunking.
- Organic (angled/curved) roads and building placement.
- Large water bodies, highways, villages, side streets, forests, and fields.
- Multiplayer-friendly: same seed and config must produce the same map.

## Recommended Algorithm Stack

### 1) Terrain and Water (base layer)

- Domain-warped fractal noise for elevation/moisture.
- Water mask from elevation threshold plus connected-component cleanup.
- River/stream routing via downhill flow tracing seeded from highland points.

Why: fast, deterministic, continuous across chunks, good for large organic landforms.

### 2) Settlement Prior (where villages should appear)

- Build a weighted suitability field from:
- Distance to water (prefer moderate distance, avoid deep water).
- Slope (flatter terrain favored).
- Distance from existing villages (enforce spacing).
- Access cost to regional roads.
- Sample village centers with weighted Poisson disk.

Why: this is effectively a configurable prior model that creates long rural stretches and clustered settlements without rigid grids.

### 3) Regional Road Network (highways/main roads)

- Create candidate graph from village centers (+ optional strategic waypoints).
- Use Delaunay triangulation edges as candidates.
- Keep a minimum spanning tree for guaranteed connectivity.
- Add sparse extra loop edges probabilistically for realism.
- Route each connection with weighted pathfinding (A* or fast marching) over terrain cost.
- Smooth polylines (Chaikin or cubic spline).

Why: produces believable, non-cardinal road skeletons with controllable connectivity.

### 4) Village Street Network (local roads)

- Grow local streets from village center using a directional guidance field.
- Use streamline growth rules (branch probability, min spacing, max curvature).
- Stop streets on collision, water, steep slopes, or max density.

Why: organic street patterns with coherent flow and configurable density.

### 5) Parcels and Building Placement

- Build road corridors from local road centerlines.
- Sample frontage points along corridors with jittered spacing.
- Spawn building footprints aligned to road tangent with setback rules.
- Reject footprints colliding with water/roads/other buildings.

Why: roads drive settlement shape; houses naturally align to curved streets.

### 6) Forests and Fields

- Forest suitability mask from moisture, slope, and distance from dense roads.
- Tree placement via Poisson disk in suitable areas.
- Fields generated as clipped Voronoi patches near village outskirts.
- Optional field orientation bias from nearest road tangent.

Why: readable land use zones and countryside variation around villages.

### 7) Chunking and Determinism

- Multi-scale generation:
- Macro cells decide biome, water basins, and village candidates.
- Meso cells own road graph segments.
- Render chunks sample from macro/meso results plus local decoration.
- Always generate with border margins and clip to chunk to remove seams.
- Seed all stages from `hash(seed, featureType, coordinates, id)`.

Why: stable, deterministic, seam-safe infinite world generation.

## Config-First Architecture

Use typed config objects with plain-language names and units:

- `WorldConfig`
- `TerrainConfig`
- `SettlementConfig`
- `RoadConfig`
- `BuildingConfig`
- `VegetationConfig`
- `FieldConfig`
- `ChunkConfig`

All generation modules should accept config and RNG explicitly (no hidden globals).

## Implementation Plan

### Phase 0: Pivot Cleanup

- [x] Mark WFC modules as legacy and stop treating them as target architecture.
- [x] Create new generator module layout (`src/gen/*`).
- [x] Keep renderer/camera loop, replace world source incrementally.

### Phase 1: Deterministic Core

- [x] Seed hashing utilities for per-feature deterministic RNG.
- [x] Config schema and defaults.
- [x] Debug overlay toggles (water/moisture/forest/contours/rivers).

### Phase 2: Terrain + Water

- [x] Elevation and moisture fields.
- [x] Coastline/lake masks.
- [x] River tracing (basic polyline pass; polygon extraction deferred).

### Phase 3: Settlements + Highways

- [x] Settlement suitability field.
- [x] Weighted Poisson-like village placement (deterministic jittered grid + local-maximum pruning).
- [x] Regional road graph generation and terrain-aware routing (MST + loops + curvature and water avoidance).

### Phase 4: Local Streets + Buildings

- [x] Village-local street growth (first-pass spoke/curved local roads).
- [x] Parcel frontage extraction (roadside parcel lots + debug view).
- [x] House footprint placement and orientation (parcel-based and road-aligned).

### Phase 5: Forests + Fields

- [ ] Forest clustering and tree instances.
- [ ] Agricultural patch generation near outskirts.
- [ ] Land-use blending rules.

### Phase 6: Infinite Streaming and Performance

- [ ] Superchunk cache with eviction.
- [ ] Chunk seam validation.
- [ ] Frame budget + generation throttling.

### Phase 7: Multiplayer Readiness

- [ ] Canonical seed/config handshake format.
- [ ] Determinism tests across environments.
- [ ] Stable IDs for roads/buildings/villages.

## Progress Checklist

- [x] Prototype canvas app exists.
- [x] Deterministic seeded generation pipeline exists (new generator + legacy WFC baseline).
- [x] Organic terrain/water generator implemented.
- [x] Village prior model implemented.
- [x] Regional highway generator implemented.
- [x] Local village street generator implemented (first pass).
- [x] Curved-road-aligned building placement implemented.
- [x] Parcel generator implemented (frontage-oriented lots).
- [ ] Forest and field generation implemented.
- [x] Full chunk streaming for new pipeline implemented.
- [ ] Multiplayer determinism test suite implemented.

## Open Design Decisions

- [ ] Visual style target: hand-drawn look vs crisp vector/cartographic.
- [ ] World scale: meters-per-pixel and village average radius.
- [ ] Water prevalence target (rare lakes vs many lakes/rivers).
- [ ] Settlement frequency target (distance between villages).
- [ ] Whether to support bridges/tunnels in first version.

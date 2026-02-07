# Organic Village Generator Feature List

This document tracks the pivot from the current WFC prototype to an organic, non-grid village and countryside generator.

## Goals

- Deterministic generation from a single seed.
- Infinite streaming world via chunking.
- Organic (angled/curved) roads and building placement.
- Large water bodies, highways, villages, side streets, forests, and fields.
- Multiplayer-friendly: same seed and config must produce the same map.
- Crisp cartographic style with bold outlines, readable symbols, and minimal sketch noise.

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
- [x] Minimal runtime telemetry HUD (seed/handshake/chunk/streaming stats).

### Phase 2: Terrain + Water

- [x] Elevation and moisture fields.
- [x] Coastline/lake masks.
- [x] River tracing (basic polyline pass; polygon extraction deferred).

### Phase 3: Settlements + Highways

- [x] Settlement suitability field.
- [x] Weighted Poisson-like village placement (deterministic jittered grid + local-maximum pruning).
- [x] Regional road graph generation and terrain-aware routing (MST + loops + curvature and water avoidance).

### Phase 4: Local Streets + Buildings

- [x] Village-local street growth (first-pass organic streets).
- [x] Village-local street growth refinement (axis-aligned village street bands + connector to regional roads).
- [x] Parcel frontage extraction (roadside parcel lots + debug view).
- [x] House footprint placement and orientation (parcel-based and road-aligned).

### Phase 5: Forests + Fields

- [x] Forest clustering and tree instances.
- [x] Agricultural patch generation near outskirts (first pass).
- [x] Land-use blending rules (first pass: forest/field pressure from roads + village influence bands).
- [x] Blend coefficient retune for stronger field readability and cleaner village clearings.

### Phase 6: Infinite Streaming and Performance

- [x] Superchunk cache with eviction.
- [x] Chunk seam validation (implemented; disabled by default for runtime performance).
- [x] Frame budget + generation throttling.

### Phase 7: Multiplayer Readiness

- [x] Canonical seed/config handshake format.
- [x] Determinism tests across environments.
- [x] Stable IDs for roads/buildings/villages.

### Phase 8: Visual Style Polish

- [x] River and road outline pass with stronger line weight hierarchy.
- [x] Village marker simplification (small cartographic marker instead of large influence circle).
- [x] Field visibility pass (opacity, linework, and palette improvements).
- [x] Tree symbol pass (top-down stylized canopies; no trunk rendering).
- [x] Dense forest mass rendering (merged canopy polygons with boundary trees).
- [x] Consistent sun-direction roof shading (light/dark roof faces with directional shadows).
- [ ] Optional sprite/icon atlas integration for premium tree/building silhouettes.

### Phase 9: Road/Water Coherence

- [x] Rivers widened relative to roads (target >= 2x major road width).
- [x] River tracing constraints to reduce self-looping.
- [x] Bridge generation for intentional road-water crossings.
- [x] Road-water crossing rules (bridge spans reserved during routing + rendered bridge decks).
- [x] River-water mouth blending pass to hide visible disconnected river caps.
- [x] Promote rivers and lakes into a unified rendered water polygon layer (single raster water pass from terrain + river channels).

### Phase 10: Runtime Performance Hardening

- [x] Conservative default generation budget and per-frame chunk build limits.
- [x] Seam validator default-off to avoid chunk-build stalls in normal play.
- [ ] Profiling pass for chunk build hotspots (terrain sampling vs settlement synthesis vs overlay draw).
- [x] Directional chunk prefetch based on movement vector.

### Phase 11: Settlement Layout Graph Refactor

- [x] Introduce deterministic `SettlementLayout` artifact as an intermediate generation output.
- [x] Add explicit road hierarchy metadata (`arterial`, `collector`, `lane`, `path`) on roads.
- [x] Refactor local streets to template-driven generation (`lakeside`, `crossroad`, `linear`).
- [x] Add first-class road graph metadata with bridge-node semantics.
- [x] Move parcel/house spawn density rules from road style class to road hierarchy class.
- [x] Switch local street synthesis to trunk-road-first village layouts.
- [x] Add deterministic branch growth constraints (intersection/overlap suppression and endpoint guards).
- [x] Apply hierarchy-specific road rendering language to improve arterial/collector/lane/path readability.

### Phase 12: Parallel V2 Sandbox (Stepwise Rebuild)

- [x] Create isolated `v2.html` + `src/v2/*` prototype track.
- [x] Implement terrain-only stage with elevation metadata (no water).
- [x] Implement anchor-house + long-trunk-road stage.
- [x] Implement iterative house growth stage off trunk roads.
- [x] Implement Y-branch + shortcut stage for organic local variation.
- [x] Add V2 centralized tuning constants for zoom/contour/sizing/clearance controls.
- [ ] Promote validated V2 systems into main pipeline incrementally.

## Progress Checklist

- [x] Prototype canvas app exists.
- [x] Deterministic seeded generation pipeline exists (new generator + legacy WFC baseline).
- [x] Organic terrain/water generator implemented.
- [x] Village prior model implemented.
- [x] Regional highway generator implemented.
- [x] Local village street generator implemented (first pass).
- [x] Local village street refinement implemented (main-road-oriented and reduced overlap).
- [x] Curved-road-aligned building placement implemented.
- [x] Parcel generator implemented (frontage-oriented lots).
- [x] Forest and field generation implemented (first pass).
- [x] Visual style pass started (bold outlines, stronger fields, stylized trees).
- [x] Full chunk streaming for new pipeline implemented.
- [x] Multiplayer determinism test suite implemented.
- [x] Bridge system implemented.
- [x] Directional chunk prefetch implemented.
- [x] Unified water polygon renderer implemented.
- [ ] Runtime hitching eliminated during chunk travel.
- [x] Settlement layout artifact + road hierarchy graph metadata implemented.
- [x] Trunk-road-first and constrained branch-growth local road generation implemented.
- [x] Parallel V2 staged-prototype sandbox implemented.

## Open Design Decisions

- [x] Visual style target: crisp cartographic with bold outlines and readable symbols (minimal sketch noise).
- [ ] World scale: meters-per-pixel and village average radius.
- [ ] Water prevalence target (rare lakes vs many lakes/rivers).
- [ ] Settlement frequency target (distance between villages).
- [ ] Whether first ship includes generated bridges or keeps strict no-crossing roads.
- [ ] Whether trees/buildings move to sprite assets or stay fully procedural.

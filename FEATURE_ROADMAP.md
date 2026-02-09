# Feature Roadmap

Last updated: 2026-02-09

## Goal
Ship a deterministic V3 terrain/water baseline with:
- Flat grass land (no elevation/noise variability).
- Seed-deterministic lakes and mostly uniform-width rivers.
- Rivers that always connect to large lakes.
- Crisp cartographic shoreline rendering using flat water tones and consistent contour strokes.

## Current State Snapshot
| Area | Status | Notes |
| --- | --- | --- |
| Deterministic seeding | Done | Seeded hashing is active in `src/river-field.ts` and `src/terrain-sampler.ts`. |
| Flat grass terrain | Done | `src/height-field.ts` now provides `heightAtPos(x, y)` and returns `0`; renderer uses flat grass color. |
| River width uniformity | Done | River links use a single target width with small deterministic jitter. |
| River-to-lake guaranteed connection | Done | Rivers are generated only as links between deterministic large lakes. |
| Water style (flat layered tones) | Done | Water rendering uses discrete blue tiers (no gradients or glow). |
| Shoreline inset highlight + dark shoreline outline | Done | Shoreline pass includes dark land-edge stroke and a clipped inset light stroke. |
| Pixi rendering migration | Done | Runtime rendering now uses PixiJS (`pixi.js`) graphics primitives. |

## Roadmap Phases

### Phase 1: Terrain Simplification
- [x] Remove terrain elevation/noise influence from land shading.
- [x] Set land to a single grass palette baseline (no contour-driven variation).
- [x] Disable/remove contour lines tied to land elevation for V3 baseline mode.
- Acceptance: same seed and different coordinates still render visually flat grass except water.

### Phase 2: Deterministic Lakes + Connected Rivers
- [x] Define and codify a "large lake" threshold (radius/area based).
- [x] Replace free-form river field with deterministic paths/channels anchored to large lakes.
- [x] Keep river width mostly uniform with limited, intentional local variation.
- [x] Enforce: every river segment traces to a large lake (directly or via river graph).
- Acceptance: sampling and pan tests show no orphan rivers for fixed seed.

### Phase 3: Cartographic Water Rendering Pass
- [x] Render water with flat, layered blue tones (discrete bands, no blur/glow).
- [x] Add thin, light, consistent-width inset contour entirely inside water polygons.
- [x] Keep bold dark shoreline/riverbank outline at land edge.
- [x] Ensure inner highlight width is constant across lakes and rivers.
- Acceptance: style matches spec at multiple zoom levels with crisp boundaries.

## Session Handoff Checklist
- [ ] Update this file before ending a session.
- [ ] Record exactly which files changed.
- [ ] Mark completed checklist items and add next concrete task.

## Session Log Template
Copy this block for each work session:

```md
### Session YYYY-MM-DD
- Completed:
- In progress:
- Blockers:
- Files changed:
- Next first task:
```

## Latest Session
### Session 2026-02-09
- Completed: migrated rendering to PixiJS; added deterministic large-lake generation; replaced free-form rivers with lake-to-lake deterministic links; kept flat-grass terrain baseline via `heightAtPos()` returning `0`; completed cartographic shoreline style with dark outer stroke + clipped inset light contour.
- In progress: tuning lake frequency, river density, and stroke thresholds for preferred map look.
- Blockers: none.
- Files changed: `package.json`, `package-lock.json`, `src/main.ts`, `src/app.ts`, `src/config.ts`, `src/types.ts`, `src/terrain-sampler.ts`, `src/terrain-renderer.ts`, `src/river-field.ts`, `src/height-field.ts`, `FEATURE_ROADMAP.md`.
- Next first task: tune hydrology config defaults with visual seed sweeps to match target river/lake prevalence.

## Quick Validation Commands
- `npm run dev`
- `npm run build`

# Repository Guidelines

## Project Structure & Module Organization
- Active app code is in `src/`.
- Archived code is in `archive/`. Ignore this folder unless user specifically asks you to search for something in here. Do not reference session_resume or any files in this folder.
- Entry point: `src/main.ts`.
- Runtime/controller: `src/app.ts`.
- Rendering and sampling: `src/terrain-renderer.ts`, `src/terrain-sampler.ts`, `src/height-field.ts`, `src/river-field.ts`.
- Shared helpers: `src/lib/*.ts`.
- Rendering stack: PixiJS (`pixi.js`) for scene/canvas drawing.
- Static entry pages: `index.html` (main), `v3.html` (alternate entry)
- Build output is generated in `dist/`.
- Historical snapshots live under `archive/pre_v3_reset_2026_02_09/`; treat this as reference material unless a task explicitly targets archive migration.

## Build, Test, and Development Commands
- `npm ci`: install exact dependencies from `package-lock.json`.
- `npm run dev`: start the Vite dev server on port `5173`.
- `npm run build`: run strict TypeScript checks (`tsc --noEmit`) and produce a production bundle.
- `npm run preview`: serve the built `dist/` output locally.
- Example manual run: `http://localhost:5173/?seed=v3-seed-001&zoom=1.35`.

## Coding Style & Naming Conventions
- Language: TypeScript (ES modules, strict mode).
- Indentation: 2 spaces; include semicolons.
- Prefer small, focused modules and explicit dependencies over hidden globals.
- Naming: `PascalCase` for classes/types (for example, `V3App`, `TerrainSample`), `camelCase` for variables/functions, and `kebab-case` for filenames (for example, `terrain-renderer.ts`).
- Keep generation and rendering deterministic for a fixed seed.

## Testing Guidelines
- There is no dedicated test runner configured yet.
- Treat `npm run build` as the required validation gate before opening a PR.
- For behavior changes, do manual checks in `npm run dev`: movement keys, zoom behavior, HUD stats, and seed reproducibility.
- If you add tests, place them near related modules (for example, `src/lib/math.test.ts`) and document the run command in `package.json`.

## Commit & Pull Request Guidelines
- Current history uses short, informal summaries; keep commit subjects brief, specific, and action-oriented.
- Prefer one logical change per commit.
- PRs should include: what changed and why, manual verification steps/commands used, screenshots or short recordings for visual/rendering changes, and links to related issues/tasks when available.

import "./styles.css";
import { Game } from "./game";
import { defaultWorldConfig } from "./gen/config";
import { runDeterminismSuite } from "./gen/determinism-suite";
import { World } from "./world/world";

const run = (): void => {
  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  const hud = document.querySelector<HTMLElement>("#hud");
  if (!canvas || !hud) throw new Error("Missing #game canvas or #hud element.");

  const params = new URLSearchParams(window.location.search);
  const seed = params.get("seed") ?? "12345abcde";
  const chunkSize = Number(params.get("chunkSize") ?? "320");
  const seaLevel = Number(params.get("seaLevel") ?? "NaN");
  const sampleStep = Number(params.get("sampleStep") ?? "2");
  const superchunkSpan = Number(params.get("superchunkSpan") ?? "NaN");
  const genBudgetMs = Number(params.get("genBudgetMs") ?? "NaN");
  const maxChunkBuilds = Number(params.get("maxChunkBuilds") ?? "NaN");
  const seamValidation = params.get("seamValidation");
  const determinism = params.get("determinism");
  const determinismRuns = Number(params.get("determinismRuns") ?? "3");

  const config = defaultWorldConfig(seed);
  if (Number.isFinite(chunkSize) && chunkSize >= 180 && chunkSize <= 640) {
    config.chunk.pixelSize = chunkSize;
  }
  if (Number.isFinite(seaLevel) && seaLevel >= 0.3 && seaLevel <= 0.68) {
    config.terrain.seaLevel = seaLevel;
  }
  if (Number.isFinite(sampleStep) && sampleStep >= 1 && sampleStep <= 8) {
    config.chunk.sampleStep = Math.floor(sampleStep);
  }
  if (Number.isFinite(superchunkSpan) && superchunkSpan >= 1 && superchunkSpan <= 8) {
    config.chunk.superchunkSpanChunks = Math.floor(superchunkSpan);
  }
  if (Number.isFinite(genBudgetMs) && genBudgetMs >= 0.5 && genBudgetMs <= 24) {
    config.chunk.generationBudgetMs = genBudgetMs;
  }
  if (Number.isFinite(maxChunkBuilds) && maxChunkBuilds >= 1 && maxChunkBuilds <= 8) {
    config.chunk.maxChunkBuildsPerFrame = Math.floor(maxChunkBuilds);
  }
  if (seamValidation === "0" || seamValidation === "false") {
    config.chunk.enableSeamValidation = false;
  } else if (seamValidation === "1" || seamValidation === "true") {
    config.chunk.enableSeamValidation = true;
  }

  const world = new World(config);
  if (determinism === "1" || determinism === "true") {
    const result = runDeterminismSuite(config, Number.isFinite(determinismRuns) ? determinismRuns : 3);
    console.info("Determinism suite result", result);
  }
  const game = new Game(canvas, hud, world);
  game.start();
};

try {
  run();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#fff;padding:16px">${message}</pre>`;
}

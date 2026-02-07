import "./styles.css";
import { Game } from "./game";
import { defaultWorldConfig } from "./gen/config";
import { World } from "./world/world";

const run = (): void => {
  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  const hud = document.querySelector<HTMLElement>("#hud");
  if (!canvas || !hud) throw new Error("Missing #game canvas or #hud element.");

  const params = new URLSearchParams(window.location.search);
  const seed = params.get("seed") ?? "watabou-like-prototype";
  const chunkSize = Number(params.get("chunkSize") ?? "320");
  const seaLevel = Number(params.get("seaLevel") ?? "NaN");

  const config = defaultWorldConfig(seed);
  if (Number.isFinite(chunkSize) && chunkSize >= 180 && chunkSize <= 640) {
    config.chunk.pixelSize = chunkSize;
  }
  if (Number.isFinite(seaLevel) && seaLevel >= 0.3 && seaLevel <= 0.68) {
    config.terrain.seaLevel = seaLevel;
  }

  const world = new World(config);
  const game = new Game(canvas, hud, world);
  game.start();
};

try {
  run();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#fff;padding:16px">${message}</pre>`;
}

import "./styles.css";
import { V2App } from "./app";

const run = (): void => {
  const canvas = document.querySelector<HTMLCanvasElement>("#v2-canvas");
  const hud = document.querySelector<HTMLElement>("#v2-hud");
  if (!canvas || !hud) {
    throw new Error("Missing #v2-canvas or #v2-hud.");
  }

  const params = new URLSearchParams(window.location.search);
  const seed = params.get("seed") ?? "v2-seed-001";
  const stage = Number(params.get("stage") ?? "2");
  const app = new V2App(canvas, hud, seed, Number.isFinite(stage) ? stage : 2);
  app.start();
};

try {
  run();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#fff;padding:16px">${message}</pre>`;
}

import "./styles.css";
import { V3App } from "./app";
import { V3_VIEW_CONFIG } from "./config";

const run = (): void => {
  const canvas = document.querySelector<HTMLCanvasElement>("#v3-canvas");
  const hud = document.querySelector<HTMLElement>("#v3-hud");
  if (!canvas || !hud) {
    throw new Error("Missing #v3-canvas or #v3-hud.");
  }

  const params = new URLSearchParams(window.location.search);
  const seed = params.get("seed") ?? "v3-seed-001";
  const zoomParam = Number(params.get("zoom") ?? String(V3_VIEW_CONFIG.defaultZoom));
  const zoom = Number.isFinite(zoomParam) ? zoomParam : V3_VIEW_CONFIG.defaultZoom;
  const app = new V3App(canvas, hud, seed, zoom);
  app.start();
};

try {
  run();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#fff;padding:16px">${message}</pre>`;
}

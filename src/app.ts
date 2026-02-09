import { Application, Container, Graphics } from "pixi.js";
import { clamp, floorDiv } from "./lib/math";
import { V3_VIEW_CONFIG } from "./config";
import { Point, TerrainRenderStats } from "./types";
import { V3TerrainRenderer } from "./terrain-renderer";
import { V3TerrainSampler } from "./terrain-sampler";

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

export class V3App {
  private readonly canvas: HTMLCanvasElement;
  private readonly hud: HTMLElement;
  private readonly seed: string;
  private readonly terrainSampler: V3TerrainSampler;
  private readonly input: InputState = { up: false, down: false, left: false, right: false };
  private readonly pixiApp: Application;
  private readonly worldContainer: Container;
  private readonly terrainRenderer: V3TerrainRenderer;
  private readonly playerMarker: Graphics;

  private playerX = 0;
  private playerY = 0;
  private lastTime = 0;
  private zoom: number;
  private pointerInsideCanvas = false;
  private mouseCanvasX = 0;
  private mouseCanvasY = 0;

  private constructor(
    canvas: HTMLCanvasElement,
    hud: HTMLElement,
    seed: string,
    initialZoom: number,
    pixiApp: Application
  ) {
    this.canvas = canvas;
    this.hud = hud;
    this.seed = seed;
    this.zoom = clamp(initialZoom, V3_VIEW_CONFIG.minZoom, V3_VIEW_CONFIG.maxZoom);
    this.terrainSampler = new V3TerrainSampler(seed);
    this.pixiApp = pixiApp;
    this.worldContainer = new Container();
    this.pixiApp.stage.addChild(this.worldContainer);
    this.terrainRenderer = new V3TerrainRenderer(this.pixiApp.renderer, this.worldContainer, this.terrainSampler, seed);
    this.playerMarker = new Graphics();
    this.pixiApp.stage.addChild(this.playerMarker);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);
  }

  static async create(
    canvas: HTMLCanvasElement,
    hud: HTMLElement,
    seed: string,
    initialZoom: number
  ): Promise<V3App> {
    const pixiApp = new Application();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    await pixiApp.init({
      canvas,
      resizeTo: window,
      backgroundColor: 0x0a1218,
      antialias: true,
      roundPixels: false,
      resolution: dpr,
      autoDensity: true
    });
    return new V3App(canvas, hud, seed, initialZoom, pixiApp);
  }

  start(): void {
    requestAnimationFrame(this.tick);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "w" || event.key === "ArrowUp") this.input.up = true;
    if (event.key === "s" || event.key === "ArrowDown") this.input.down = true;
    if (event.key === "a" || event.key === "ArrowLeft") this.input.left = true;
    if (event.key === "d" || event.key === "ArrowRight") this.input.right = true;

    if (event.key === "=" || event.key === "+") {
      this.zoom = clamp(this.zoom * V3_VIEW_CONFIG.keyZoomStep, V3_VIEW_CONFIG.minZoom, V3_VIEW_CONFIG.maxZoom);
    }
    if (event.key === "-" || event.key === "_") {
      this.zoom = clamp(this.zoom / V3_VIEW_CONFIG.keyZoomStep, V3_VIEW_CONFIG.minZoom, V3_VIEW_CONFIG.maxZoom);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "w" || event.key === "ArrowUp") this.input.up = false;
    if (event.key === "s" || event.key === "ArrowDown") this.input.down = false;
    if (event.key === "a" || event.key === "ArrowLeft") this.input.left = false;
    if (event.key === "d" || event.key === "ArrowRight") this.input.right = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.deltaY < 0) {
      this.zoom = clamp(this.zoom * V3_VIEW_CONFIG.wheelZoomStep, V3_VIEW_CONFIG.minZoom, V3_VIEW_CONFIG.maxZoom);
    } else if (event.deltaY > 0) {
      this.zoom = clamp(this.zoom / V3_VIEW_CONFIG.wheelZoomStep, V3_VIEW_CONFIG.minZoom, V3_VIEW_CONFIG.maxZoom);
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
      this.pointerInsideCanvas = false;
      return;
    }
    const sx = rect.width <= 1e-6 ? 1 : this.canvas.width / rect.width;
    const sy = rect.height <= 1e-6 ? 1 : this.canvas.height / rect.height;
    this.pointerInsideCanvas = true;
    this.mouseCanvasX = localX * sx;
    this.mouseCanvasY = localY * sy;
  };

  private readonly onMouseLeave = (): void => {
    this.pointerInsideCanvas = false;
  };

  private readonly tick = (time: number): void => {
    const dt = this.lastTime === 0 ? 0 : Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    let moveX = 0;
    let moveY = 0;
    if (this.input.left) moveX -= 1;
    if (this.input.right) moveX += 1;
    if (this.input.up) moveY -= 1;
    if (this.input.down) moveY += 1;

    if (moveX !== 0 || moveY !== 0) {
      const len = Math.hypot(moveX, moveY);
      moveX /= len;
      moveY /= len;
    }

    this.playerX += moveX * V3_VIEW_CONFIG.moveSpeed * dt;
    this.playerY += moveY * V3_VIEW_CONFIG.moveSpeed * dt;
  }

  private render(): void {
    const width = this.pixiApp.renderer.width;
    const height = this.pixiApp.renderer.height;
    const viewWidth = width / this.zoom;
    const viewHeight = height / this.zoom;
    const viewMinX = this.playerX - viewWidth * 0.5;
    const viewMinY = this.playerY - viewHeight * 0.5;
    const stats = this.terrainRenderer.draw(width, height, viewMinX, viewMinY, this.zoom);
    this.worldContainer.scale.set(this.zoom, this.zoom);
    this.worldContainer.position.set(width * 0.5 - this.playerX * this.zoom, height * 0.5 - this.playerY * this.zoom);

    const centerX = width * 0.5;
    const centerY = height * 0.5;
    this.drawPlayerMarker(centerX, centerY);
    this.updateHud(stats);
  }

  private drawPlayerMarker(screenX: number, screenY: number): void {
    this.playerMarker.clear();
    this.playerMarker
      .circle(screenX, screenY, 5)
      .fill({ color: 0xf4ebcd })
      .stroke({ color: 0x15202a, width: 2 });
  }

  private updateHud(stats: TerrainRenderStats): void {
    const hover = this.pointerInsideCanvas ? this.screenToWorld(this.mouseCanvasX, this.mouseCanvasY) : null;
    const hoverSample = hover ? this.terrainSampler.sampleAt(hover.x, hover.y) : null;
    this.hud.textContent = [
      "Village Generator V3 Sandbox",
      "Mode: Flat Grass + Lakes + Connected Rivers (Pixi)",
      "Move: WASD / Arrows",
      "Zoom: +/- keys or mouse wheel",
      `Seed: ${this.seed}`,
      `LOD: ${stats.lod} chunks=${stats.activeChunks}`,
      `Zoom: ${this.zoom.toFixed(2)}x`,
      `Player px: ${this.playerX.toFixed(1)}, ${this.playerY.toFixed(1)}`,
      `Chunk-ish: ${floorDiv(this.playerX, 320)}, ${floorDiv(this.playerY, 320)}`,
      `Render step: ${stats.worldStep.toFixed(1)} world units`,
      `Rendered cells: ${stats.cellsDrawn}`,
      `Water cells: lake=${stats.lakeCells} river=${stats.riverCells}`,
      `Cached terrain samples: ${this.terrainSampler.cachedSamples()}`,
      hover && hoverSample
        ? `Hover: x=${hover.x.toFixed(1)} y=${hover.y.toFixed(1)} h=${hoverSample.height.toFixed(1)} feature=${hoverSample.kind} lake=${hoverSample.lakeMask.toFixed(3)} river=${hoverSample.riverMask.toFixed(3)}`
        : "Hover: (move cursor over canvas)"
    ].join("\n");
  }

  private screenToWorld(canvasX: number, canvasY: number): Point {
    const viewWidth = this.canvas.width / this.zoom;
    const viewHeight = this.canvas.height / this.zoom;
    const viewMinX = this.playerX - viewWidth * 0.5;
    const viewMinY = this.playerY - viewHeight * 0.5;
    return {
      x: viewMinX + canvasX / this.zoom,
      y: viewMinY + canvasY / this.zoom
    };
  }
}

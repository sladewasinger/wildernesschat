import { clamp, floorDiv } from "../util/math";
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
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: HTMLElement;
  private readonly seed: string;
  private readonly terrainSampler: V3TerrainSampler;
  private readonly terrainRenderer: V3TerrainRenderer;
  private readonly input: InputState = { up: false, down: false, left: false, right: false };

  private playerX = 0;
  private playerY = 0;
  private lastTime = 0;
  private zoom: number;
  private pointerInsideCanvas = false;
  private mouseCanvasX = 0;
  private mouseCanvasY = 0;

  constructor(canvas: HTMLCanvasElement, hud: HTMLElement, seed: string, initialZoom: number) {
    this.canvas = canvas;
    this.hud = hud;
    this.seed = seed;
    this.zoom = clamp(initialZoom, V3_VIEW_CONFIG.minZoom, V3_VIEW_CONFIG.maxZoom);
    this.terrainSampler = new V3TerrainSampler(seed);
    this.terrainRenderer = new V3TerrainRenderer(this.terrainSampler);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable.");
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);
    this.resize();
  }

  start(): void {
    requestAnimationFrame(this.tick);
  }

  private readonly resize = (): void => {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  };

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
    const width = this.canvas.width;
    const height = this.canvas.height;
    const viewWidth = width / this.zoom;
    const viewHeight = height / this.zoom;
    const viewMinX = this.playerX - viewWidth * 0.5;
    const viewMinY = this.playerY - viewHeight * 0.5;
    const stats = this.terrainRenderer.draw(this.ctx, width, height, viewMinX, viewMinY, this.zoom);

    const centerX = width * 0.5;
    const centerY = height * 0.5;
    this.drawPlayerMarker(centerX, centerY);
    this.updateHud(stats);
  }

  private drawPlayerMarker(screenX: number, screenY: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#f4ebcd";
    ctx.beginPath();
    ctx.arc(screenX, screenY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#15202a";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private updateHud(stats: TerrainRenderStats): void {
    const hover = this.pointerInsideCanvas ? this.screenToWorld(this.mouseCanvasX, this.mouseCanvasY) : null;
    const hoverSample = hover ? this.terrainSampler.sampleAt(hover.x, hover.y) : null;
    this.hud.textContent = [
      "Village Generator V3 Sandbox",
      "Mode: Terrain + Water (lakes + rivers)",
      "Move: WASD / Arrows",
      "Zoom: +/- keys or mouse wheel",
      `Seed: ${this.seed}`,
      `Zoom: ${this.zoom.toFixed(2)}x`,
      `Player px: ${this.playerX.toFixed(1)}, ${this.playerY.toFixed(1)}`,
      `Chunk-ish: ${floorDiv(this.playerX, 320)}, ${floorDiv(this.playerY, 320)}`,
      `Render step: ${stats.worldStep.toFixed(1)} world units`,
      `Rendered cells: ${stats.cellsDrawn}`,
      `Water cells: lake=${stats.lakeCells} river=${stats.riverCells}`,
      `Cached terrain samples: ${this.terrainSampler.cachedSamples()}`,
      hover && hoverSample
        ? `Hover: x=${hover.x.toFixed(1)} y=${hover.y.toFixed(1)} water=${hoverSample.kind} lake=${hoverSample.lakeMask.toFixed(3)} river=${hoverSample.riverMask.toFixed(3)}`
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

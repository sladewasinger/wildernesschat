import { clamp, floorDiv, lerp } from "../util/math";
import { V2SettlementGenerator } from "./generator";
import { V2TerrainSampler } from "./terrain";
import { V2_RENDER_CONFIG, V2_SETTLEMENT_CONFIG, V2_STAGE_MAX, V2_STAGE_MIN, V2_VIEW_CONFIG } from "./config";
import { House, Point, RoadSegment } from "./types";

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

const STAGE_LABELS = [
  "0 Terrain Only",
  "1 Anchor House + Trunk",
  "2 Iterative House Growth",
  "3 Y-Branches + Shortcuts"
];

export class V2App {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: HTMLElement;
  private readonly terrain: V2TerrainSampler;
  private readonly generator: V2SettlementGenerator;
  private readonly seed: string;
  private readonly input: InputState = { up: false, down: false, left: false, right: false };

  private playerX = 0;
  private playerY = 0;
  private lastTime = 0;
  private stage: number = 2;
  private zoom: number = V2_VIEW_CONFIG.defaultZoom;

  constructor(canvas: HTMLCanvasElement, hud: HTMLElement, seed: string, initialStage: number, initialZoom: number) {
    this.canvas = canvas;
    this.hud = hud;
    this.seed = seed;
    this.terrain = new V2TerrainSampler(seed);
    this.generator = new V2SettlementGenerator(seed, this.terrain);
    this.stage = clamp(initialStage | 0, V2_STAGE_MIN, V2_STAGE_MAX);
    this.zoom = clamp(initialZoom, V2_VIEW_CONFIG.minZoom, V2_VIEW_CONFIG.maxZoom);

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

    if (event.key === "1") this.stage = 0;
    if (event.key === "2") this.stage = 1;
    if (event.key === "3") this.stage = 2;
    if (event.key === "4") this.stage = 3;
    if (event.key === "]") this.stage = clamp(this.stage + 1, V2_STAGE_MIN, V2_STAGE_MAX);
    if (event.key === "[") this.stage = clamp(this.stage - 1, V2_STAGE_MIN, V2_STAGE_MAX);
    if (event.key === "=" || event.key === "+") {
      this.zoom = clamp(this.zoom * V2_VIEW_CONFIG.keyZoomStep, V2_VIEW_CONFIG.minZoom, V2_VIEW_CONFIG.maxZoom);
    }
    if (event.key === "-" || event.key === "_") {
      this.zoom = clamp(this.zoom / V2_VIEW_CONFIG.keyZoomStep, V2_VIEW_CONFIG.minZoom, V2_VIEW_CONFIG.maxZoom);
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
      this.zoom = clamp(this.zoom * V2_VIEW_CONFIG.wheelZoomStep, V2_VIEW_CONFIG.minZoom, V2_VIEW_CONFIG.maxZoom);
    } else if (event.deltaY > 0) {
      this.zoom = clamp(this.zoom / V2_VIEW_CONFIG.wheelZoomStep, V2_VIEW_CONFIG.minZoom, V2_VIEW_CONFIG.maxZoom);
    }
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
      const length = Math.hypot(moveX, moveY);
      moveX /= length;
      moveY /= length;
    }

    const speed = 210;
    this.playerX += moveX * speed * dt;
    this.playerY += moveY * speed * dt;
  }

  private render(): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const viewWidth = width / this.zoom;
    const viewHeight = height / this.zoom;
    const viewMinX = this.playerX - viewWidth * 0.5;
    const viewMinY = this.playerY - viewHeight * 0.5;

    this.drawTerrain(ctx, width, height, viewMinX, viewMinY);

    const margin = 360;
    const minX = this.playerX - viewWidth * 0.5 - margin;
    const maxX = this.playerX + viewWidth * 0.5 + margin;
    const minY = this.playerY - viewHeight * 0.5 - margin;
    const maxY = this.playerY + viewHeight * 0.5 + margin;
    const sites = this.generator.collectSitesInBounds(minX, maxX, minY, maxY);

    for (const site of sites) {
      const plan = this.generator.buildVillagePlan(site, this.stage);
      this.drawRoads(plan.roads, viewMinX, viewMinY);
      this.drawHouses(plan.houses, viewMinX, viewMinY);
    }

    ctx.fillStyle = "#efe5c8";
    ctx.beginPath();
    ctx.arc(halfW, halfH, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1b2229";
    ctx.lineWidth = 2;
    ctx.stroke();

    const terrain = this.terrain.elevationAt(this.playerX, this.playerY);
    const slope = this.terrain.slopeAt(this.playerX, this.playerY);
    this.hud.textContent = [
      "Village Generator V2 Sandbox",
      "Move: WASD / Arrows",
      "Stage: 1-4 keys (or [ / ])",
      "Zoom: +/- keys or mouse wheel",
      `Current: ${STAGE_LABELS[this.stage]}`,
      `Seed: ${this.seed}`,
      `Zoom: ${this.zoom.toFixed(2)}x`,
      `Player px: ${this.playerX.toFixed(1)}, ${this.playerY.toFixed(1)}`,
      `Chunk-ish: ${floorDiv(this.playerX, 320)}, ${floorDiv(this.playerY, 320)}`,
      `Terrain: elev=${terrain.toFixed(3)} slope=${slope.toFixed(3)}`,
      `Contour grid: ${V2_VIEW_CONFIG.terrainWorldStep} world units`,
      `Visible sites: ${sites.length}`
    ].join("\n");
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, width: number, height: number, viewMinX: number, viewMinY: number): void {
    const worldStep = V2_VIEW_CONFIG.terrainWorldStep;
    const viewMaxX = viewMinX + width / this.zoom;
    const viewMaxY = viewMinY + height / this.zoom;
    const startWX = Math.floor(viewMinX / worldStep) * worldStep;
    const startWY = Math.floor(viewMinY / worldStep) * worldStep;

    for (let wy = startWY; wy <= viewMaxY + worldStep; wy += worldStep) {
      for (let wx = startWX; wx <= viewMaxX + worldStep; wx += worldStep) {
        const elevation = this.terrain.elevationAt(wx, wy);
        const contour = Math.abs((elevation * 22) % 1 - 0.5);

        let r = lerp(177, 124, elevation);
        let g = lerp(207, 161, elevation);
        let b = lerp(155, 112, elevation);
        if (contour < 0.055) {
          r -= 17;
          g -= 14;
          b -= 11;
        }

        ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        const sx = Math.floor((wx - viewMinX) * this.zoom);
        const sy = Math.floor((wy - viewMinY) * this.zoom);
        const size = Math.ceil(worldStep * this.zoom) + 1;
        ctx.fillRect(sx, sy, size, size);
      }
    }
  }

  private drawRoads(roads: RoadSegment[], viewMinX: number, viewMinY: number): void {
    const path = new Path2D();
    for (const road of roads) {
      if (road.points.length < 2) {
        continue;
      }
      for (let i = 0; i < road.points.length; i += 1) {
        const p = road.points[i];
        const x = (p.x - viewMinX) * this.zoom;
        const y = (p.y - viewMinY) * this.zoom;
        if (i === 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      }
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = V2_RENDER_CONFIG.roadOutlineColor;
    ctx.lineWidth = (V2_SETTLEMENT_CONFIG.roadWidth + V2_RENDER_CONFIG.roadOutlinePad) * this.zoom;
    ctx.stroke(path);
    ctx.strokeStyle = V2_RENDER_CONFIG.roadFillColor;
    ctx.lineWidth = V2_SETTLEMENT_CONFIG.roadWidth * this.zoom;
    ctx.stroke(path);
    ctx.restore();
  }

  private drawHouses(houses: House[], viewMinX: number, viewMinY: number): void {
    for (const house of houses) {
      this.drawHouse(house, viewMinX, viewMinY);
    }
  }

  private drawHouse(house: House, viewMinX: number, viewMinY: number): void {
    const x = (house.x - viewMinX) * this.zoom;
    const y = (house.y - viewMinY) * this.zoom;
    const angle = house.angle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = house.width * 0.5 * this.zoom;
    const hd = house.depth * 0.5 * this.zoom;

    const corners = [
      this.rotatePoint(-hw, -hd, cos, sin, x, y),
      this.rotatePoint(hw, -hd, cos, sin, x, y),
      this.rotatePoint(hw, hd, cos, sin, x, y),
      this.rotatePoint(-hw, hd, cos, sin, x, y)
    ];
    const topHalf = [
      this.rotatePoint(-hw, -hd, cos, sin, x, y),
      this.rotatePoint(hw, -hd, cos, sin, x, y),
      this.rotatePoint(hw, 0, cos, sin, x, y),
      this.rotatePoint(-hw, 0, cos, sin, x, y)
    ];
    const bottomHalf = [
      this.rotatePoint(-hw, 0, cos, sin, x, y),
      this.rotatePoint(hw, 0, cos, sin, x, y),
      this.rotatePoint(hw, hd, cos, sin, x, y),
      this.rotatePoint(-hw, hd, cos, sin, x, y)
    ];

    const sun = { x: -0.68, y: -0.74 };
    const localSunY = -sun.x * sin + sun.y * cos;
    const topIsLight = localSunY < 0;
    const roofLight = this.roofColor(house.tone, true);
    const roofDark = this.roofColor(house.tone, false);

    const ctx = this.ctx;
    ctx.fillStyle = "rgba(24, 32, 38, 0.35)";
    this.fillPolygon(
      corners.map((corner) => ({
        x: corner.x + 4 * this.zoom,
        y: corner.y + 4 * this.zoom
      }))
    );

    this.fillPolygon(corners, topIsLight ? roofDark : roofLight);
    this.fillPolygon(topHalf, topIsLight ? roofLight : roofDark);
    this.fillPolygon(bottomHalf, topIsLight ? roofDark : roofLight);
    this.strokePolygon(corners, "rgba(11, 15, 16, 0.94)", Math.max(1.3, 2 * this.zoom));
  }

  private roofColor(tone: number, light: boolean): string {
    const baseR = lerp(164, 190, tone);
    const baseG = lerp(136, 167, tone);
    const baseB = lerp(114, 142, tone);
    const delta = light ? 14 : -20;
    return `rgb(${Math.round(baseR + delta)}, ${Math.round(baseG + delta)}, ${Math.round(baseB + delta)})`;
  }

  private fillPolygon(points: Point[], fill?: string): void {
    if (points.length < 3) {
      return;
    }
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
    }
    ctx.fill();
  }

  private strokePolygon(points: Point[], stroke: string, width: number): void {
    if (points.length < 2) {
      return;
    }
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  private rotatePoint(px: number, py: number, cos: number, sin: number, tx: number, ty: number): Point {
    return {
      x: tx + px * cos - py * sin,
      y: ty + px * sin + py * cos
    };
  }
}

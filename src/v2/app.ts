import { clamp, floorDiv, lerp } from "../util/math";
import { V2SettlementGenerator } from "./generator";
import { V2TerrainSampler } from "./terrain";
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
  private stage = 2;

  constructor(canvas: HTMLCanvasElement, hud: HTMLElement, seed: string, initialStage: number) {
    this.canvas = canvas;
    this.hud = hud;
    this.seed = seed;
    this.terrain = new V2TerrainSampler(seed);
    this.generator = new V2SettlementGenerator(seed, this.terrain);
    this.stage = clamp(initialStage | 0, 0, 3);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable.");
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
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
    if (event.key === "]") this.stage = clamp(this.stage + 1, 0, 3);
    if (event.key === "[") this.stage = clamp(this.stage - 1, 0, 3);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "w" || event.key === "ArrowUp") this.input.up = false;
    if (event.key === "s" || event.key === "ArrowDown") this.input.down = false;
    if (event.key === "a" || event.key === "ArrowLeft") this.input.left = false;
    if (event.key === "d" || event.key === "ArrowRight") this.input.right = false;
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

    this.drawTerrain(ctx, width, height, halfW, halfH);

    const margin = 360;
    const minX = this.playerX - halfW - margin;
    const maxX = this.playerX + halfW + margin;
    const minY = this.playerY - halfH - margin;
    const maxY = this.playerY + halfH + margin;
    const sites = this.generator.collectSitesInBounds(minX, maxX, minY, maxY);

    for (const site of sites) {
      const plan = this.generator.buildVillagePlan(site, this.stage);
      this.drawRoads(plan.roads, halfW, halfH);
      this.drawHouses(plan.houses, halfW, halfH);
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
      `Current: ${STAGE_LABELS[this.stage]}`,
      `Seed: ${this.seed}`,
      `Player px: ${this.playerX.toFixed(1)}, ${this.playerY.toFixed(1)}`,
      `Chunk-ish: ${floorDiv(this.playerX, 320)}, ${floorDiv(this.playerY, 320)}`,
      `Terrain: elev=${terrain.toFixed(3)} slope=${slope.toFixed(3)}`,
      `Visible sites: ${sites.length}`
    ].join("\n");
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, width: number, height: number, halfW: number, halfH: number): void {
    const step = 6;
    for (let sy = 0; sy < height; sy += step) {
      for (let sx = 0; sx < width; sx += step) {
        const wx = this.playerX + (sx - halfW);
        const wy = this.playerY + (sy - halfH);
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
        ctx.fillRect(sx, sy, step + 1, step + 1);
      }
    }
  }

  private drawRoads(roads: RoadSegment[], halfW: number, halfH: number): void {
    const ordered = roads.slice().sort((a, b) => this.roadPriority(a.className) - this.roadPriority(b.className));
    for (const road of ordered) {
      this.drawRoad(road, halfW, halfH);
    }
  }

  private drawRoad(road: RoadSegment, halfW: number, halfH: number): void {
    const path = new Path2D();
    for (let i = 0; i < road.points.length; i += 1) {
      const p = road.points[i];
      const x = p.x - this.playerX + halfW;
      const y = p.y - this.playerY + halfH;
      if (i === 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }

    const outlinePad =
      road.className === "trunk"
        ? 3.3
        : road.className === "branch"
          ? 2.6
          : road.className === "shortcut"
            ? 2.2
            : 1.6;
    const fill =
      road.className === "trunk"
        ? "rgba(219, 204, 156, 0.985)"
        : road.className === "branch"
          ? "rgba(211, 198, 159, 0.97)"
          : road.className === "shortcut"
            ? "rgba(201, 191, 157, 0.95)"
            : "rgba(214, 206, 180, 0.95)";

    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(8, 10, 11, 0.9)";
    ctx.lineWidth = road.width + outlinePad;
    ctx.stroke(path);
    ctx.strokeStyle = fill;
    ctx.lineWidth = road.width;
    ctx.stroke(path);
    ctx.restore();
  }

  private drawHouses(houses: House[], halfW: number, halfH: number): void {
    for (const house of houses) {
      this.drawHouse(house, halfW, halfH);
    }
  }

  private drawHouse(house: House, halfW: number, halfH: number): void {
    const x = house.x - this.playerX + halfW;
    const y = house.y - this.playerY + halfH;
    const angle = house.angle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = house.width * 0.5;
    const hd = house.depth * 0.5;

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
        x: corner.x + 4,
        y: corner.y + 4
      }))
    );

    this.fillPolygon(corners, topIsLight ? roofDark : roofLight);
    this.fillPolygon(topHalf, topIsLight ? roofLight : roofDark);
    this.fillPolygon(bottomHalf, topIsLight ? roofDark : roofLight);
    this.strokePolygon(corners, "rgba(11, 15, 16, 0.94)", 2);
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

  private roadPriority(className: RoadSegment["className"]): number {
    if (className === "trunk") return 1;
    if (className === "branch") return 2;
    if (className === "shortcut") return 3;
    return 4;
  }
}

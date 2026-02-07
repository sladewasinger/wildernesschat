import { clamp, floorDiv, lerp } from "../util/math";
import { V2SettlementGenerator } from "./generator";
import {
  createManualBridgeRoadBetweenAttachments,
  createManualHouseAt,
  createManualRoadBetweenHouses,
  createManualRoadToAttachment,
  findBridgeAttachmentForHouse,
  findRoadAttachmentCandidatesForHouse,
  findClosestRoadAttachmentForHouse
} from "./generator/manual-placement";
import { V2TerrainSampler } from "./terrain";
import { V2_RENDER_CONFIG, V2_SETTLEMENT_CONFIG, V2_STAGE_MAX, V2_STAGE_MIN, V2_VIEW_CONFIG } from "./config";
import { House, Point, RoadSegment } from "./types";

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

type ManualConnectionMode = "none" | "seed-road" | "attach-road" | "bridge-road";

type ManualPreview = {
  house: House | null;
  road: RoadSegment | null;
  secondaryRoad: RoadSegment | null;
  mode: ManualConnectionMode;
  attachPoint: Point | null;
  secondaryAttachPoint: Point | null;
  searchRadius: number;
};

const STAGE_LABELS = [
  "0 Terrain Only",
  "1 Anchor House",
  "2 House Cluster + Paths",
  "3 Expanded Cluster + Loops",
  "4 Road-First Continuity"
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
  private currentTerrainWorldStep: number = V2_VIEW_CONFIG.terrainWorldStep;
  private manualPlacementMode = true;
  private readonly manualHouses: House[] = [];
  private readonly manualRoads: RoadSegment[] = [];
  private pointerInsideCanvas = false;
  private mouseCanvasX = 0;
  private mouseCanvasY = 0;

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
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
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
    if (event.key === "5") this.stage = 4;
    if (event.key === "]") this.stage = clamp(this.stage + 1, V2_STAGE_MIN, V2_STAGE_MAX);
    if (event.key === "[") this.stage = clamp(this.stage - 1, V2_STAGE_MIN, V2_STAGE_MAX);
    if (event.key === "=" || event.key === "+") {
      this.zoom = clamp(this.zoom * V2_VIEW_CONFIG.keyZoomStep, V2_VIEW_CONFIG.minZoom, V2_VIEW_CONFIG.maxZoom);
    }
    if (event.key === "-" || event.key === "_") {
      this.zoom = clamp(this.zoom / V2_VIEW_CONFIG.keyZoomStep, V2_VIEW_CONFIG.minZoom, V2_VIEW_CONFIG.maxZoom);
    }
    if (event.key === "m" || event.key === "M") {
      this.manualPlacementMode = !this.manualPlacementMode;
    }
    if (this.manualPlacementMode && (event.key === "c" || event.key === "C")) {
      this.manualHouses.length = 0;
      this.manualRoads.length = 0;
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

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.manualPlacementMode || event.button !== 0) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
      return;
    }
    const sx = rect.width <= 1e-6 ? 1 : this.canvas.width / rect.width;
    const sy = rect.height <= 1e-6 ? 1 : this.canvas.height / rect.height;
    this.pointerInsideCanvas = true;
    this.mouseCanvasX = localX * sx;
    this.mouseCanvasY = localY * sy;

    const preview = this.currentManualPreview();
    if (!preview.house) {
      return;
    }
    const newHouse = { ...preview.house, id: `mh-${this.manualHouses.length}` };
    const previous = this.manualHouses[this.manualHouses.length - 1] ?? null;
    const connection = this.buildManualConnectionRoad(newHouse, previous, `mr-${this.manualRoads.length}`);
    const placedHouse = connection.house ? { ...connection.house, id: newHouse.id } : newHouse;
    this.manualHouses.push(placedHouse);
    if (connection.secondaryRoad) {
      this.manualRoads.push(connection.secondaryRoad);
    }
    if (connection.road) {
      this.manualRoads.push(connection.road);
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

    if (this.manualPlacementMode) {
      const preview = this.currentManualPreview();
      this.drawRoads(this.manualRoads, viewMinX, viewMinY);
      if (preview.road) {
        this.drawRoads([preview.road], viewMinX, viewMinY, 0.48, true);
      }
      if (preview.secondaryRoad) {
        this.drawRoads([preview.secondaryRoad], viewMinX, viewMinY, 0.38);
      }
      this.drawHouses(this.manualHouses, viewMinX, viewMinY);
      if (preview.house) {
        this.drawHouses([preview.house], viewMinX, viewMinY, 0.5);
      }
      this.drawManualPreviewCue(preview, viewMinX, viewMinY);
      this.drawPlayerMarker(halfW, halfH);

      const terrain = this.terrain.elevationAt(this.playerX, this.playerY);
      const slope = this.terrain.slopeAt(this.playerX, this.playerY);
      const hover = this.pointerInsideCanvas
        ? this.screenToWorld(this.mouseCanvasX, this.mouseCanvasY)
        : null;
      const hoverElev = hover ? this.terrain.elevationAt(hover.x, hover.y) : null;
      const hoverSlope = hover ? this.terrain.slopeAt(hover.x, hover.y) : null;
      this.hud.textContent = [
        "Village Generator V2 Sandbox",
        "Manual placement mode: ON",
        "Move: WASD / Arrows",
        "Place house: Left click",
        "Clear manual houses: C",
        "Toggle manual mode: M",
        "Stage keys still available for generator mode",
        `Current stage: ${STAGE_LABELS[this.stage]}`,
        `Seed: ${this.seed}`,
        `Zoom: ${this.zoom.toFixed(2)}x`,
        `Player px: ${this.playerX.toFixed(1)}, ${this.playerY.toFixed(1)}`,
        `Chunk-ish: ${floorDiv(this.playerX, 320)}, ${floorDiv(this.playerY, 320)}`,
        `Terrain@player: elev=${terrain.toFixed(3)} slope=${slope.toFixed(3)}`,
        `Contour grid: ${this.currentTerrainWorldStep.toFixed(1)} world units`,
        `Manual houses: ${this.manualHouses.length}`,
        `Manual roads: ${this.manualRoads.length}`,
        `Preview connection: ${preview.mode}`,
        preview.searchRadius > 0
          ? `Preview search radius: ${Number.isFinite(preview.searchRadius) ? preview.searchRadius.toFixed(1) : "global"}`
          : "Preview search radius: n/a",
        `Preview bridge mode: ${preview.mode === "bridge-road" ? "yes" : "no"}`,
        hover && hoverElev !== null && hoverSlope !== null
          ? `Hover: x=${hover.x.toFixed(1)} y=${hover.y.toFixed(1)} elev=${hoverElev.toFixed(3)} slope=${hoverSlope.toFixed(3)}`
          : "Hover: (move cursor over canvas)"
      ].join("\n");
      return;
    }

    const margin = 360;
    const minX = this.playerX - viewWidth * 0.5 - margin;
    const maxX = this.playerX + viewWidth * 0.5 + margin;
    const minY = this.playerY - viewHeight * 0.5 - margin;
    const maxY = this.playerY + viewHeight * 0.5 + margin;
    const sites = this.generator.collectSitesInBounds(minX, maxX, minY, maxY);
    const roadsToDraw: RoadSegment[] = [];
    const housesToDraw: House[] = [];
    if (this.stage >= 4) {
      const continuityRoads = this.generator.collectStage4ContinuityRoadsInBounds(minX, maxX, minY, maxY);
      roadsToDraw.push(...continuityRoads);
    }
    const planBySiteId = new Map<string, ReturnType<V2SettlementGenerator["buildVillagePlan"]>>();

    for (const site of sites) {
      const plan = this.generator.buildVillagePlan(site, this.stage);
      planBySiteId.set(site.id, plan);
      roadsToDraw.push(...plan.roads);
      housesToDraw.push(...plan.houses);
    }
    this.drawRoads(roadsToDraw, viewMinX, viewMinY);
    this.drawHouses(housesToDraw, viewMinX, viewMinY);

    const viewMaxX = viewMinX + viewWidth;
    const viewMaxY = viewMinY + viewHeight;
    const visibleSites = sites.filter((site) => site.x >= viewMinX && site.x <= viewMaxX && site.y >= viewMinY && site.y <= viewMaxY);
    let visibleBranchCount = 0;
    let visibleShortcutCount = 0;
    let visibleConnectorCount = 0;
    const perSiteMetrics: string[] = [];
    for (const site of visibleSites) {
      const plan = planBySiteId.get(site.id);
      if (!plan) {
        continue;
      }
      visibleBranchCount += plan.metrics.branchCount;
      visibleShortcutCount += plan.metrics.shortcutCount;
      visibleConnectorCount += plan.metrics.connectorCount;
      perSiteMetrics.push(
        `${site.id}: b=${plan.metrics.branchCount} s=${plan.metrics.shortcutCount} c=${plan.metrics.connectorCount}`
      );
    }

    this.drawPlayerMarker(halfW, halfH);

    const terrain = this.terrain.elevationAt(this.playerX, this.playerY);
    const slope = this.terrain.slopeAt(this.playerX, this.playerY);
    this.hud.textContent = [
      "Village Generator V2 Sandbox",
      "Move: WASD / Arrows",
      "Stage: 1-5 keys (or [ / ])",
      "Zoom: +/- keys or mouse wheel",
      `Current: ${STAGE_LABELS[this.stage]}`,
      `Seed: ${this.seed}`,
      `Zoom: ${this.zoom.toFixed(2)}x`,
      `Player px: ${this.playerX.toFixed(1)}, ${this.playerY.toFixed(1)}`,
      `Chunk-ish: ${floorDiv(this.playerX, 320)}, ${floorDiv(this.playerY, 320)}`,
      `Terrain: elev=${terrain.toFixed(3)} slope=${slope.toFixed(3)}`,
      `Contour grid: ${this.currentTerrainWorldStep.toFixed(1)} world units`,
      `Visible sites: ${visibleSites.length}`,
      `Visible metrics: branches=${visibleBranchCount} shortcuts=${visibleShortcutCount} connectors=${visibleConnectorCount}`,
      ...(perSiteMetrics.length > 0 ? perSiteMetrics : ["Per-site metrics: none"])
    ].join("\n");
  }

  private currentManualPreview(): ManualPreview {
    if (!this.pointerInsideCanvas) {
      return {
        house: null,
        road: null,
        secondaryRoad: null,
        mode: "none",
        attachPoint: null,
        secondaryAttachPoint: null,
        searchRadius: 0
      };
    }

    const hover = this.screenToWorld(this.mouseCanvasX, this.mouseCanvasY);
    const baseHouse = createManualHouseAt("preview", hover.x, hover.y, this.terrain, this.manualRoads);
    const previous = this.manualHouses[this.manualHouses.length - 1] ?? null;
    const connection = this.buildManualConnectionRoad(baseHouse, previous, "preview-road");
    return {
      house: connection.house ?? baseHouse,
      road: connection.road,
      secondaryRoad: connection.secondaryRoad,
      mode: connection.mode,
      attachPoint: connection.attachPoint,
      secondaryAttachPoint: connection.secondaryAttachPoint,
      searchRadius: connection.searchRadius
    };
  }

  private buildManualConnectionRoad(
    house: House,
    previous: House | null,
    id: string
  ): {
    house: House | null;
    road: RoadSegment | null;
    secondaryRoad: RoadSegment | null;
    mode: ManualConnectionMode;
    attachPoint: Point | null;
    secondaryAttachPoint: Point | null;
    searchRadius: number;
  } {
    const hasExistingRoads = this.manualRoads.length > 0;
    const searchRadius = hasExistingRoads ? Number.POSITIVE_INFINITY : previous ? Math.max(24, Math.hypot(previous.x - house.x, previous.y - house.y)) : 0;
    const attachCandidates = hasExistingRoads ? findRoadAttachmentCandidatesForHouse(house, this.manualRoads, searchRadius, 14) : [];
    if (attachCandidates.length > 0) {
      for (const attach of attachCandidates) {
        const bridgeAttach = findBridgeAttachmentForHouse(house, this.manualRoads, attach, Math.max(searchRadius + 18, searchRadius * 1.22));
        if (bridgeAttach) {
          const bridgeRoad = createManualBridgeRoadBetweenAttachments(`${id}-bridge`, attach, bridgeAttach, this.terrain);
          if (bridgeRoad && !this.roadIntersectsHouses(bridgeRoad, this.manualHouses, new Set())) {
            const orientedHouse = this.orientHouseTowardRoad(house, bridgeRoad);
            const drivewayAttach = findClosestRoadAttachmentForHouse(
              orientedHouse,
              [bridgeRoad],
              Math.max(36, Math.min(196, searchRadius * 0.95 + 24))
            );
            if (drivewayAttach) {
              const drivewayRoad = createManualRoadToAttachment(id, orientedHouse, drivewayAttach, this.terrain);
              if (drivewayRoad && !this.roadIntersectsHouses(drivewayRoad, this.manualHouses, new Set([orientedHouse.id]))) {
                return {
                  house: orientedHouse,
                  road: drivewayRoad,
                  secondaryRoad: bridgeRoad,
                  mode: "bridge-road",
                  attachPoint: drivewayAttach.point,
                  secondaryAttachPoint: bridgeAttach.point,
                  searchRadius
                };
              }
            }
          }
        }

        const road = createManualRoadToAttachment(id, house, attach, this.terrain);
        if (road && !this.roadIntersectsHouses(road, this.manualHouses, new Set([house.id]))) {
          return {
            house,
            road,
            secondaryRoad: null,
            mode: "attach-road",
            attachPoint: attach.point,
            secondaryAttachPoint: null,
            searchRadius
          };
        }
      }

      const bestAttach = attachCandidates[0];
      return {
        house,
        road: null,
        secondaryRoad: null,
        mode: "attach-road",
        attachPoint: bestAttach.point,
        secondaryAttachPoint: null,
        searchRadius
      };
    }

    if (!previous) {
      return {
        house,
        road: null,
        secondaryRoad: null,
        mode: "none",
        attachPoint: null,
        secondaryAttachPoint: null,
        searchRadius
      };
    }
    if (hasExistingRoads) {
      return {
        house,
        road: null,
        secondaryRoad: null,
        mode: "none",
        attachPoint: null,
        secondaryAttachPoint: null,
        searchRadius
      };
    }

    const seedRoad = createManualRoadBetweenHouses(id, previous, house, this.terrain);
    const usableRoad =
      seedRoad && !this.roadIntersectsHouses(seedRoad, this.manualHouses, new Set([house.id, previous.id])) ? seedRoad : null;
    return {
      house,
      road: usableRoad,
      secondaryRoad: null,
      mode: usableRoad ? "seed-road" : "none",
      attachPoint: null,
      secondaryAttachPoint: null,
      searchRadius
    };
  }

  private orientHouseTowardRoad(house: House, road: RoadSegment): House {
    const target = this.closestPointOnRoad(house.x, house.y, road);
    if (!target) {
      return house;
    }
    const dx = target.x - house.x;
    const dy = target.y - house.y;
    if (Math.hypot(dx, dy) <= 1e-6) {
      return house;
    }
    return {
      ...house,
      angle: Math.atan2(dy, dx)
    };
  }

  private closestPointOnRoad(x: number, y: number, road: RoadSegment): Point | null {
    if (road.points.length < 2) {
      return null;
    }

    let best: Point | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;

    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const lenSq = vx * vx + vy * vy;
      if (lenSq <= 1e-6) {
        continue;
      }
      const t = clamp(((x - a.x) * vx + (y - a.y) * vy) / lenSq, 0, 1);
      const qx = a.x + vx * t;
      const qy = a.y + vy * t;
      const dx = qx - x;
      const dy = qy - y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { x: qx, y: qy };
      }
    }

    return best;
  }

  private roadIntersectsHouses(road: RoadSegment, houses: House[], allowedHouseIds: Set<string>): boolean {
    if (road.points.length < 2) {
      return false;
    }

    for (const house of houses) {
      if (allowedHouseIds.has(house.id)) {
        continue;
      }
      const houseRadius = Math.hypot(house.width, house.depth) * 0.47;
      const clearance = houseRadius + V2_SETTLEMENT_CONFIG.roads.width * 0.42;
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        if (this.distancePointToSegment(house.x, house.y, a.x, a.y, b.x, b.y) < clearance) {
          return true;
        }
      }
    }
    return false;
  }

  private distancePointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const vx = bx - ax;
    const vy = by - ay;
    const lenSq = vx * vx + vy * vy;
    if (lenSq <= 1e-6) {
      return Math.hypot(px - ax, py - ay);
    }
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / lenSq, 0, 1);
    const qx = ax + vx * t;
    const qy = ay + vy * t;
    return Math.hypot(px - qx, py - qy);
  }

  private drawManualPreviewCue(preview: ManualPreview, viewMinX: number, viewMinY: number): void {
    if (!preview.house) {
      return;
    }

    const houseX = (preview.house.x - viewMinX) * this.zoom;
    const houseY = (preview.house.y - viewMinY) * this.zoom;
    const cueX = houseX + Math.max(6, 9 * this.zoom);
    const cueY = houseY - Math.max(6, 9 * this.zoom);
    const cueColor =
      preview.mode === "attach-road"
        ? "rgba(89, 224, 255, 0.96)"
        : preview.mode === "bridge-road"
          ? "rgba(116, 235, 140, 0.96)"
          : preview.mode === "seed-road"
          ? "rgba(255, 206, 108, 0.95)"
          : "rgba(188, 198, 208, 0.9)";

    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = cueColor;
    ctx.beginPath();
    ctx.arc(cueX, cueY, Math.max(1.8, 2.2 * this.zoom), 0, Math.PI * 2);
    ctx.fill();
    if ((preview.mode === "attach-road" || preview.mode === "bridge-road") && preview.attachPoint) {
      const ax = (preview.attachPoint.x - viewMinX) * this.zoom;
      const ay = (preview.attachPoint.y - viewMinY) * this.zoom;
      ctx.strokeStyle = cueColor;
      ctx.lineWidth = Math.max(1, 1.2 * this.zoom);
      ctx.beginPath();
      ctx.arc(ax, ay, Math.max(1.5, 1.9 * this.zoom), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (preview.mode === "bridge-road" && preview.secondaryAttachPoint) {
      const bx = (preview.secondaryAttachPoint.x - viewMinX) * this.zoom;
      const by = (preview.secondaryAttachPoint.y - viewMinY) * this.zoom;
      ctx.strokeStyle = cueColor;
      ctx.lineWidth = Math.max(1, 1.2 * this.zoom);
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(1.5, 2.1 * this.zoom), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
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

  private drawPlayerMarker(screenX: number, screenY: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#efe5c8";
    ctx.beginPath();
    ctx.arc(screenX, screenY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1b2229";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, width: number, height: number, viewMinX: number, viewMinY: number): void {
    const baseStep = V2_VIEW_CONFIG.terrainWorldStep;
    const minScreenPx = V2_VIEW_CONFIG.terrainMinScreenStepPx;
    const stepMultiplier = Math.max(1, Math.ceil((minScreenPx / this.zoom) / baseStep));
    const worldStep = baseStep * stepMultiplier;
    this.currentTerrainWorldStep = worldStep;
    const viewMaxX = viewMinX + width / this.zoom;
    const viewMaxY = viewMinY + height / this.zoom;
    const startWX = Math.floor(viewMinX / worldStep) * worldStep;
    const startWY = Math.floor(viewMinY / worldStep) * worldStep;

    for (let wy = startWY; wy <= viewMaxY + worldStep; wy += worldStep) {
      for (let wx = startWX; wx <= viewMaxX + worldStep; wx += worldStep) {
        const elevation = this.terrain.elevationAtRender(wx, wy);
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

  private drawRoads(roads: RoadSegment[], viewMinX: number, viewMinY: number, alpha = 1, showPreviewHandles = false): void {
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
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = V2_RENDER_CONFIG.roadOutlineColor;
    ctx.lineWidth = (V2_SETTLEMENT_CONFIG.roads.width + V2_RENDER_CONFIG.roadOutlinePad) * this.zoom;
    ctx.stroke(path);
    ctx.strokeStyle = V2_RENDER_CONFIG.roadFillColor;
    ctx.lineWidth = V2_SETTLEMENT_CONFIG.roads.width * this.zoom;
    ctx.stroke(path);

    if (this.manualPlacementMode && showPreviewHandles) {
      ctx.strokeStyle = "rgba(120, 200, 255, 0.9)";
      ctx.lineWidth = Math.max(1, 1.35 * this.zoom);
      ctx.setLineDash([6, 4]);
      for (const road of roads) {
        const beziers = road.bezierDebug;
        if (!beziers || beziers.length === 0) {
          continue;
        }
        for (const bezier of beziers) {
          const p0x = (bezier.p0.x - viewMinX) * this.zoom;
          const p0y = (bezier.p0.y - viewMinY) * this.zoom;
          const p1x = (bezier.p1.x - viewMinX) * this.zoom;
          const p1y = (bezier.p1.y - viewMinY) * this.zoom;
          const p2x = (bezier.p2.x - viewMinX) * this.zoom;
          const p2y = (bezier.p2.y - viewMinY) * this.zoom;
          const p3x = (bezier.p3.x - viewMinX) * this.zoom;
          const p3y = (bezier.p3.y - viewMinY) * this.zoom;

          ctx.beginPath();
          ctx.moveTo(p0x, p0y);
          ctx.lineTo(p1x, p1y);
          ctx.moveTo(p3x, p3y);
          ctx.lineTo(p2x, p2y);
          ctx.stroke();

          const handleRadius = Math.max(2.4, 3 * this.zoom);
          ctx.beginPath();
          ctx.arc(p1x, p1y, handleRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p2x, p2y, handleRadius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private drawHouses(houses: House[], viewMinX: number, viewMinY: number, alpha = 1): void {
    for (const house of houses) {
      this.drawHouse(house, viewMinX, viewMinY, alpha);
    }
  }

  private drawHouse(house: House, viewMinX: number, viewMinY: number, alpha = 1): void {
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
    ctx.save();
    ctx.globalAlpha = alpha;
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
    this.drawHouseFrontMarker(x, y, cos, sin, hw);
    this.strokePolygon(corners, "rgba(11, 15, 16, 0.94)", Math.max(1.3, 2 * this.zoom));
    ctx.restore();
  }

  private drawHouseFrontMarker(cx: number, cy: number, cos: number, sin: number, halfWidth: number): void {
    const ctx = this.ctx;
    const startX = cx + cos * halfWidth * 0.18;
    const startY = cy + sin * halfWidth * 0.18;
    const endX = cx + cos * halfWidth * 0.76;
    const endY = cy + sin * halfWidth * 0.76;

    ctx.strokeStyle = "rgba(243, 232, 202, 0.96)";
    ctx.lineWidth = Math.max(1.05, 1.35 * this.zoom);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.fillStyle = "rgba(26, 34, 41, 0.98)";
    ctx.beginPath();
    ctx.arc(endX, endY, Math.max(1.25, 1.6 * this.zoom), 0, Math.PI * 2);
    ctx.fill();
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

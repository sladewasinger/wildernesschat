import { clamp, floorDiv, lerp } from "../util/math";
import { V2SettlementGenerator } from "./generator";
import {
  createManualHouseAt,
  createManualRoadBetweenHouses,
  findRoadAttachmentCandidatesForHouse
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
    const houseId = `mh-${this.manualHouses.length}`;
    this.manualHouses.push({ ...preview.house, id: houseId });
    if (preview.secondaryAttachPoint) {
      this.markRoadNodeTypeAt(preview.secondaryAttachPoint, "t");
    }
    let nextRoadIndex = this.manualRoads.length;
    if (preview.secondaryRoad) {
      this.manualRoads.push(this.cloneRoadWithId(preview.secondaryRoad, `mr-${nextRoadIndex}`));
      nextRoadIndex += 1;
    }
    if (preview.road) {
      this.manualRoads.push(this.cloneRoadWithId(preview.road, `mr-${nextRoadIndex}`));
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
        this.drawRoads([preview.road], viewMinX, viewMinY, 0.48);
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
        `Seed fillet radius: ${V2_SETTLEMENT_CONFIG.manualPlacement.seedDrivewayFilletRadius.toFixed(1)}`,
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
    const baseHouse = createManualHouseAt("preview", hover.x, hover.y, this.terrain, []);
    const previous = this.manualHouses[this.manualHouses.length - 1] ?? null;
    const connection = this.resolveManualConnection(baseHouse, previous, "preview-road");
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

  private resolveManualConnection(
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
    const first = this.buildManualConnectionRoad(house, previous, id);
    const firstHouse = first.house ?? house;
    const second = this.buildManualConnectionRoad(firstHouse, previous, id);
    return {
      ...second,
      house: second.house ?? firstHouse
    };
  }

  private cloneRoadWithId(road: RoadSegment, id: string): RoadSegment {
    return {
      ...road,
      id,
      points: road.points.map((p) => ({ x: p.x, y: p.y })),
      renderPoints: road.renderPoints ? road.renderPoints.map((p) => ({ x: p.x, y: p.y })) : null,
      nodes: road.nodes ? road.nodes.map((n) => ({ x: n.x, y: n.y, type: n.type })) : null,
      bezierDebug: road.bezierDebug
        ? road.bezierDebug.map((curve) => ({
            p0: { x: curve.p0.x, y: curve.p0.y },
            p1: { x: curve.p1.x, y: curve.p1.y },
            p2: { x: curve.p2.x, y: curve.p2.y },
            p3: { x: curve.p3.x, y: curve.p3.y }
          }))
        : null
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
    const searchRadius = hasExistingRoads
      ? Number.POSITIVE_INFINITY
      : previous
        ? Math.max(24, Math.hypot(previous.x - house.x, previous.y - house.y))
        : 0;
    const terrainHouse = createManualHouseAt(house.id, house.x, house.y, this.terrain, []);
    if (hasExistingRoads) {
      const connected = this.buildManualMainRoadConnection(terrainHouse, id);
      if (connected) {
        return connected;
      }
      return {
        house: terrainHouse,
        road: null,
        secondaryRoad: null,
        mode: "none",
        attachPoint: null,
        secondaryAttachPoint: null,
        searchRadius
      };
    }
    if (!previous) {
      return {
        house: terrainHouse,
        road: null,
        secondaryRoad: null,
        mode: "none",
        attachPoint: null,
        secondaryAttachPoint: null,
        searchRadius
      };
    }

    const seedRoad = createManualRoadBetweenHouses(id, previous, terrainHouse, this.terrain);
    const usableRoad =
      seedRoad && !this.roadIntersectsHouses(seedRoad, this.manualHouses, new Set([terrainHouse.id, previous.id])) ? seedRoad : null;
    return {
      house: terrainHouse,
      road: usableRoad,
      secondaryRoad: null,
      mode: usableRoad ? "seed-road" : "none",
      attachPoint: null,
      secondaryAttachPoint: null,
      searchRadius
    };
  }

  private buildManualMainRoadConnection(
    house: House,
    id: string
  ): {
    house: House | null;
    road: RoadSegment | null;
    secondaryRoad: RoadSegment | null;
    mode: ManualConnectionMode;
    attachPoint: Point | null;
    secondaryAttachPoint: Point | null;
    searchRadius: number;
  } | null {
    const contourRoads = this.manualRoads.filter((road) => road.className === "trunk" && road.points.length >= 3);
    if (contourRoads.length === 0) {
      return null;
    }
    const mainRoad = contourRoads[0];

    let secondaryRoad: RoadSegment | null = null;
    let extensionAttachPoint: Point | null = null;
    let extensionAttachTangent: Point | null = null;
    let targetRoads: RoadSegment[] = [mainRoad];
    const directAttachAnyTrunk = this.findClosestAttachmentAvoidingRoadNodes(house, contourRoads, false);
    const maxDirectAttachDistance = V2_SETTLEMENT_CONFIG.manualPlacement.contourSetbackWorld * 2.2;

    if (directAttachAnyTrunk && directAttachAnyTrunk.distance <= maxDirectAttachDistance) {
      const drivewayRoad = this.buildSimpleTDrivewayRoad(id, house, directAttachAnyTrunk);
      if (!drivewayRoad) {
        return null;
      }
      if (this.roadIntersectsHouses(drivewayRoad, this.manualHouses, new Set([house.id]))) {
        return null;
      }
      return {
        house,
        road: drivewayRoad,
        secondaryRoad: null,
        mode: "attach-road",
        attachPoint: directAttachAnyTrunk.point,
        secondaryAttachPoint: null,
        searchRadius: Number.POSITIVE_INFINITY
      };
    }

    const beyondAnyExtent = contourRoads.some((road) => this.isBeyondMainRoadExtent(house, road));
    if (!beyondAnyExtent) {
      return null;
    }

    const endpoint = this.findRoadEndpointExtensionTarget(house, contourRoads);
    if (endpoint) {
      const contourStart = this.projectPointToNearestContour(endpoint.start);
      const contourTarget = this.projectPointToNearestContour(endpoint.target);
      const extensionPoints = this.traceContourExtensionPath(contourStart, contourTarget, endpoint.outward);
      if (!extensionPoints || extensionPoints.length < 2) {
        return null;
      }
      const extensionStart = extensionPoints[0];
      const extensionEnd = extensionPoints[extensionPoints.length - 1];
      const extensionPrev = extensionPoints[Math.max(0, extensionPoints.length - 2)];
      const endTangent = this.normalizeDirection(extensionEnd.x - extensionPrev.x, extensionEnd.y - extensionPrev.y) ?? endpoint.outward;
      const extensionRoad: RoadSegment = {
        id: `${id}-extend`,
        className: "trunk",
        width: V2_SETTLEMENT_CONFIG.roads.width,
        points: extensionPoints,
        nodes: [
          { x: extensionStart.x, y: extensionStart.y, type: "t" },
          { x: extensionEnd.x, y: extensionEnd.y, type: "elbow" }
        ]
      };
      const allowed = this.extensionAllowedHouseIds(endpoint.start);
      if (this.roadIntersectsHouses(extensionRoad, this.manualHouses, allowed)) {
        return null;
      }
      extensionAttachPoint = { x: extensionEnd.x, y: extensionEnd.y };
      extensionAttachTangent = { x: endTangent.x, y: endTangent.y };
      secondaryRoad = extensionRoad;
      targetRoads = [extensionRoad];
    } else {
      return null;
    }

    const drivewayAttach = secondaryRoad && extensionAttachPoint && extensionAttachTangent
      ? {
          roadId: secondaryRoad.id,
          point: { x: extensionAttachPoint.x, y: extensionAttachPoint.y },
          tangentX: extensionAttachTangent.x,
          tangentY: extensionAttachTangent.y,
          distance: Math.hypot(extensionAttachPoint.x - house.x, extensionAttachPoint.y - house.y)
        }
      : this.findClosestAttachmentAvoidingRoadNodes(house, targetRoads);
    if (!drivewayAttach) {
      return null;
    }
    if (!secondaryRoad && drivewayAttach.distance > V2_SETTLEMENT_CONFIG.manualPlacement.contourSetbackWorld * 1.9) {
      return null;
    }
    const drivewayRoad = this.buildSimpleTDrivewayRoad(id, house, drivewayAttach);
    if (!drivewayRoad) {
      return null;
    }
    if (this.roadIntersectsHouses(drivewayRoad, this.manualHouses, new Set([house.id]))) {
      return null;
    }

    return {
      house,
      road: drivewayRoad,
      secondaryRoad,
      mode: "attach-road",
      attachPoint: drivewayAttach.point,
      secondaryAttachPoint: secondaryRoad ? endpoint?.start ?? null : null,
      searchRadius: Number.POSITIVE_INFINITY
    };
  }

  private buildSimpleTDrivewayRoad(
    id: string,
    house: House,
    attach: { point: Point; tangentX: number; tangentY: number }
  ): RoadSegment | null {
    const front = this.houseFrontPoint(house);
    const logicPoints = this.dedupePoints([front, attach.point]);
    if (logicPoints.length < 2) {
      return null;
    }

    return {
      id,
      className: "drive",
      width: V2_SETTLEMENT_CONFIG.roads.width,
      points: logicPoints
    };
  }

  private isBeyondMainRoadExtent(house: House, mainRoad: RoadSegment): boolean {
    const anchors = this.extensionAnchorsForRoad(mainRoad);
    if (anchors.length === 0) {
      return false;
    }
    const target = this.projectPointToNearestContour(this.houseFrontPoint(house));
    for (const node of anchors) {
      const dx = target.x - node.anchor.x;
      const dy = target.y - node.anchor.y;
      const along = dx * node.outward.x + dy * node.outward.y;
      if (along <= 26) {
        continue;
      }
      const lateral = Math.abs(dx * node.outward.y - dy * node.outward.x);
      if (lateral <= Math.max(42, along * 0.95)) {
        return true;
      }
    }
    return false;
  }


  private findRoadEndpointExtensionTarget(
    house: House,
    roads: RoadSegment[] = this.manualRoads
  ): { start: Point; target: Point; outward: Point; distanceToHouse: number } | null {
    const houseFront = this.houseFrontPoint(house);
    const contourTarget = this.projectPointToNearestContour(houseFront);
    let best:
      | {
          start: Point;
          target: Point;
          outward: Point;
          distanceToHouse: number;
          score: number;
        }
      | null = null;

    const allNodes: { anchor: Point; outward: Point; dist: number }[] = [];
    for (const road of roads) {
      for (const node of this.extensionAnchorsForRoad(road)) {
        allNodes.push({
          anchor: node.anchor,
          outward: node.outward,
          dist: Math.hypot(node.anchor.x - contourTarget.x, node.anchor.y - contourTarget.y)
        });
      }
    }
    if (allNodes.length === 0) {
      return null;
    }
    allNodes.sort((a, b) => a.dist - b.dist);
    const nearestDist = allNodes[0].dist;
    const maxDistForConsideration = nearestDist + 28;
    let considered = 0;
    for (const node of allNodes) {
      if (node.dist > maxDistForConsideration && considered >= 1) {
        continue;
      }
      const candidate = this.evaluateRoadEndpointForExtension(house, contourTarget, node.anchor, node.outward);
      if (candidate && (!best || candidate.score < best.score)) {
        best = candidate;
      }
      considered += 1;
      if (considered >= 4) {
        break;
      }
    }

    if (!best) {
      return null;
    }
    return {
      start: best.start,
      target: best.target,
      outward: best.outward,
      distanceToHouse: best.distanceToHouse
    };
  }

  private evaluateRoadEndpointForExtension(
    house: House,
    contourTarget: Point,
    endpoint: Point,
    outward: Point
  ): { start: Point; target: Point; outward: Point; distanceToHouse: number; score: number } | null {
    const toTargetX = contourTarget.x - endpoint.x;
    const toTargetY = contourTarget.y - endpoint.y;
    let chosenOutward = outward;
    let along = toTargetX * chosenOutward.x + toTargetY * chosenOutward.y;
    if (along < 0) {
      const flipped = { x: -outward.x, y: -outward.y };
      const flippedAlong = toTargetX * flipped.x + toTargetY * flipped.y;
      if (flippedAlong > along) {
        chosenOutward = flipped;
        along = flippedAlong;
      }
    }
    if (along < 8) {
      return null;
    }
    const lateral = Math.abs(toTargetX * chosenOutward.y - toTargetY * chosenOutward.x);
    const distanceToHouse = Math.hypot(house.x - contourTarget.x, house.y - contourTarget.y);
    const endpointDist = Math.hypot(contourTarget.x - endpoint.x, contourTarget.y - endpoint.y);
    const score = endpointDist * 1.15 + lateral * 0.45 + distanceToHouse * 0.72 + along * 0.12;

    return {
      start: endpoint,
      target: contourTarget,
      outward: chosenOutward,
      distanceToHouse,
      score
    };
  }

  private extensionAnchorsForRoad(road: RoadSegment): { anchor: Point; outward: Point }[] {
    const anchors: { anchor: Point; outward: Point }[] = [];
    const pts = road.points;
    if (pts.length < 2) {
      return anchors;
    }

    const addAnchor = (anchor: Point, towardInterior: Point): void => {
      const outward = this.normalizeDirection(anchor.x - towardInterior.x, anchor.y - towardInterior.y);
      if (!outward) {
        return;
      }
      anchors.push({ anchor, outward });
    };

    if (road.nodes && road.nodes.length > 0) {
      for (const node of road.nodes) {
        if (node.type !== "elbow") {
          continue;
        }
        const nearest = this.nearestInteriorPointOnRoad(road, node);
        if (!nearest) {
          continue;
        }
        addAnchor({ x: node.x, y: node.y }, nearest);
      }
      return anchors;
    }

    // Seed roads keep house-front endpoints in logic points; extension should continue from contour corner nodes.
    if (road.renderPoints && pts.length >= 4) {
      addAnchor(pts[1], pts[2]);
      addAnchor(pts[pts.length - 2], pts[pts.length - 3]);
      return anchors;
    }

    addAnchor(pts[0], pts[1]);
    addAnchor(pts[pts.length - 1], pts[pts.length - 2]);
    return anchors;
  }

  private findClosestAttachmentAvoidingRoadNodes(
    house: House,
    roads: RoadSegment[],
    allowNodeFallback = true
  ): { roadId: string; point: Point; tangentX: number; tangentY: number; distance: number } | null {
    const candidates = findRoadAttachmentCandidatesForHouse(house, roads, Number.POSITIVE_INFINITY, 24);
    if (candidates.length === 0) {
      return null;
    }
    const nodeSnapEps = 4.2;
    for (const candidate of candidates) {
      const road = roads.find((r) => r.id === candidate.roadId);
      if (!road || !road.nodes || road.nodes.length === 0) {
        return candidate;
      }
      const nearExistingNode = road.nodes.some((n) => Math.hypot(n.x - candidate.point.x, n.y - candidate.point.y) <= nodeSnapEps);
      if (!nearExistingNode) {
        return candidate;
      }
    }
    return allowNodeFallback ? candidates[0] : null;
  }

  private nearestInteriorPointOnRoad(road: RoadSegment, node: Point): Point | null {
    if (road.points.length < 2) {
      return null;
    }
    let best: Point | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of road.points) {
      const d = Math.hypot(p.x - node.x, p.y - node.y);
      if (d > 1e-4 && d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  private markRoadNodeTypeAt(point: Point, type: "elbow" | "t"): void {
    const eps = 4;
    for (const road of this.manualRoads) {
      if (!road.nodes || road.nodes.length === 0) {
        continue;
      }
      for (const node of road.nodes) {
        if (Math.hypot(node.x - point.x, node.y - point.y) <= eps) {
          node.type = type;
        }
      }
    }
  }

  private extensionAllowedHouseIds(anchor: Point): Set<string> {
    const nearest = [...this.manualHouses]
      .map((house) => ({ id: house.id, d: Math.hypot(house.x - anchor.x, house.y - anchor.y) }))
      .sort((a, b) => a.d - b.d);
    const allowed = new Set<string>();
    if (nearest.length > 0 && nearest[0].d <= 96) {
      allowed.add(nearest[0].id);
    }
    if (nearest.length > 1 && nearest[1].d <= 96) {
      allowed.add(nearest[1].id);
    }
    return allowed;
  }

  private traceContourExtensionPath(start: Point, end: Point, preferredOutward: Point): Point[] | null {
    const span = Math.hypot(end.x - start.x, end.y - start.y);
    if (span <= 1e-6) {
      return null;
    }
    const stepLen = clamp(span / 18, 4, 10);
    const maxSteps = Math.ceil(span / stepLen) * 10;
    const targetElev = this.terrain.elevationAtRender(start.x, start.y);
    const points: Point[] = [{ x: start.x, y: start.y }];
    let cur = { x: start.x, y: start.y };
    for (let i = 0; i < maxSteps; i += 1) {
      const toEnd = this.normalizeDirection(end.x - cur.x, end.y - cur.y);
      if (!toEnd) {
        break;
      }
      const remaining = Math.hypot(end.x - cur.x, end.y - cur.y);
      if (remaining <= stepLen * 1.35) {
        points.push({ x: end.x, y: end.y });
        const finalized = this.dedupePoints(points);
        if (this.pathLooksTooStraight(finalized, start, end)) {
          return this.buildContourConnectorFallback(start, end, preferredOutward);
        }
        return finalized;
      }

      let contourDir = this.contourDirectionAt(cur.x, cur.y, 16);
      const contourFlip = { x: -contourDir.x, y: -contourDir.y };
      if (points.length === 1) {
        if (contourDir.x * preferredOutward.x + contourDir.y * preferredOutward.y < contourFlip.x * preferredOutward.x + contourFlip.y * preferredOutward.y) {
          contourDir = contourFlip;
        }
      } else {
        const aheadA = Math.hypot(end.x - (cur.x + contourDir.x * stepLen), end.y - (cur.y + contourDir.y * stepLen));
        const aheadB = Math.hypot(end.x - (cur.x + contourFlip.x * stepLen), end.y - (cur.y + contourFlip.y * stepLen));
        if (aheadB < aheadA) {
          contourDir = contourFlip;
        }
      }
      const next = {
        x: cur.x + contourDir.x * stepLen,
        y: cur.y + contourDir.y * stepLen
      };
      const grad = this.terrainGradientAt(next.x, next.y, 16);
      if (grad) {
        const elevErr = this.terrain.elevationAtRender(next.x, next.y) - targetElev;
        const correction = clamp(elevErr / grad.magnitude, -stepLen * 0.8, stepLen * 0.8);
        next.x -= grad.normal.x * correction;
        next.y -= grad.normal.y * correction;
      }
      const tooCloseToHistory = points.length > 8 && points.slice(0, -6).some((p) => Math.hypot(next.x - p.x, next.y - p.y) < stepLen * 0.7);
      if (tooCloseToHistory) {
        const nudged = this.normalizeDirection(next.x - cur.x + toEnd.x * stepLen * 0.22, next.y - cur.y + toEnd.y * stepLen * 0.22);
        if (!nudged) {
          break;
        }
        const n2 = {
          x: cur.x + nudged.x * stepLen,
          y: cur.y + nudged.y * stepLen
        };
        points.push(n2);
        cur = n2;
        continue;
      }
      points.push(next);
      cur = next;
    }

    return this.buildContourConnectorFallback(start, end, preferredOutward);
  }

  private pathLooksTooStraight(points: Point[], start: Point, end: Point): boolean {
    if (points.length < 3) {
      return true;
    }
    const direct = Math.hypot(end.x - start.x, end.y - start.y);
    if (direct <= 1e-6) {
      return true;
    }
    if (direct < 52) {
      return false;
    }
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return length / direct < 1.035;
  }

  private buildContourConnectorFallback(start: Point, end: Point, preferredOutward: Point): Point[] | null {
    const span = Math.hypot(end.x - start.x, end.y - start.y);
    if (span <= 1e-6) {
      return null;
    }
    const dir = this.normalizeDirection(end.x - start.x, end.y - start.y);
    if (!dir) {
      return null;
    }
    let sTan = this.contourDirectionAt(start.x, start.y, 16);
    const sFlip = { x: -sTan.x, y: -sTan.y };
    const sScore = sTan.x * preferredOutward.x + sTan.y * preferredOutward.y + sTan.x * dir.x + sTan.y * dir.y;
    const sFlipScore = sFlip.x * preferredOutward.x + sFlip.y * preferredOutward.y + sFlip.x * dir.x + sFlip.y * dir.y;
    if (sFlipScore > sScore) {
      sTan = sFlip;
    }
    let eTan = this.contourDirectionAt(end.x, end.y, 16);
    const eFlip = { x: -eTan.x, y: -eTan.y };
    const eScore = eTan.x * -dir.x + eTan.y * -dir.y;
    const eFlipScore = eFlip.x * -dir.x + eFlip.y * -dir.y;
    if (eFlipScore > eScore) {
      eTan = eFlip;
    }

    const lead = clamp(span * 0.22, 14, 68);
    const p0 = start;
    const p1 = { x: start.x + sTan.x * lead, y: start.y + sTan.y * lead };
    const p2 = { x: end.x + eTan.x * lead, y: end.y + eTan.y * lead };
    const p3 = end;
    const steps = clamp(Math.round(span / 4.2), 12, 44);
    const points: Point[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const omt = 1 - t;
      points.push({
        x: omt * omt * omt * p0.x + 3 * omt * omt * t * p1.x + 3 * omt * t * t * p2.x + t * t * t * p3.x,
        y: omt * omt * omt * p0.y + 3 * omt * omt * t * p1.y + 3 * omt * t * t * p2.y + t * t * t * p3.y
      });
    }
    return this.dedupePoints(points);
  }

  private terrainGradientAt(x: number, y: number, step: number): { normal: Point; magnitude: number } | null {
    const gx = this.terrain.elevationAtRender(x + step, y) - this.terrain.elevationAtRender(x - step, y);
    const gy = this.terrain.elevationAtRender(x, y + step) - this.terrain.elevationAtRender(x, y - step);
    const gradNorm = Math.hypot(gx, gy);
    if (gradNorm <= 1e-8) {
      return null;
    }
    const magnitude = gradNorm / (2 * step);
    if (magnitude <= 1e-8) {
      return null;
    }
    return {
      normal: { x: gx / gradNorm, y: gy / gradNorm },
      magnitude
    };
  }

  private contourDirectionAt(x: number, y: number, step: number): Point {
    const gx = this.terrain.elevationAtRender(x + step, y) - this.terrain.elevationAtRender(x - step, y);
    const gy = this.terrain.elevationAtRender(x, y + step) - this.terrain.elevationAtRender(x, y - step);
    const contourX = -gy;
    const contourY = gx;
    const len = Math.hypot(contourX, contourY);
    if (len <= 1e-6) {
      return { x: 1, y: 0 };
    }
    return { x: contourX / len, y: contourY / len };
  }

  private projectPointToNearestContour(point: Point): Point {
    const contourLevels = V2_SETTLEMENT_CONFIG.manualPlacement.contourLevels;
    const step = V2_SETTLEMENT_CONFIG.manualPlacement.contourSetbackSampleStep;
    const sample = this.signedContourDistance(point.x, point.y, step, contourLevels);
    if (Math.abs(sample.grad) <= 1e-6) {
      return { x: point.x, y: point.y };
    }
    return {
      x: point.x - sample.normal.x * sample.distance,
      y: point.y - sample.normal.y * sample.distance
    };
  }

  private signedContourDistance(
    x: number,
    y: number,
    sampleStep: number,
    contourLevels: number
  ): { distance: number; grad: number; normal: Point } {
    const gx = this.terrain.elevationAtRender(x + sampleStep, y) - this.terrain.elevationAtRender(x - sampleStep, y);
    const gy = this.terrain.elevationAtRender(x, y + sampleStep) - this.terrain.elevationAtRender(x, y - sampleStep);
    const gradNorm = Math.hypot(gx, gy);
    if (gradNorm <= 1e-8) {
      return {
        distance: 0,
        grad: 0,
        normal: { x: 1, y: 0 }
      };
    }
    const grad = gradNorm / (2 * sampleStep);
    const elev = this.terrain.elevationAtRender(x, y);
    const eScaled = elev * contourLevels;
    const nearestScaled = Math.round(eScaled - 0.5) + 0.5;
    const nearestElev = nearestScaled / contourLevels;
    return {
      distance: (elev - nearestElev) / grad,
      grad,
      normal: { x: gx / gradNorm, y: gy / gradNorm }
    };
  }

  private houseFrontPoint(house: House): Point {
    const forwardX = Math.cos(house.angle);
    const forwardY = Math.sin(house.angle);
    const frontOffset = house.width * 0.5 - V2_SETTLEMENT_CONFIG.roads.width * 0.24;
    return {
      x: house.x + forwardX * frontOffset,
      y: house.y + forwardY * frontOffset
    };
  }

  private dedupePoints(points: Point[]): Point[] {
    if (points.length <= 1) {
      return points;
    }
    const out: Point[] = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
      const prev = out[out.length - 1];
      const next = points[i];
      if (Math.hypot(next.x - prev.x, next.y - prev.y) <= 1e-4) {
        continue;
      }
      out.push(next);
    }
    return out;
  }

  private normalizeDirection(x: number, y: number): Point | null {
    const len = Math.hypot(x, y);
    if (len <= 1e-6) {
      return null;
    }
    return {
      x: x / len,
      y: y / len
    };
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

        let r = lerp(177, 124, elevation);
        let g = lerp(207, 161, elevation);
        let b = lerp(155, 112, elevation);

        ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        const sx = Math.floor((wx - viewMinX) * this.zoom);
        const sy = Math.floor((wy - viewMinY) * this.zoom);
        const size = Math.ceil(worldStep * this.zoom) + 1;
        ctx.fillRect(sx, sy, size, size);
      }
    }

    if (this.stage === 0 || this.manualPlacementMode) {
      this.drawTerrainContours(ctx, viewMinX, viewMinY, viewMaxX, viewMaxY, worldStep);
    }
  }

  private drawTerrainContours(
    ctx: CanvasRenderingContext2D,
    viewMinX: number,
    viewMinY: number,
    viewMaxX: number,
    viewMaxY: number,
    worldStep: number
  ): void {
    const contourLevels = V2_SETTLEMENT_CONFIG.manualPlacement.contourLevels;
    const contourSetback = V2_SETTLEMENT_CONFIG.manualPlacement.contourSetbackWorld;
    const contourSampleStep = V2_SETTLEMENT_CONFIG.manualPlacement.contourSetbackSampleStep;
    const startWX = Math.floor(viewMinX / worldStep) * worldStep;
    const startWY = Math.floor(viewMinY / worldStep) * worldStep;
    const contourField = (x: number, y: number): number => {
      const scaled = this.terrain.elevationAtRender(x, y) * contourLevels;
      const nearest = Math.round(scaled - 0.5) + 0.5;
      return scaled - nearest;
    };
    const snapField = (x: number, y: number): number =>
      Math.abs(this.signedContourDistance(x, y, contourSampleStep, contourLevels).distance) - contourSetback;
    const showSnapGuides = this.manualPlacementMode && this.mouseCanvasX >= 0 && this.mouseCanvasY >= 0;
    const hoverWorld = showSnapGuides ? this.screenToWorld(this.mouseCanvasX, this.mouseCanvasY) : null;
    const contourGuideRadiusWorld = 320;
    const snapGuideRadiusWorld = 280;
    const contourMinX = hoverWorld ? hoverWorld.x - contourGuideRadiusWorld : viewMinX;
    const contourMaxX = hoverWorld ? hoverWorld.x + contourGuideRadiusWorld : viewMaxX;
    const contourMinY = hoverWorld ? hoverWorld.y - contourGuideRadiusWorld : viewMinY;
    const contourMaxY = hoverWorld ? hoverWorld.y + contourGuideRadiusWorld : viewMaxY;
    const snapMinX = hoverWorld ? hoverWorld.x - snapGuideRadiusWorld : 0;
    const snapMaxX = hoverWorld ? hoverWorld.x + snapGuideRadiusWorld : 0;
    const snapMinY = hoverWorld ? hoverWorld.y - snapGuideRadiusWorld : 0;
    const snapMaxY = hoverWorld ? hoverWorld.y + snapGuideRadiusWorld : 0;

    const contourPath = new Path2D();
    const snapPath = new Path2D();
    const interpolate = (a: Point, b: Point, va: number, vb: number): Point => {
      const denom = va - vb;
      const t = Math.abs(denom) <= 1e-6 ? 0.5 : clamp(va / denom, 0, 1);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t
      };
    };
    const addCellSegments = (path: Path2D, v00: number, v10: number, v11: number, v01: number, p00: Point, p10: Point, p11: Point, p01: Point): void => {
      const hits: Point[] = [];
      if ((v00 <= 0 && v10 >= 0) || (v00 >= 0 && v10 <= 0)) {
        hits.push(interpolate(p00, p10, v00, v10));
      }
      if ((v10 <= 0 && v11 >= 0) || (v10 >= 0 && v11 <= 0)) {
        hits.push(interpolate(p10, p11, v10, v11));
      }
      if ((v11 <= 0 && v01 >= 0) || (v11 >= 0 && v01 <= 0)) {
        hits.push(interpolate(p11, p01, v11, v01));
      }
      if ((v01 <= 0 && v00 >= 0) || (v01 >= 0 && v00 <= 0)) {
        hits.push(interpolate(p01, p00, v01, v00));
      }
      if (hits.length < 2) {
        return;
      }
      const drawSeg = (a: Point, b: Point): void => {
        path.moveTo((a.x - viewMinX) * this.zoom, (a.y - viewMinY) * this.zoom);
        path.lineTo((b.x - viewMinX) * this.zoom, (b.y - viewMinY) * this.zoom);
      };
      if (hits.length === 2 || hits.length === 3) {
        drawSeg(hits[0], hits[1]);
      } else {
        drawSeg(hits[0], hits[1]);
        drawSeg(hits[2], hits[3]);
      }
    };

    for (let wy = startWY; wy <= viewMaxY; wy += worldStep) {
      for (let wx = startWX; wx <= viewMaxX; wx += worldStep) {
        const p00 = { x: wx, y: wy };
        const p10 = { x: wx + worldStep, y: wy };
        const p11 = { x: wx + worldStep, y: wy + worldStep };
        const p01 = { x: wx, y: wy + worldStep };
        const cellMinX = wx;
        const cellMaxX = wx + worldStep;
        const cellMinY = wy;
        const cellMaxY = wy + worldStep;
        const intersectsContourBounds =
          cellMaxX >= contourMinX && cellMinX <= contourMaxX && cellMaxY >= contourMinY && cellMinY <= contourMaxY;
        if (intersectsContourBounds) {
          addCellSegments(
            contourPath,
            contourField(p00.x, p00.y),
            contourField(p10.x, p10.y),
            contourField(p11.x, p11.y),
            contourField(p01.x, p01.y),
            p00,
            p10,
            p11,
            p01
          );
        }
        if (showSnapGuides) {
          const intersectsSnapBounds =
            cellMaxX >= snapMinX && cellMinX <= snapMaxX && cellMaxY >= snapMinY && cellMinY <= snapMaxY;
          if (intersectsSnapBounds) {
            addCellSegments(
              snapPath,
              snapField(p00.x, p00.y),
              snapField(p10.x, p10.y),
              snapField(p11.x, p11.y),
              snapField(p01.x, p01.y),
              p00,
              p10,
              p11,
              p01
            );
          }
        }
      }
    }

    ctx.save();
    ctx.strokeStyle = "rgba(42, 52, 55, 0.62)";
    ctx.lineWidth = 1;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.stroke(contourPath);
    if (showSnapGuides) {
      ctx.strokeStyle = "rgba(78, 93, 98, 0.58)";
      ctx.setLineDash([2, 3]);
      ctx.stroke(snapPath);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawRoads(roads: RoadSegment[], viewMinX: number, viewMinY: number, alpha = 1, showPreviewHandles = false): void {
    const path = new Path2D();
    for (const road of roads) {
      const drawPoints = road.renderPoints ?? road.points;
      if (drawPoints.length < 2) {
        continue;
      }
      for (let i = 0; i < drawPoints.length; i += 1) {
        const p = drawPoints[i];
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
    ctx.lineCap = "butt";
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

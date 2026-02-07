import { DebugLayerConfig, WorldConfig } from "../../gen/config";
import { hashCoords, hashToUnit, mixUint32 } from "../../gen/hash";
import { RiverPath, RiverSystem } from "../../gen/rivers";
import { House, Parcel, Road, SettlementFeatures, SettlementSystem, Village } from "../../gen/settlements";
import { TerrainSampler } from "../../gen/terrain";
import { clamp, floorDiv, lerp } from "../../util/math";
import { LandUseBlender } from "./land-use-blender";
import { SuperchunkFeatureCache } from "./superchunk-feature-cache";

export class FeatureOverlayRenderer {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly rivers: RiverSystem;
  private readonly debug: DebugLayerConfig;
  private readonly treeSeed: number;
  private readonly fieldSeed: number;
  private readonly superchunkCache: SuperchunkFeatureCache;

  constructor(
    config: WorldConfig,
    terrain: TerrainSampler,
    rivers: RiverSystem,
    settlements: SettlementSystem,
    debug: DebugLayerConfig,
    treeSeed: number,
    fieldSeed: number
  ) {
    this.config = config;
    this.terrain = terrain;
    this.rivers = rivers;
    this.debug = debug;
    this.treeSeed = treeSeed;
    this.fieldSeed = fieldSeed;
    this.superchunkCache = new SuperchunkFeatureCache(config, settlements);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    chunkX: number,
    chunkY: number,
    startX: number,
    startY: number,
    chunkSize: number
  ): void {
    const rivers = this.getRiversForChunk(startX, startY, chunkSize);
    const maskMode = this.debug.showWaterMask || this.debug.showMoisture || this.debug.showForestMask;
    if (maskMode) {
      if (this.debug.showRivers) {
        this.drawRivers(ctx, startX, startY, rivers);
      }
      return;
    }

    this.drawRivers(ctx, startX, startY, rivers);
    const features = this.superchunkCache.getFeaturesForChunk(chunkX, chunkY);
    const landUse = new LandUseBlender(this.config, this.terrain, features);

    this.drawFields(ctx, startX, startY, chunkSize, features, landUse);
    this.drawRoadsAndVillages(ctx, startX, startY, features, rivers);
    this.drawParcels(ctx, startX, startY, features.parcels);
    this.drawHouses(ctx, startX, startY, features);
    this.drawForest(ctx, startX, startY, chunkSize, landUse);
  }

  private getRiversForChunk(startX: number, startY: number, chunkSize: number): RiverPath[] {
    const margin = 28;
    const minX = startX - margin;
    const maxX = startX + chunkSize + margin;
    const minY = startY - margin;
    const maxY = startY + chunkSize + margin;
    return this.rivers.getRiversForBounds(minX, maxX, minY, maxY);
  }

  private drawRivers(ctx: CanvasRenderingContext2D, startX: number, startY: number, rivers: RiverPath[]): void {
    if (!this.debug.showRivers) {
      return;
    }

    for (const river of rivers) {
      if (river.points.length < 2) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(river.points[0].x - startX, river.points[0].y - startY);
      for (let i = 1; i < river.points.length; i += 1) {
        ctx.lineTo(river.points[i].x - startX, river.points[i].y - startY);
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(9, 16, 24, 0.9)";
      ctx.lineWidth = river.width + 2.8;
      ctx.stroke();

      ctx.strokeStyle = "rgba(97, 169, 205, 0.9)";
      ctx.lineWidth = river.width;
      ctx.stroke();
    }
  }

  private drawForest(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    chunkSize: number,
    landUse: LandUseBlender
  ): void {
    const cellSize = this.config.vegetation.treeGridSize;
    const margin = this.config.vegetation.treeRenderMargin;
    const minCellX = floorDiv(startX - margin, cellSize);
    const maxCellX = floorDiv(startX + chunkSize + margin, cellSize);
    const minCellY = floorDiv(startY - margin, cellSize);
    const maxCellY = floorDiv(startY + chunkSize + margin, cellSize);
    const denseThreshold = this.config.vegetation.forestDenseThreshold;
    const minDensity = this.config.vegetation.forestMinDensity;

    const densePoints: { x: number; y: number; radius: number; alpha: number; shape: number }[] = [];
    const edgePoints: { x: number; y: number; radius: number; alpha: number; shape: number }[] = [];

    for (let gy = minCellY; gy <= maxCellY; gy += 1) {
      for (let gx = minCellX; gx <= maxCellX; gx += 1) {
        const baseHash = hashCoords(this.treeSeed, gx, gy);
        const jitterX = hashToUnit(mixUint32(baseHash ^ 0xa5b35721));
        const jitterY = hashToUnit(mixUint32(baseHash ^ 0xf12c9d43));
        const worldX = gx * cellSize + jitterX * cellSize;
        const worldY = gy * cellSize + jitterY * cellSize;
        const baseDensity = this.terrain.forestDensityAt(worldX, worldY);
        const density = landUse.forestSuitability(worldX, worldY, baseDensity);
        if (density < minDensity) {
          continue;
        }

        const chance = clamp((density - minDensity) / (1 - minDensity), 0, 1);
        const roll = hashToUnit(mixUint32(baseHash ^ 0x6d2b79f5));
        if (roll > chance * chance) {
          continue;
        }

        const radiusScale = hashToUnit(mixUint32(baseHash ^ 0x9e3779b9));
        const radius =
          lerp(this.config.vegetation.treeMinRadius, this.config.vegetation.treeMaxRadius, density) * (0.8 + radiusScale * 0.5);
        const shape = hashToUnit(mixUint32(baseHash ^ 0x4f1bbcdc));
        const localX = worldX - startX;
        const localY = worldY - startY;

        if (density >= denseThreshold) {
          densePoints.push({
            x: localX,
            y: localY,
            radius,
            alpha: clamp(0.32 + density * 0.34, 0.2, 0.7),
            shape
          });
        } else {
          edgePoints.push({
            x: localX,
            y: localY,
            radius: radius * 0.72,
            alpha: clamp(0.42 + density * 0.3, 0.25, 0.7),
            shape
          });
        }
      }
    }

    for (const tree of densePoints) {
      this.drawTreeSymbol(ctx, tree.x, tree.y, tree.radius, tree.shape, `rgba(83, 122, 103, ${tree.alpha.toFixed(3)})`);
    }

    ctx.lineWidth = 1;
    for (const tree of edgePoints) {
      this.drawTreeSymbol(ctx, tree.x, tree.y, tree.radius, tree.shape, `rgba(126, 169, 145, ${tree.alpha.toFixed(3)})`);
    }
  }

  private drawFields(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    chunkSize: number,
    features: SettlementFeatures,
    landUse: LandUseBlender
  ): void {
    const margin = 44;
    const minX = -margin;
    const minY = -margin;
    const maxX = chunkSize + margin;
    const maxY = chunkSize + margin;
    const slotsPerVillage = 18;

    for (const village of features.villages) {
      const ringMin = village.radius * 1.08;
      const ringMax = village.radius * 2.28;
      for (let slot = 0; slot < slotsPerVillage; slot += 1) {
        const baseHash = hashCoords(this.fieldSeed, village.cellX * 97 + slot * 13, village.cellY * 89 + slot * 17);
        const angle = hashToUnit(baseHash) * Math.PI * 2;
        const distance = lerp(ringMin, ringMax, hashToUnit(mixUint32(baseHash ^ 0x9e3779b9)));
        const jitter = lerp(-20, 20, hashToUnit(mixUint32(baseHash ^ 0x7f4a7c15)));
        const x = village.x + Math.cos(angle) * distance + Math.cos(angle + Math.PI * 0.5) * jitter;
        const y = village.y + Math.sin(angle) * distance + Math.sin(angle + Math.PI * 0.5) * jitter;
        const fieldSuitability = landUse.fieldSuitabilityForVillage(x, y, village);
        if (fieldSuitability < 0.22) {
          continue;
        }
        const fieldRoll = hashToUnit(mixUint32(baseHash ^ 0x1b873593));
        if (fieldRoll > fieldSuitability) {
          continue;
        }

        const width = lerp(26, 68, hashToUnit(mixUint32(baseHash ^ 0xd1b54a35)));
        const depth = lerp(16, 40, hashToUnit(mixUint32(baseHash ^ 0x94d049bb)));
        const nearRoadDistance = Math.max(width, depth) * 0.55 + 7;
        if (this.pointNearRoad(x, y, features.roads, nearRoadDistance)) {
          continue;
        }

        const localX = x - startX;
        const localY = y - startY;
        if (localX < minX || localY < minY || localX > maxX || localY > maxY) {
          continue;
        }

        const tone = hashToUnit(mixUint32(baseHash ^ 0x85ebca6b));
        const rowTone = hashToUnit(mixUint32(baseHash ^ 0xc2b2ae35));
        const rotation = angle + lerp(-0.6, 0.6, hashToUnit(mixUint32(baseHash ^ 0x27d4eb2f)));
        const fillR = Math.round(lerp(173, 208, tone));
        const fillG = Math.round(lerp(162, 194, tone));
        const fillB = Math.round(lerp(126, 148, tone));

        ctx.save();
        ctx.translate(localX, localY);
        ctx.rotate(rotation);
        ctx.fillStyle = `rgba(${fillR}, ${fillG}, ${fillB}, 0.36)`;
        ctx.strokeStyle = `rgba(${Math.max(0, fillR - 70)}, ${Math.max(0, fillG - 62)}, ${Math.max(0, fillB - 48)}, 0.56)`;
        ctx.lineWidth = 1.3;
        ctx.fillRect(-width * 0.5, -depth * 0.5, width, depth);
        ctx.strokeRect(-width * 0.5, -depth * 0.5, width, depth);

        const furrowCount = Math.max(2, Math.floor(depth / 6));
        const rowAlpha = lerp(0.22, 0.36, rowTone);
        ctx.strokeStyle = `rgba(104, 84, 52, ${rowAlpha.toFixed(3)})`;
        ctx.lineWidth = 1.1;
        for (let i = 1; i < furrowCount; i += 1) {
          const fy = -depth * 0.5 + (depth * i) / furrowCount;
          ctx.beginPath();
          ctx.moveTo(-width * 0.45, fy);
          ctx.lineTo(width * 0.45, fy);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  private drawTreeSymbol(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    shape: number,
    fillStyle: string
  ): void {
    const canopyRadius = Math.max(2.4, radius);
    const lobeCount = 4 + Math.floor(shape * 3);
    const angleOffset = shape * Math.PI * 2;
    const trunkHeight = Math.max(2, canopyRadius * 0.45);
    const trunkWidth = Math.max(1.2, canopyRadius * 0.26);

    ctx.fillStyle = "rgba(19, 27, 24, 0.24)";
    ctx.beginPath();
    ctx.ellipse(x + canopyRadius * 0.24, y + canopyRadius * 0.54, canopyRadius * 0.72, canopyRadius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(76, 59, 45, 0.9)";
    ctx.fillRect(x - trunkWidth * 0.5, y + canopyRadius * 0.18, trunkWidth, trunkHeight);

    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    for (let i = 0; i < lobeCount; i += 1) {
      const angle = angleOffset + (i / lobeCount) * Math.PI * 2;
      const lobeRadius = canopyRadius * (0.8 + ((i + 1) % 2) * 0.2);
      const px = x + Math.cos(angle) * lobeRadius * 0.42;
      const py = y - canopyRadius * 0.1 + Math.sin(angle) * lobeRadius * 0.35;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(14, 18, 16, 0.9)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  private pointNearRoad(x: number, y: number, roads: Road[], distance: number): boolean {
    const distanceSq = distance * distance;
    for (const road of roads) {
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const d2 = this.distanceSqToSegment(x, y, a.x, a.y, b.x, b.y);
        const widthPad = road.width + 2;
        if (d2 <= distanceSq + widthPad * widthPad) {
          return true;
        }
      }
    }
    return false;
  }

  private distanceSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const vx = bx - ax;
    const vy = by - ay;
    const lenSq = vx * vx + vy * vy;
    if (lenSq <= 1e-6) {
      const dx = px - ax;
      const dy = py - ay;
      return dx * dx + dy * dy;
    }
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / lenSq, 0, 1);
    const qx = ax + vx * t;
    const qy = ay + vy * t;
    const dx = px - qx;
    const dy = py - qy;
    return dx * dx + dy * dy;
  }

  private drawRoadsAndVillages(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    features: SettlementFeatures,
    rivers: RiverPath[]
  ): void {
    if (!this.debug.showRoads && !this.debug.showVillages) {
      return;
    }

    if (this.debug.showRoads) {
      for (const road of features.roads) {
        if (road.points.length < 2) {
          continue;
        }
        this.drawRoadSegments(ctx, road, startX, startY, rivers);
      }
    }

    if (this.debug.showVillages) {
      this.drawVillageMarkers(ctx, startX, startY, features.villages);
    }
  }

  private drawRoadSegments(
    ctx: CanvasRenderingContext2D,
    road: Road,
    startX: number,
    startY: number,
    rivers: RiverPath[]
  ): void {
    let drawing = false;
    let drewAny = false;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      if (this.roadSegmentNearRiver(a.x, a.y, b.x, b.y, road.width, rivers)) {
        if (drawing) {
          this.strokeRoadPath(ctx, road);
          drewAny = true;
        }
        drawing = false;
        continue;
      }

      const ax = a.x - startX;
      const ay = a.y - startY;
      const bx = b.x - startX;
      const by = b.y - startY;
      if (!drawing) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        drawing = true;
      }
      ctx.lineTo(bx, by);
    }

    if (drawing) {
      this.strokeRoadPath(ctx, road);
      drewAny = true;
    }

    if (!drewAny) {
      return;
    }
  }

  private strokeRoadPath(ctx: CanvasRenderingContext2D, road: Road): void {

    ctx.strokeStyle = "rgba(8, 10, 11, 0.88)";
    ctx.lineWidth = road.width + (road.type === "local" ? 2.2 : 2.9);
    ctx.stroke();

    ctx.strokeStyle =
      road.type === "major"
        ? "rgba(223, 211, 169, 0.98)"
        : road.type === "minor"
          ? "rgba(210, 201, 163, 0.96)"
          : "rgba(205, 198, 170, 0.94)";
    ctx.lineWidth = road.width;
    ctx.stroke();
  }

  private roadSegmentNearRiver(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    roadWidth: number,
    rivers: RiverPath[]
  ): boolean {
    for (const river of rivers) {
      for (let i = 1; i < river.points.length; i += 1) {
        const ra = river.points[i - 1];
        const rb = river.points[i];
        const d2a = this.distanceSqToSegment(ax, ay, ra.x, ra.y, rb.x, rb.y);
        const d2b = this.distanceSqToSegment(bx, by, ra.x, ra.y, rb.x, rb.y);
        const threshold = river.width * 0.46 + roadWidth * 0.78;
        if (d2a <= threshold * threshold || d2b <= threshold * threshold) {
          return true;
        }
      }
    }
    return false;
  }

  private drawVillageMarkers(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    villages: Village[]
  ): void {
    for (const village of villages) {
      const x = village.x - startX;
      const y = village.y - startY;
      const radius = clamp(village.radius * 0.07, 3, 6);
      ctx.fillStyle = "rgba(244, 230, 186, 0.92)";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(10, 14, 12, 0.9)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x - radius * 1.4, y);
      ctx.lineTo(x + radius * 1.4, y);
      ctx.moveTo(x, y - radius * 1.4);
      ctx.lineTo(x, y + radius * 1.4);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private drawParcels(ctx: CanvasRenderingContext2D, startX: number, startY: number, parcels: Parcel[]): void {
    if (!this.debug.showParcels) {
      return;
    }

    for (const parcel of parcels) {
      const x = parcel.x - startX;
      const y = parcel.y - startY;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(parcel.angle);
      ctx.fillStyle = "rgba(211, 218, 167, 0.28)";
      ctx.strokeStyle = "rgba(11, 15, 13, 0.82)";
      ctx.lineWidth = 1.2;
      ctx.fillRect(-parcel.width * 0.5, -parcel.depth * 0.5, parcel.width, parcel.depth);
      ctx.strokeRect(-parcel.width * 0.5, -parcel.depth * 0.5, parcel.width, parcel.depth);
      ctx.restore();
    }
  }

  private drawHouses(ctx: CanvasRenderingContext2D, startX: number, startY: number, features: SettlementFeatures): void {
    if (!this.debug.showHouses) {
      return;
    }

    for (const house of features.houses) {
      this.drawHouse(ctx, startX, startY, house);
    }
  }

  private drawHouse(ctx: CanvasRenderingContext2D, startX: number, startY: number, house: House): void {
    const x = house.x - startX;
    const y = house.y - startY;
    const roofPalette = [
      { roof: "#907367", wall: "#c3b59d" },
      { roof: "#6f7680", wall: "#b7b8b0" },
      { roof: "#8f6654", wall: "#c2b19e" },
      { roof: "#7d6f5f", wall: "#bbb09f" }
    ];
    const palette = roofPalette[house.roofStyle % roofPalette.length];

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(house.angle);

    ctx.fillStyle = "rgba(25, 33, 38, 0.2)";
    ctx.fillRect(-house.width * 0.55 + 1.5, -house.depth * 0.5 + 2.5, house.width, house.depth);

    ctx.fillStyle = palette.wall;
    ctx.strokeStyle = "rgba(8, 10, 10, 0.9)";
    ctx.lineWidth = 1.3;
    ctx.fillRect(-house.width * 0.5, -house.depth * 0.5, house.width, house.depth);
    ctx.strokeRect(-house.width * 0.5, -house.depth * 0.5, house.width, house.depth);

    ctx.fillStyle = palette.roof;
    ctx.fillRect(-house.width * 0.6, -house.depth * 0.52, house.width * 1.2, house.depth * 0.58);
    ctx.strokeRect(-house.width * 0.6, -house.depth * 0.52, house.width * 1.2, house.depth * 0.58);

    ctx.strokeStyle = "rgba(14, 11, 9, 0.64)";
    ctx.beginPath();
    ctx.moveTo(-house.width * 0.55, -house.depth * 0.4);
    ctx.lineTo(house.width * 0.55, -house.depth * 0.4);
    ctx.stroke();

    ctx.restore();
  }
}

import { DebugLayerConfig, WorldConfig } from "../../gen/config";
import { hashCoords, hashToUnit, mixUint32 } from "../../gen/hash";
import { RiverPath } from "../../gen/rivers";
import { House, Parcel, Road, SettlementFeatures, SettlementSystem, Village } from "../../gen/settlements";
import { TerrainSampler } from "../../gen/terrain";
import { clamp, floorDiv, lerp } from "../../util/math";
import { LandUseBlender } from "./land-use-blender";
import { SuperchunkFeatureCache } from "./superchunk-feature-cache";

type DenseTreePoint = {
  gx: number;
  gy: number;
  x: number;
  y: number;
  radius: number;
  alpha: number;
  shape: number;
};

type EdgeTreePoint = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  shape: number;
};

type BridgeSpan = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
};

export class FeatureOverlayRenderer {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly debug: DebugLayerConfig;
  private readonly treeSeed: number;
  private readonly fieldSeed: number;
  private readonly superchunkCache: SuperchunkFeatureCache;

  constructor(
    config: WorldConfig,
    terrain: TerrainSampler,
    settlements: SettlementSystem,
    debug: DebugLayerConfig,
    treeSeed: number,
    fieldSeed: number
  ) {
    this.config = config;
    this.terrain = terrain;
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
    chunkSize: number,
    rivers: RiverPath[]
  ): void {
    const maskMode = this.debug.showWaterMask || this.debug.showMoisture || this.debug.showForestMask;
    if (maskMode) {
      return;
    }

    const features = this.superchunkCache.getFeaturesForChunk(chunkX, chunkY);
    const landUse = new LandUseBlender(this.config, this.terrain, features);

    this.drawFields(ctx, startX, startY, chunkSize, features, landUse);
    this.drawRoadsAndVillages(ctx, startX, startY, features, rivers);
    this.drawParcels(ctx, startX, startY, features.parcels);
    this.drawHouses(ctx, startX, startY, features);
    this.drawForest(ctx, startX, startY, chunkSize, landUse);
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

    const densePoints: DenseTreePoint[] = [];
    const edgePoints: EdgeTreePoint[] = [];

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
            gx,
            gy,
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

    const denseComponents = this.groupDenseTrees(densePoints);
    const borderTrees: EdgeTreePoint[] = [...edgePoints];
    for (const component of denseComponents) {
      if (component.length < 5) {
        for (const tree of component) {
          borderTrees.push({
            x: tree.x,
            y: tree.y,
            radius: tree.radius * 0.88,
            alpha: clamp(tree.alpha + 0.08, 0.35, 0.78),
            shape: tree.shape
          });
        }
        continue;
      }

      this.drawDenseForestMass(ctx, component);
      const keySet = new Set(component.map((tree) => `${tree.gx},${tree.gy}`));
      for (const tree of component) {
        if (!this.isDenseBoundaryTree(tree.gx, tree.gy, keySet)) {
          continue;
        }
        borderTrees.push({
          x: tree.x,
          y: tree.y,
          radius: tree.radius * 0.82,
          alpha: clamp(tree.alpha + 0.14, 0.38, 0.84),
          shape: tree.shape
        });
      }
    }

    for (const tree of borderTrees) {
      this.drawTreeSymbol(ctx, tree.x, tree.y, tree.radius, tree.shape, `rgba(119, 161, 141, ${tree.alpha.toFixed(3)})`);
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
    const blobRadius = canopyRadius * 0.58;

    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    for (let i = 0; i < lobeCount; i += 1) {
      const angle = angleOffset + (i / lobeCount) * Math.PI * 2;
      const lobeRadius = canopyRadius * (0.84 + ((i + 1) % 2) * 0.18);
      const px = x + Math.cos(angle) * lobeRadius * 0.5;
      const py = y + Math.sin(angle) * lobeRadius * 0.42;
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

    ctx.fillStyle = "rgba(177, 205, 183, 0.34)";
    ctx.beginPath();
    ctx.arc(x - canopyRadius * 0.22, y - canopyRadius * 0.18, blobRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  private groupDenseTrees(points: DenseTreePoint[]): DenseTreePoint[][] {
    const byKey = new Map<string, DenseTreePoint>();
    for (const point of points) {
      byKey.set(`${point.gx},${point.gy}`, point);
    }
    const visited = new Set<string>();
    const groups: DenseTreePoint[][] = [];
    const neighbors = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1]
    ];

    for (const point of points) {
      const startKey = `${point.gx},${point.gy}`;
      if (visited.has(startKey)) {
        continue;
      }

      const queue = [point];
      visited.add(startKey);
      const component: DenseTreePoint[] = [];
      while (queue.length > 0) {
        const current = queue.pop();
        if (!current) {
          break;
        }
        component.push(current);
        for (const neighbor of neighbors) {
          const nx = current.gx + neighbor[0];
          const ny = current.gy + neighbor[1];
          const key = `${nx},${ny}`;
          if (visited.has(key)) {
            continue;
          }
          const next = byKey.get(key);
          if (!next) {
            continue;
          }
          visited.add(key);
          queue.push(next);
        }
      }
      groups.push(component);
    }

    return groups;
  }

  private isDenseBoundaryTree(gx: number, gy: number, componentKeys: Set<string>): boolean {
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) {
          continue;
        }
        if (!componentKeys.has(`${gx + ox},${gy + oy}`)) {
          return true;
        }
      }
    }
    return false;
  }

  private drawDenseForestMass(ctx: CanvasRenderingContext2D, component: DenseTreePoint[]): void {
    const centers = component.map((tree) => ({ x: tree.x, y: tree.y }));
    const hull = this.convexHull(centers);
    if (hull.length < 3) {
      return;
    }

    let cx = 0;
    let cy = 0;
    for (const point of hull) {
      cx += point.x;
      cy += point.y;
    }
    cx /= hull.length;
    cy /= hull.length;

    const avgRadius = component.reduce((sum, tree) => sum + tree.radius, 0) / component.length;
    const expanded = hull.map((point) => {
      const dx = point.x - cx;
      const dy = point.y - cy;
      const distance = Math.hypot(dx, dy);
      if (distance <= 1e-6) {
        return point;
      }
      const pad = Math.max(6, avgRadius * 0.95);
      return {
        x: point.x + (dx / distance) * pad,
        y: point.y + (dy / distance) * pad
      };
    });

    ctx.fillStyle = "rgba(84, 118, 103, 0.88)";
    ctx.strokeStyle = "rgba(11, 14, 12, 0.84)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < expanded.length; i += 1) {
      const current = expanded[i];
      const next = expanded[(i + 1) % expanded.length];
      const midX = (current.x + next.x) * 0.5;
      const midY = (current.y + next.y) * 0.5;
      if (i === 0) {
        ctx.moveTo(midX, midY);
      } else {
        ctx.quadraticCurveTo(current.x, current.y, midX, midY);
      }
    }
    const first = expanded[0];
    const second = expanded[1 % expanded.length];
    ctx.quadraticCurveTo(first.x, first.y, (first.x + second.x) * 0.5, (first.y + second.y) * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
    if (points.length < 4) {
      return points.slice();
    }

    const sorted = points
      .slice()
      .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const lower: { x: number; y: number }[] = [];
    for (const point of sorted) {
      while (lower.length >= 2 && this.cross2(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }

    const upper: { x: number; y: number }[] = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const point = sorted[i];
      while (upper.length >= 2 && this.cross2(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }

    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  private cross2(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
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
      const bridges: BridgeSpan[] = [];
      for (const road of features.roads) {
        if (road.points.length < 2) {
          continue;
        }
        this.drawRoadSegments(ctx, road, startX, startY, rivers, bridges);
      }
      if (bridges.length > 0) {
        this.drawBridges(ctx, startX, startY, bridges);
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
    rivers: RiverPath[],
    bridges: BridgeSpan[]
  ): void {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const cuts = this.collectBridgeCuts(a.x, a.y, b.x, b.y, road.width, rivers, bridges);
      if (cuts.length === 0) {
        this.strokeRoadSegment(ctx, road, a.x, a.y, b.x, b.y, startX, startY);
        continue;
      }

      let cursor = 0;
      for (const cut of cuts) {
        if (cut.startT > cursor + 0.03) {
          this.strokeRoadSegment(
            ctx,
            road,
            lerp(a.x, b.x, cursor),
            lerp(a.y, b.y, cursor),
            lerp(a.x, b.x, cut.startT),
            lerp(a.y, b.y, cut.startT),
            startX,
            startY
          );
        }
        cursor = Math.max(cursor, cut.endT);
      }

      if (cursor < 0.97) {
        this.strokeRoadSegment(
          ctx,
          road,
          lerp(a.x, b.x, cursor),
          lerp(a.y, b.y, cursor),
          b.x,
          b.y,
          startX,
          startY
        );
      }
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

  private strokeRoadSegment(
    ctx: CanvasRenderingContext2D,
    road: Road,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    startX: number,
    startY: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(ax - startX, ay - startY);
    ctx.lineTo(bx - startX, by - startY);
    this.strokeRoadPath(ctx, road);
  }

  private collectBridgeCuts(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    roadWidth: number,
    rivers: RiverPath[],
    bridges: BridgeSpan[]
  ): { startT: number; endT: number }[] {
    const segDx = bx - ax;
    const segDy = by - ay;
    const segLength = Math.hypot(segDx, segDy);
    if (segLength <= 1e-6) {
      return [];
    }

    const rawCuts: { startT: number; endT: number }[] = [];
    for (const river of rivers) {
      for (let i = 1; i < river.points.length; i += 1) {
        const ra = river.points[i - 1];
        const rb = river.points[i];
        const intersection = this.segmentIntersection(ax, ay, bx, by, ra.x, ra.y, rb.x, rb.y);
        if (!intersection) {
          continue;
        }
        const halfLength = clamp(river.width * 0.9 + roadWidth * 1.55, 6, 26);
        const bridgeStartT = clamp(intersection.t - halfLength / segLength, 0, 1);
        const bridgeEndT = clamp(intersection.t + halfLength / segLength, 0, 1);
        rawCuts.push({ startT: bridgeStartT, endT: bridgeEndT });

        const bridge = {
          x1: lerp(ax, bx, bridgeStartT),
          y1: lerp(ay, by, bridgeStartT),
          x2: lerp(ax, bx, bridgeEndT),
          y2: lerp(ay, by, bridgeEndT),
          width: roadWidth
        };
        if (!this.hasNearbyBridge(bridges, bridge)) {
          bridges.push(bridge);
        }
      }
    }

    const terrainWaterCut = this.sampleTerrainWaterCut(ax, ay, bx, by);
    if (terrainWaterCut) {
      rawCuts.push(terrainWaterCut);
      const bridge = {
        x1: lerp(ax, bx, terrainWaterCut.startT),
        y1: lerp(ay, by, terrainWaterCut.startT),
        x2: lerp(ax, bx, terrainWaterCut.endT),
        y2: lerp(ay, by, terrainWaterCut.endT),
        width: roadWidth
      };
      if (!this.hasNearbyBridge(bridges, bridge)) {
        bridges.push(bridge);
      }
    }

    if (rawCuts.length === 0) {
      return [];
    }

    rawCuts.sort((a, b) => a.startT - b.startT);
    const merged: { startT: number; endT: number }[] = [rawCuts[0]];
    for (let i = 1; i < rawCuts.length; i += 1) {
      const current = rawCuts[i];
      const tail = merged[merged.length - 1];
      if (current.startT <= tail.endT + 0.03) {
        tail.endT = Math.max(tail.endT, current.endT);
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  private sampleTerrainWaterCut(ax: number, ay: number, bx: number, by: number): { startT: number; endT: number } | null {
    const samples = 8;
    const threshold = 0.002;
    let runStart = -1;
    let runEnd = -1;

    for (let i = 1; i < samples; i += 1) {
      const t = i / samples;
      const x = lerp(ax, bx, t);
      const y = lerp(ay, by, t);
      const depth = this.terrain.sample(x, y).waterDepth;
      if (depth > threshold) {
        if (runStart < 0) {
          runStart = t;
        }
        runEnd = t;
      } else if (runStart >= 0) {
        break;
      }
    }

    if (runStart < 0 || runEnd < 0 || runEnd - runStart < 0.06) {
      return null;
    }
    return {
      startT: clamp(runStart - 0.08, 0, 1),
      endT: clamp(runEnd + 0.08, 0, 1)
    };
  }

  private segmentIntersection(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number
  ): { t: number; x: number; y: number } | null {
    const rX = bx - ax;
    const rY = by - ay;
    const sX = dx - cx;
    const sY = dy - cy;
    const denom = rX * sY - rY * sX;
    if (Math.abs(denom) <= 1e-6) {
      return null;
    }

    const qPx = cx - ax;
    const qPy = cy - ay;
    const t = (qPx * sY - qPy * sX) / denom;
    const u = (qPx * rY - qPy * rX) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) {
      return null;
    }

    return {
      t,
      x: ax + rX * t,
      y: ay + rY * t
    };
  }

  private hasNearbyBridge(existing: BridgeSpan[], candidate: BridgeSpan): boolean {
    const centerX = (candidate.x1 + candidate.x2) * 0.5;
    const centerY = (candidate.y1 + candidate.y2) * 0.5;
    for (const bridge of existing) {
      const bx = (bridge.x1 + bridge.x2) * 0.5;
      const by = (bridge.y1 + bridge.y2) * 0.5;
      if (Math.hypot(centerX - bx, centerY - by) < 5) {
        return true;
      }
    }
    return false;
  }

  private drawBridges(ctx: CanvasRenderingContext2D, startX: number, startY: number, bridges: BridgeSpan[]): void {
    for (const bridge of bridges) {
      const dx = bridge.x2 - bridge.x1;
      const dy = bridge.y2 - bridge.y1;
      const length = Math.hypot(dx, dy);
      if (length <= 1e-4) {
        continue;
      }

      const cx = (bridge.x1 + bridge.x2) * 0.5 - startX;
      const cy = (bridge.y1 + bridge.y2) * 0.5 - startY;
      const angle = Math.atan2(dy, dx);
      const deckWidth = bridge.width + 1.4;
      const railOffset = deckWidth * 0.46;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      ctx.strokeStyle = "rgba(10, 12, 12, 0.9)";
      ctx.lineWidth = deckWidth + 2.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-length * 0.5, 0);
      ctx.lineTo(length * 0.5, 0);
      ctx.stroke();

      ctx.strokeStyle = "rgba(216, 192, 152, 0.98)";
      ctx.lineWidth = deckWidth;
      ctx.beginPath();
      ctx.moveTo(-length * 0.5, 0);
      ctx.lineTo(length * 0.5, 0);
      ctx.stroke();

      ctx.strokeStyle = "rgba(13, 14, 13, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-length * 0.48, -railOffset);
      ctx.lineTo(length * 0.48, -railOffset);
      ctx.moveTo(-length * 0.48, railOffset);
      ctx.lineTo(length * 0.48, railOffset);
      ctx.stroke();

      ctx.strokeStyle = "rgba(76, 57, 37, 0.46)";
      for (let x = -length * 0.5 + 2; x < length * 0.5 - 2; x += 4) {
        ctx.beginPath();
        ctx.moveTo(x, -deckWidth * 0.4);
        ctx.lineTo(x, deckWidth * 0.4);
        ctx.stroke();
      }
      ctx.restore();
    }
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

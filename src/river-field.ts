import { V3_LAKE_CONFIG, V3_RIVER_CONFIG } from "./config";
import { hashCoords, hashString, hashToUnit } from "./lib/hash";
import { clamp, lerp, smoothstep } from "./lib/math";
import { Point, TerrainFeatureSample } from "./types";

type LakeCandidate = {
  id: string;
  cellX: number;
  cellY: number;
  centerX: number;
  centerY: number;
  radius: number;
};

type RiverEdge = {
  id: string;
  width: number;
  points: Point[];
};

export class V3RiverField {
  private readonly lakePresenceSeed: number;
  private readonly lakeLayoutSeed: number;
  private readonly lakeRadiusSeed: number;
  private readonly edgeStyleSeed: number;
  private readonly optionalLinkSeed: number;
  private readonly lakeCellCache = new Map<string, LakeCandidate | null>();
  private readonly edgeCache = new Map<string, RiverEdge>();
  private readonly lakeEdgeCache = new Map<string, RiverEdge[]>();

  constructor(seed: string) {
    this.lakePresenceSeed = hashString(`${seed}:v3:lake:presence`);
    this.lakeLayoutSeed = hashString(`${seed}:v3:lake:layout`);
    this.lakeRadiusSeed = hashString(`${seed}:v3:lake:radius`);
    this.edgeStyleSeed = hashString(`${seed}:v3:river:edge-style`);
    this.optionalLinkSeed = hashString(`${seed}:v3:river:optional-link`);
  }

  sampleAt(x: number, y: number): TerrainFeatureSample {
    const nearbyLakes = this.collectNearbyLakes(x, y, 2);
    const lakeMask = this.sampleLakeMask(x, y, nearbyLakes);
    const nearbyEdges = this.collectNearbyEdges(x, y, 2);
    const riverMask = this.sampleRiverMask(x, y, nearbyEdges);
    const waterMask = Math.max(lakeMask, riverMask);
    if (waterMask < V3_RIVER_CONFIG.kindThreshold) {
      return { kind: "none", lakeMask, riverMask, waterMask };
    }
    return {
      kind: lakeMask >= riverMask ? "lake" : "river",
      lakeMask,
      riverMask,
      waterMask
    };
  }

  private sampleLakeMask(x: number, y: number, lakes: LakeCandidate[]): number {
    let mask = 0;
    for (const lake of lakes) {
      const distance = Math.hypot(x - lake.centerX, y - lake.centerY);
      const contribution =
        1 - smoothstep(lake.radius, lake.radius + V3_LAKE_CONFIG.edgeFeather, distance);
      if (contribution > mask) {
        mask = contribution;
      }
    }
    return clamp(mask, 0, 1);
  }

  private sampleRiverMask(x: number, y: number, edges: RiverEdge[]): number {
    let mask = 0;
    for (const edge of edges) {
      const distance = this.distanceToPolyline(x, y, edge.points);
      const contribution =
        1 - smoothstep(edge.width, edge.width + V3_RIVER_CONFIG.edgeFeather, distance);
      if (contribution > mask) {
        mask = contribution;
      }
    }
    return clamp(mask, 0, 1);
  }

  private collectNearbyLakes(x: number, y: number, cellRadius: number): LakeCandidate[] {
    const cellSize = V3_LAKE_CONFIG.cellSize;
    const baseCellX = Math.floor(x / cellSize);
    const baseCellY = Math.floor(y / cellSize);
    const lakes: LakeCandidate[] = [];
    for (let oy = -cellRadius; oy <= cellRadius; oy += 1) {
      for (let ox = -cellRadius; ox <= cellRadius; ox += 1) {
        const candidate = this.resolveLakeCandidate(baseCellX + ox, baseCellY + oy);
        if (!candidate) {
          continue;
        }
        lakes.push(candidate);
      }
    }
    return lakes;
  }

  private collectNearbyEdges(x: number, y: number, cellRadius: number): RiverEdge[] {
    const nearbyLakes = this.collectNearbyLakes(x, y, cellRadius + V3_RIVER_CONFIG.linkSearchRadiusCells);
    const uniqueEdges = new Map<string, RiverEdge>();
    for (const lake of nearbyLakes) {
      const edges = this.resolveEdgesForLake(lake);
      for (const edge of edges) {
        uniqueEdges.set(edge.id, edge);
      }
    }
    return [...uniqueEdges.values()];
  }

  private resolveEdgesForLake(lake: LakeCandidate): RiverEdge[] {
    const cached = this.lakeEdgeCache.get(lake.id);
    if (cached) {
      return cached;
    }

    const neighbors = this.collectNearbyLakesByCell(
      lake.cellX,
      lake.cellY,
      V3_RIVER_CONFIG.linkSearchRadiusCells
    )
      .filter((candidate) => candidate.id !== lake.id)
      .map((candidate) => ({
        candidate,
        distance: Math.hypot(candidate.centerX - lake.centerX, candidate.centerY - lake.centerY)
      }))
      .filter((entry) => entry.distance <= V3_RIVER_CONFIG.maxLinkDistance)
      .sort((a, b) => a.distance - b.distance);

    if (neighbors.length === 0) {
      this.lakeEdgeCache.set(lake.id, []);
      return [];
    }

    const edges: RiverEdge[] = [];
    edges.push(this.resolveEdge(lake, neighbors[0].candidate));
    for (let i = 1; i < Math.min(4, neighbors.length); i += 1) {
      const neighbor = neighbors[i].candidate;
      const chance = hashToUnit(hashCoords(this.optionalLinkSeed, this.lakeIdToInt(lake.id), this.lakeIdToInt(neighbor.id)));
      if (chance <= V3_RIVER_CONFIG.optionalLinkChance) {
        edges.push(this.resolveEdge(lake, neighbor));
      }
    }

    this.lakeEdgeCache.set(lake.id, edges);
    return edges;
  }

  private resolveEdge(a: LakeCandidate, b: LakeCandidate): RiverEdge {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    const cached = this.edgeCache.get(key);
    if (cached) {
      return cached;
    }

    const hashA = this.lakeIdToInt(a.id);
    const hashB = this.lakeIdToInt(b.id);
    const widthScale = lerp(
      1 - V3_RIVER_CONFIG.widthJitter,
      1 + V3_RIVER_CONFIG.widthJitter,
      hashToUnit(hashCoords(this.edgeStyleSeed, hashA, hashB, 1))
    );
    const amplitude = lerp(
      V3_RIVER_CONFIG.meanderAmplitudeMin,
      V3_RIVER_CONFIG.meanderAmplitudeMax,
      hashToUnit(hashCoords(this.edgeStyleSeed, hashA, hashB, 2))
    );
    const waveCount = Math.max(
      1,
      Math.round(lerp(1, 3, hashToUnit(hashCoords(this.edgeStyleSeed, hashA, hashB, 3))))
    );
    const phase = hashToUnit(hashCoords(this.edgeStyleSeed, hashA, hashB, 4)) * Math.PI * 2;
    const points = this.buildEdgePolyline(a, b, amplitude, waveCount, phase);
    const edge: RiverEdge = {
      id: key,
      width: V3_RIVER_CONFIG.mandatoryWidth * widthScale,
      points
    };
    this.edgeCache.set(key, edge);
    return edge;
  }

  private buildEdgePolyline(
    a: LakeCandidate,
    b: LakeCandidate,
    amplitude: number,
    waveCount: number,
    phase: number
  ): Point[] {
    const dx = b.centerX - a.centerX;
    const dy = b.centerY - a.centerY;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-6) {
      return [
        { x: a.centerX, y: a.centerY },
        { x: b.centerX, y: b.centerY }
      ];
    }

    const segmentCount = Math.max(4, Math.ceil(distance / V3_RIVER_CONFIG.segmentLength));
    const nx = -dy / distance;
    const ny = dx / distance;
    const points: Point[] = [];
    for (let i = 0; i <= segmentCount; i += 1) {
      const t = i / segmentCount;
      const baseX = lerp(a.centerX, b.centerX, t);
      const baseY = lerp(a.centerY, b.centerY, t);
      const envelope = Math.sin(Math.PI * t);
      const meander = Math.sin(t * waveCount * Math.PI * 2 + phase) * amplitude * envelope;
      points.push({
        x: baseX + nx * meander,
        y: baseY + ny * meander
      });
    }
    return points;
  }

  private collectNearbyLakesByCell(cellX: number, cellY: number, radius: number): LakeCandidate[] {
    const lakes: LakeCandidate[] = [];
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        const lake = this.resolveLakeCandidate(cellX + ox, cellY + oy);
        if (!lake) {
          continue;
        }
        lakes.push(lake);
      }
    }
    return lakes;
  }

  private resolveLakeCandidate(cellX: number, cellY: number): LakeCandidate | null {
    const key = `${cellX}:${cellY}`;
    const cached = this.lakeCellCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const presence = hashToUnit(hashCoords(this.lakePresenceSeed, cellX, cellY));
    if (presence > V3_LAKE_CONFIG.lakeChance) {
      this.lakeCellCache.set(key, null);
      return null;
    }

    const jitterRange = 0.5 * V3_LAKE_CONFIG.jitter;
    const jx = hashToUnit(hashCoords(this.lakeLayoutSeed, cellX, cellY, 1));
    const jy = hashToUnit(hashCoords(this.lakeLayoutSeed, cellX, cellY, 2));
    const fx = 0.5 + (jx * 2 - 1) * jitterRange;
    const fy = 0.5 + (jy * 2 - 1) * jitterRange;
    const radius = lerp(
      V3_LAKE_CONFIG.radiusMin,
      V3_LAKE_CONFIG.radiusMax,
      hashToUnit(hashCoords(this.lakeRadiusSeed, cellX, cellY, 3))
    );
    if (radius < V3_LAKE_CONFIG.largeLakeMinRadius) {
      this.lakeCellCache.set(key, null);
      return null;
    }

    const candidate: LakeCandidate = {
      id: key,
      cellX,
      cellY,
      centerX: (cellX + fx) * V3_LAKE_CONFIG.cellSize,
      centerY: (cellY + fy) * V3_LAKE_CONFIG.cellSize,
      radius
    };
    this.lakeCellCache.set(key, candidate);
    return candidate;
  }

  private lakeIdToInt(lakeId: string): number {
    let hash = 2166136261;
    for (let i = 0; i < lakeId.length; i += 1) {
      hash ^= lakeId.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash | 0;
  }

  private distanceToPolyline(x: number, y: number, points: Point[]): number {
    if (points.length < 2) {
      return Number.POSITIVE_INFINITY;
    }
    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const distance = this.distanceToSegment(x, y, a.x, a.y, b.x, b.y);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    return minDistance;
  }

  private distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 1e-6) {
      return Math.hypot(px - ax, py - ay);
    }
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
    const sx = ax + dx * t;
    const sy = ay + dy * t;
    return Math.hypot(px - sx, py - sy);
  }
}

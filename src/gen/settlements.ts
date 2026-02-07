import { clamp, lerp, smoothstep } from "../util/math";
import { WorldConfig } from "./config";
import { hashCoords, hashString, hashToUnit, mixUint32 } from "./hash";
import { TerrainSampler } from "./terrain";

export type Village = {
  id: string;
  x: number;
  y: number;
  score: number;
  radius: number;
  cellX: number;
  cellY: number;
};

export type RoadType = "major" | "minor";

export type Road = {
  id: string;
  type: RoadType;
  width: number;
  points: { x: number; y: number }[];
  fromVillageId: string;
  toVillageId: string;
};

export type House = {
  id: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  angle: number;
  roofStyle: number;
};

export type SettlementFeatures = {
  villages: Village[];
  roads: Road[];
  houses: House[];
};

type VillageCandidate = {
  id: string;
  cellX: number;
  cellY: number;
  x: number;
  y: number;
  score: number;
  coastDistance: number;
  tieBreaker: number;
};

type RegionFeatures = SettlementFeatures;

type EdgeCandidate = {
  a: Village;
  b: Village;
  id: string;
  weight: number;
  distance: number;
};

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = new Array(size);
    this.rank = new Array(size);
    for (let i = 0; i < size; i += 1) {
      this.parent[i] = i;
      this.rank[i] = 0;
    }
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  union(a: number, b: number): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return false;
    }

    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] += 1;
    }
    return true;
  }
}

const regionKey = (x: number, y: number): string => `${x},${y}`;

const pointInRect = (x: number, y: number, minX: number, maxX: number, minY: number, maxY: number): boolean => {
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
};

const roadIntersectsBounds = (
  road: Road,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean => {
  for (const point of road.points) {
    if (pointInRect(point.x, point.y, minX, maxX, minY, maxY)) {
      return true;
    }
  }
  return false;
};

const roadMidpoint = (road: Road): { x: number; y: number } => {
  let totalLength = 0;
  for (let i = 1; i < road.points.length; i += 1) {
    const dx = road.points[i].x - road.points[i - 1].x;
    const dy = road.points[i].y - road.points[i - 1].y;
    totalLength += Math.hypot(dx, dy);
  }

  if (totalLength < 1) {
    return road.points[0];
  }

  let remaining = totalLength * 0.5;
  for (let i = 1; i < road.points.length; i += 1) {
    const a = road.points[i - 1];
    const b = road.points[i];
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= segmentLength) {
      const t = remaining / segmentLength;
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t)
      };
    }
    remaining -= segmentLength;
  }

  return road.points[road.points.length - 1];
};

export class SettlementSystem {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly villageSeed: number;
  private readonly roadSeed: number;
  private readonly houseSeed: number;
  private readonly candidateCache = new Map<string, VillageCandidate>();
  private readonly regionCache = new Map<string, RegionFeatures>();
  private readonly maxCachedRegions = 220;
  private readonly maxCachedCandidates = 28000;

  constructor(config: WorldConfig, terrain: TerrainSampler) {
    this.config = config;
    this.terrain = terrain;
    this.villageSeed = hashString(`${config.seed}:villages`);
    this.roadSeed = hashString(`${config.seed}:roads`);
    this.houseSeed = hashString(`${config.seed}:houses`);
  }

  getFeaturesForBounds(minX: number, maxX: number, minY: number, maxY: number): SettlementFeatures {
    const regionSize = this.config.roads.regionSize;
    const minRegionX = Math.floor(minX / regionSize) - 1;
    const maxRegionX = Math.floor(maxX / regionSize) + 1;
    const minRegionY = Math.floor(minY / regionSize) - 1;
    const maxRegionY = Math.floor(maxY / regionSize) + 1;

    const villagesById = new Map<string, Village>();
    const roadsById = new Map<string, Road>();
    const housesById = new Map<string, House>();

    for (let regionY = minRegionY; regionY <= maxRegionY; regionY += 1) {
      for (let regionX = minRegionX; regionX <= maxRegionX; regionX += 1) {
        const region = this.getRegion(regionX, regionY);

        for (const village of region.villages) {
          if (pointInRect(village.x, village.y, minX, maxX, minY, maxY)) {
            villagesById.set(village.id, village);
          }
        }
        for (const road of region.roads) {
          if (roadIntersectsBounds(road, minX, maxX, minY, maxY)) {
            roadsById.set(road.id, road);
          }
        }
        for (const house of region.houses) {
          if (pointInRect(house.x, house.y, minX, maxX, minY, maxY)) {
            housesById.set(house.id, house);
          }
        }
      }
    }

    return {
      villages: Array.from(villagesById.values()),
      roads: Array.from(roadsById.values()),
      houses: Array.from(housesById.values())
    };
  }

  clear(): void {
    this.regionCache.clear();
    this.candidateCache.clear();
  }

  private getRegion(regionX: number, regionY: number): RegionFeatures {
    const key = regionKey(regionX, regionY);
    const cached = this.regionCache.get(key);
    if (cached) {
      return cached;
    }

    const generated = this.generateRegion(regionX, regionY);
    this.regionCache.set(key, generated);
    this.pruneRegionCache();
    return generated;
  }

  private generateRegion(regionX: number, regionY: number): RegionFeatures {
    const regionSize = this.config.roads.regionSize;
    const coreMinX = regionX * regionSize;
    const coreMinY = regionY * regionSize;
    const coreMaxX = coreMinX + regionSize;
    const coreMaxY = coreMinY + regionSize;
    const margin = this.config.roads.maxConnectionDistance + this.config.settlement.cellSize;
    const villages = this.collectVillagesInBounds(coreMinX - margin, coreMaxX + margin, coreMinY - margin, coreMaxY + margin);
    const roads = this.buildRoadNetwork(villages);
    const houses = this.generateHouses(roads);

    const regionRoads = roads.filter((road) => {
      const mid = roadMidpoint(road);
      return pointInRect(mid.x, mid.y, coreMinX, coreMaxX, coreMinY, coreMaxY);
    });

    const regionHouses = houses.filter((house) => pointInRect(house.x, house.y, coreMinX, coreMaxX, coreMinY, coreMaxY));
    const regionVillages = villages.filter((village) => pointInRect(village.x, village.y, coreMinX, coreMaxX, coreMinY, coreMaxY));

    return {
      villages: regionVillages,
      roads: regionRoads,
      houses: regionHouses
    };
  }

  private pruneRegionCache(): void {
    if (this.regionCache.size <= this.maxCachedRegions) {
      return;
    }
    const overflow = this.regionCache.size - this.maxCachedRegions;
    const keys = this.regionCache.keys();
    for (let i = 0; i < overflow; i += 1) {
      const next = keys.next();
      if (next.done) {
        break;
      }
      this.regionCache.delete(next.value);
    }
  }

  private pruneCandidateCache(): void {
    if (this.candidateCache.size <= this.maxCachedCandidates) {
      return;
    }
    const overflow = this.candidateCache.size - this.maxCachedCandidates;
    const keys = this.candidateCache.keys();
    for (let i = 0; i < overflow; i += 1) {
      const next = keys.next();
      if (next.done) {
        break;
      }
      this.candidateCache.delete(next.value);
    }
  }

  private collectVillagesInBounds(minX: number, maxX: number, minY: number, maxY: number): Village[] {
    const cellSize = this.config.settlement.cellSize;
    const minCellX = Math.floor(minX / cellSize) - 1;
    const maxCellX = Math.floor(maxX / cellSize) + 1;
    const minCellY = Math.floor(minY / cellSize) - 1;
    const maxCellY = Math.floor(maxY / cellSize) + 1;
    const villages: Village[] = [];

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const village = this.villageAtCell(cellX, cellY);
        if (!village) {
          continue;
        }
        if (pointInRect(village.x, village.y, minX, maxX, minY, maxY)) {
          villages.push(village);
        }
      }
    }

    return villages;
  }

  private villageAtCell(cellX: number, cellY: number): Village | null {
    const candidate = this.candidateAt(cellX, cellY);
    if (candidate.score < this.config.settlement.suitabilityThreshold) {
      return null;
    }

    const minDistance = this.config.settlement.minVillageDistance;
    const minDistanceSquared = minDistance * minDistance;
    const neighborRange = Math.max(1, Math.ceil(minDistance / this.config.settlement.cellSize) + 1);

    for (let ny = cellY - neighborRange; ny <= cellY + neighborRange; ny += 1) {
      for (let nx = cellX - neighborRange; nx <= cellX + neighborRange; nx += 1) {
        if (nx === cellX && ny === cellY) {
          continue;
        }
        const other = this.candidateAt(nx, ny);
        if (other.score < this.config.settlement.suitabilityThreshold) {
          continue;
        }
        const dx = other.x - candidate.x;
        const dy = other.y - candidate.y;
        if (dx * dx + dy * dy > minDistanceSquared) {
          continue;
        }
        if (other.score > candidate.score) {
          return null;
        }
        if (other.score === candidate.score && other.tieBreaker > candidate.tieBreaker) {
          return null;
        }
      }
    }

    const sizeNoise = hashToUnit(hashCoords(this.villageSeed, cellX, cellY, 223));
    const radius = lerp(44, 92, clamp(candidate.score * 0.65 + sizeNoise * 0.35, 0, 1));

    return {
      id: candidate.id,
      x: candidate.x,
      y: candidate.y,
      score: candidate.score,
      radius,
      cellX,
      cellY
    };
  }

  private candidateAt(cellX: number, cellY: number): VillageCandidate {
    const key = regionKey(cellX, cellY);
    const cached = this.candidateCache.get(key);
    if (cached) {
      return cached;
    }

    const cellSize = this.config.settlement.cellSize;
    const seed = hashCoords(this.villageSeed, cellX, cellY, 41);
    const jitterX = hashToUnit(mixUint32(seed ^ 0x9e3779b9));
    const jitterY = hashToUnit(mixUint32(seed ^ 0x7f4a7c15));
    const x = (cellX + jitterX) * cellSize;
    const y = (cellY + jitterY) * cellSize;
    const probe = this.terrain.probe(x, y);
    const tieBreaker = hashToUnit(mixUint32(seed ^ 0xa1d8723f));

    let score = 0;
    let coastDistance = this.config.settlement.maxCoastSearch;
    if (probe.waterDepth <= 0.003) {
      coastDistance = this.estimateCoastDistance(x, y);

      const slopeFactor = 1 - smoothstep(0.08, 0.62, probe.slope);
      const moistureDelta = Math.abs(probe.moisture - this.config.settlement.targetMoisture);
      const moistureFactor = 1 - clamp(moistureDelta / 0.46, 0, 1);
      const coastFactor = this.coastPreferenceFactor(coastDistance);
      const forestPenalty = smoothstep(0.64, 0.92, probe.forestDensity) * 0.24;
      const shorelinePenalty = smoothstep(0.92, 0.99, probe.shore) * 0.35;
      const uplandPenalty = smoothstep(0.78, 0.98, probe.elevation) * 0.2;
      const randomFactor = 0.7 + hashToUnit(mixUint32(seed ^ 0x426f6f73)) * 0.45;

      score = (slopeFactor * 0.42 + moistureFactor * 0.23 + coastFactor * 0.35) * randomFactor;
      score -= forestPenalty + shorelinePenalty + uplandPenalty;
      score = clamp(score, 0, 1);
    }

    const candidate: VillageCandidate = {
      id: `v-${cellX},${cellY}`,
      cellX,
      cellY,
      x,
      y,
      score,
      coastDistance,
      tieBreaker
    };

    this.candidateCache.set(key, candidate);
    this.pruneCandidateCache();
    return candidate;
  }

  private coastPreferenceFactor(distance: number): number {
    const preferredMin = this.config.settlement.preferredCoastMin;
    const preferredMax = this.config.settlement.preferredCoastMax;
    const searchMax = this.config.settlement.maxCoastSearch;

    if (distance <= preferredMin) {
      return clamp(distance / preferredMin, 0, 1);
    }
    if (distance <= preferredMax) {
      return 1;
    }
    return clamp(1 - (distance - preferredMax) / Math.max(1, searchMax - preferredMax), 0, 1);
  }

  private estimateCoastDistance(x: number, y: number): number {
    const maxDistance = this.config.settlement.maxCoastSearch;
    const angleCount = 10;
    const step = 22;
    let best = maxDistance;

    for (let angleIndex = 0; angleIndex < angleCount; angleIndex += 1) {
      const angle = (Math.PI * 2 * angleIndex) / angleCount;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);

      for (let distance = step; distance <= maxDistance; distance += step) {
        const sample = this.terrain.sample(x + dirX * distance, y + dirY * distance);
        if (sample.waterDepth > 0) {
          if (distance < best) {
            best = distance;
          }
          break;
        }
      }
    }

    return best;
  }

  private buildRoadNetwork(villages: Village[]): Road[] {
    if (villages.length < 2) {
      return [];
    }

    const villageIndex = new Map<string, number>();
    for (let i = 0; i < villages.length; i += 1) {
      villageIndex.set(villages[i].id, i);
    }

    const edgeById = new Map<string, EdgeCandidate>();
    for (let i = 0; i < villages.length; i += 1) {
      const a = villages[i];
      const nearest: { village: Village; distance: number }[] = [];
      for (let j = 0; j < villages.length; j += 1) {
        if (i === j) {
          continue;
        }
        const b = villages[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance > this.config.roads.maxConnectionDistance) {
          continue;
        }
        nearest.push({ village: b, distance });
      }
      nearest.sort((left, right) => left.distance - right.distance);
      const count = Math.min(this.config.roads.nearestNeighbors, nearest.length);
      for (let k = 0; k < count; k += 1) {
        const b = nearest[k].village;
        const id = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (!edgeById.has(id)) {
          const distance = nearest[k].distance;
          const weight = this.estimateConnectionCost(a, b, distance);
          edgeById.set(id, { a, b, id, weight, distance });
        }
      }
    }

    const edgeCandidates = Array.from(edgeById.values()).sort((left, right) => left.weight - right.weight);
    const uf = new UnionFind(villages.length);
    const selected = new Map<string, EdgeCandidate>();
    const leftovers: EdgeCandidate[] = [];

    for (const edge of edgeCandidates) {
      const ai = villageIndex.get(edge.a.id);
      const bi = villageIndex.get(edge.b.id);
      if (ai === undefined || bi === undefined) {
        continue;
      }
      if (uf.union(ai, bi)) {
        selected.set(edge.id, edge);
      } else {
        leftovers.push(edge);
      }
    }

    const targetExtra = Math.floor(villages.length * 0.28);
    let added = 0;
    for (const edge of leftovers) {
      if (added >= targetExtra) {
        break;
      }
      const roll = hashToUnit(hashCoords(this.roadSeed, edge.a.cellX + edge.b.cellX, edge.a.cellY + edge.b.cellY, 199));
      const chance = this.config.roads.loopChance * clamp(1 - edge.distance / this.config.roads.maxConnectionDistance, 0.25, 1);
      if (roll < chance) {
        selected.set(edge.id, edge);
        added += 1;
      }
    }

    const roads: Road[] = [];
    for (const edge of selected.values()) {
      const type: RoadType = edge.distance > this.config.roads.maxConnectionDistance * 0.55 ? "major" : "minor";
      const width = type === "major" ? this.config.roads.majorWidth : this.config.roads.minorWidth;
      roads.push({
        id: `r-${edge.id}`,
        type,
        width,
        points: this.routeRoad(edge.a, edge.b, edge.id),
        fromVillageId: edge.a.id,
        toVillageId: edge.b.id
      });
    }

    return roads;
  }

  private estimateConnectionCost(a: Village, b: Village, distance: number): number {
    const steps = Math.max(3, Math.round(distance / 110));
    let penalty = 0;
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const x = lerp(a.x, b.x, t);
      const y = lerp(a.y, b.y, t);
      const probe = this.terrain.probe(x, y);
      if (probe.waterDepth > 0) {
        penalty += 3 + probe.waterDepth * 12;
      }
      penalty += probe.slope * 0.75;
    }
    const normalizedPenalty = penalty / steps;
    return distance * (1 + normalizedPenalty);
  }

  private routeRoad(a: Village, b: Village, edgeId: string): { x: number; y: number }[] {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const segments = Math.max(3, Math.round(distance / this.config.roads.routeStep));
    const tangentX = distance > 0 ? dx / distance : 1;
    const tangentY = distance > 0 ? dy / distance : 0;
    const normalX = -tangentY;
    const normalY = tangentX;
    const points: { x: number; y: number }[] = [];
    const edgeHash = hashString(`edge:${edgeId}`);

    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const baseX = lerp(a.x, b.x, t);
      const baseY = lerp(a.y, b.y, t);
      const taper = Math.sin(t * Math.PI);
      const offsetNoise = hashToUnit(hashCoords(edgeHash, i, segments, 67)) * 2 - 1;
      const curvature = this.config.roads.maxCurvatureOffset * taper * (0.35 + distance / this.config.roads.maxConnectionDistance * 0.65);
      points.push({
        x: baseX + normalX * curvature * offsetNoise,
        y: baseY + normalY * curvature * offsetNoise
      });
    }

    points[0] = { x: a.x, y: a.y };
    points[points.length - 1] = { x: b.x, y: b.y };

    for (let iteration = 0; iteration < 2; iteration += 1) {
      for (let i = 1; i < points.length - 1; i += 1) {
        points[i] = {
          x: points[i - 1].x * 0.25 + points[i].x * 0.5 + points[i + 1].x * 0.25,
          y: points[i - 1].y * 0.25 + points[i].y * 0.5 + points[i + 1].y * 0.25
        };
      }
    }

    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 1; i < points.length - 1; i += 1) {
        const probe = this.terrain.sample(points[i].x, points[i].y);
        if (probe.waterDepth <= 0.003) {
          continue;
        }
        const gradient = this.terrain.gradientAt(points[i].x, points[i].y, 5);
        const magnitude = Math.hypot(gradient.x, gradient.y);
        if (magnitude < 0.0001) {
          continue;
        }
        const push = 10 + probe.waterDepth * 95;
        points[i].x += (gradient.x / magnitude) * push;
        points[i].y += (gradient.y / magnitude) * push;
      }
    }

    points[0] = { x: a.x, y: a.y };
    points[points.length - 1] = { x: b.x, y: b.y };
    return points;
  }

  private generateHouses(roads: Road[]): House[] {
    const houses: House[] = [];
    const minSeparation = 12;

    for (const road of roads) {
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length < this.config.houses.spacing * 0.6) {
          continue;
        }
        const tangentX = dx / length;
        const tangentY = dy / length;
        const normalX = -tangentY;
        const normalY = tangentX;
        const count = Math.floor(length / this.config.houses.spacing);

        for (let step = 1; step < count; step += 1) {
          const t = step / count;
          const baseX = lerp(a.x, b.x, t);
          const baseY = lerp(a.y, b.y, t);

          for (const side of [-1, 1] as const) {
            const sideSalt = side === -1 ? 13 : 29;
            const baseHash = hashString(`${road.id}:${i}:${step}:${sideSalt}`);
            const localSeed = this.houseSeed ^ baseHash;
            const chanceRoll = hashToUnit(hashCoords(localSeed, i, step, 31));
            if (chanceRoll > this.config.houses.sideChance) {
              continue;
            }

            const setbackRoll = hashToUnit(hashCoords(localSeed, i, step, 57));
            const widthRoll = hashToUnit(hashCoords(localSeed, i, step, 83));
            const depthRoll = hashToUnit(hashCoords(localSeed, i, step, 97));
            const angleJitterRoll = hashToUnit(hashCoords(localSeed, i, step, 143));
            const setback = lerp(this.config.houses.minSetback, this.config.houses.maxSetback, setbackRoll) + road.width * 0.5;
            const width = lerp(this.config.houses.minWidth, this.config.houses.maxWidth, widthRoll);
            const depth = lerp(this.config.houses.minDepth, this.config.houses.maxDepth, depthRoll);
            const x = baseX + normalX * side * (setback + depth * 0.5);
            const y = baseY + normalY * side * (setback + depth * 0.5);
            const probe = this.terrain.probe(x, y);
            if (probe.waterDepth > 0.002 || probe.slope > this.config.houses.maxSlope) {
              continue;
            }

            const distanceOk = houses.every((house) => {
              const hx = house.x - x;
              const hy = house.y - y;
              return Math.hypot(hx, hy) >= minSeparation;
            });
            if (!distanceOk) {
              continue;
            }

            const angle = Math.atan2(tangentY, tangentX) + (angleJitterRoll * 2 - 1) * 0.14;
            const roofStyle = Math.floor(hashToUnit(hashCoords(localSeed, i, step, 201)) * 4);
            houses.push({
              id: `h-${road.id}-${i}-${step}-${side}`,
              x,
              y,
              width,
              depth,
              angle,
              roofStyle
            });
          }
        }
      }
    }

    return houses;
  }
}

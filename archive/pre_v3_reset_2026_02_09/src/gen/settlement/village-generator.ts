import { clamp, lerp, smoothstep } from "../../util/math";
import { WorldConfig } from "../config";
import { hashCoords, hashToUnit, mixUint32 } from "../hash";
import { TerrainSampler } from "../terrain";
import { villageIdForCell } from "./stable-ids";
import { Village } from "./types";

type VillageCandidate = {
  id: string;
  cellX: number;
  cellY: number;
  x: number;
  y: number;
  score: number;
  tieBreaker: number;
  coastDistance: number;
};

export class VillageGenerator {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly villageSeed: number;
  private readonly candidateCache = new Map<string, VillageCandidate>();
  private readonly maxCachedCandidates = 28000;

  constructor(config: WorldConfig, terrain: TerrainSampler, villageSeed: number) {
    this.config = config;
    this.terrain = terrain;
    this.villageSeed = villageSeed;
  }

  collectVillagesInBounds(minX: number, maxX: number, minY: number, maxY: number): Village[] {
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
        if (village.x >= minX && village.x <= maxX && village.y >= minY && village.y <= maxY) {
          villages.push(village);
        }
      }
    }

    return villages;
  }

  clear(): void {
    this.candidateCache.clear();
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
    const template = this.selectVillageTemplate(candidate.score, candidate.coastDistance, cellX, cellY);

    return {
      id: candidate.id,
      x: candidate.x,
      y: candidate.y,
      score: candidate.score,
      radius,
      cellX,
      cellY,
      template
    };
  }

  private candidateAt(cellX: number, cellY: number): VillageCandidate {
    const key = `${cellX},${cellY}`;
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
    const coastDistance = this.estimateCoastDistance(x, y);

    let score = 0;
    if (probe.waterDepth <= 0.003) {
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
      id: villageIdForCell(cellX, cellY),
      cellX,
      cellY,
      x,
      y,
      score,
      tieBreaker,
      coastDistance
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

  private selectVillageTemplate(score: number, coastDistance: number, cellX: number, cellY: number): "lakeside" | "crossroad" | "linear" {
    const nearCoastThreshold = this.config.settlement.preferredCoastMin * 1.2;
    if (coastDistance <= nearCoastThreshold) {
      return "lakeside";
    }

    const roll = hashToUnit(hashCoords(this.villageSeed, cellX, cellY, 947));
    if (score > this.config.settlement.suitabilityThreshold + 0.16 || roll < 0.34) {
      return "crossroad";
    }
    return "linear";
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
        if (this.terrain.sample(x + dirX * distance, y + dirY * distance).waterDepth > 0) {
          if (distance < best) {
            best = distance;
          }
          break;
        }
      }
    }

    return best;
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
}

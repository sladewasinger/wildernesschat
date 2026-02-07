import { WorldConfig } from "./config";
import { hashCoords, hashString } from "./hash";
import { createRng } from "./rng";
import { TerrainSampler } from "./terrain";

export type RiverPoint = {
  x: number;
  y: number;
};

export type RiverPath = {
  points: RiverPoint[];
  width: number;
};

const regionKey = (x: number, y: number): string => `${x},${y}`;

const intersectsBounds = (
  points: RiverPoint[],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean => {
  for (const point of points) {
    if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
      return true;
    }
  }
  return false;
};

export class RiverSystem {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly regionSeed: number;
  private readonly regionCache = new Map<string, RiverPath[]>();
  private readonly maxCachedRegions = 512;

  constructor(config: WorldConfig, terrain: TerrainSampler) {
    this.config = config;
    this.terrain = terrain;
    this.regionSeed = hashString(`${config.seed}:rivers`);
  }

  getRiversForBounds(minX: number, maxX: number, minY: number, maxY: number): RiverPath[] {
    const regionSize = this.config.terrain.riverRegionSize;
    const minRegionX = Math.floor(minX / regionSize) - 1;
    const maxRegionX = Math.floor(maxX / regionSize) + 1;
    const minRegionY = Math.floor(minY / regionSize) - 1;
    const maxRegionY = Math.floor(maxY / regionSize) + 1;
    const paths: RiverPath[] = [];

    for (let regionY = minRegionY; regionY <= maxRegionY; regionY += 1) {
      for (let regionX = minRegionX; regionX <= maxRegionX; regionX += 1) {
        const regionPaths = this.getRegion(regionX, regionY);
        for (const path of regionPaths) {
          if (intersectsBounds(path.points, minX, maxX, minY, maxY)) {
            paths.push(path);
          }
        }
      }
    }

    return paths;
  }

  private getRegion(regionX: number, regionY: number): RiverPath[] {
    const key = regionKey(regionX, regionY);
    const cached = this.regionCache.get(key);
    if (cached) {
      return cached;
    }

    const created = this.generateRegion(regionX, regionY);
    this.regionCache.set(key, created);
    this.pruneCache();
    return created;
  }

  private generateRegion(regionX: number, regionY: number): RiverPath[] {
    const regionSize = this.config.terrain.riverRegionSize;
    const originX = regionX * regionSize;
    const originY = regionY * regionSize;
    const seed = hashCoords(this.regionSeed, regionX, regionY);
    const rng = createRng(seed);
    const paths: RiverPath[] = [];

    for (let i = 0; i < this.config.terrain.riverSeedsPerRegion; i += 1) {
      let bestCandidate: RiverPoint | null = null;
      let bestScore = -1;

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const x = originX + rng.next() * regionSize;
        const y = originY + rng.next() * regionSize;
        const sample = this.terrain.sample(x, y);
        if (sample.waterDepth > -0.015) {
          continue;
        }
        const score = sample.elevation - sample.shore * 0.25;
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = { x, y };
        }
      }

      if (!bestCandidate || bestScore < this.config.terrain.riverStartElevation) {
        continue;
      }

      const path = this.traceRiver(bestCandidate.x, bestCandidate.y, createRng(hashCoords(seed, i, 91)));
      if (path.length > 10) {
        const width = 1.8 + rng.next() * 2.2;
        paths.push({ points: path, width });
      }
    }

    return paths;
  }

  private traceRiver(startX: number, startY: number, rng: ReturnType<typeof createRng>): RiverPoint[] {
    const stepLength = this.config.terrain.riverStepLength;
    const maxSteps = this.config.terrain.riverMaxSteps;
    const path: RiverPoint[] = [{ x: startX, y: startY }];

    let x = startX;
    let y = startY;
    let previousDirectionX = Math.cos(rng.next() * Math.PI * 2);
    let previousDirectionY = Math.sin(rng.next() * Math.PI * 2);
    let reachedWater = false;

    for (let step = 0; step < maxSteps; step += 1) {
      const gradient = this.terrain.gradientAt(x, y, 5);
      let directionX = -gradient.x;
      let directionY = -gradient.y;
      const downhillMagnitude = Math.hypot(directionX, directionY);

      if (downhillMagnitude < 0.00001) {
        const angle = rng.next() * Math.PI * 2;
        directionX = Math.cos(angle);
        directionY = Math.sin(angle);
      } else {
        directionX /= downhillMagnitude;
        directionY /= downhillMagnitude;
      }

      directionX = previousDirectionX * 0.52 + directionX * 0.48;
      directionY = previousDirectionY * 0.52 + directionY * 0.48;
      const directionMagnitude = Math.hypot(directionX, directionY);
      if (directionMagnitude > 0) {
        directionX /= directionMagnitude;
        directionY /= directionMagnitude;
      }

      previousDirectionX = directionX;
      previousDirectionY = directionY;
      x += directionX * stepLength;
      y += directionY * stepLength;

      const sample = this.terrain.sample(x, y);
      path.push({ x, y });

      if (sample.waterDepth > 0.002 && step > 8) {
        reachedWater = true;
        break;
      }

      if (path.length > 18) {
        const back = path[path.length - 12];
        const dx = x - back.x;
        const dy = y - back.y;
        if (dx * dx + dy * dy < stepLength * stepLength * 2.5) {
          break;
        }
      }
    }

    if (!reachedWater && path.length > 2) {
      const startElevation = this.terrain.sample(path[0].x, path[0].y).elevation;
      const endElevation = this.terrain.sample(path[path.length - 1].x, path[path.length - 1].y).elevation;
      if (startElevation - endElevation < 0.06) {
        return [];
      }
    }

    return path;
  }

  clear(): void {
    this.regionCache.clear();
  }

  private pruneCache(): void {
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
}

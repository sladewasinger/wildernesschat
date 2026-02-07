import { clamp, lerp } from "../util/math";
import { hashCoords, hashString, hashToUnit } from "../gen/hash";
import { V2_SETTLEMENT_CONFIG, V2_STAGE_MAX, V2_STAGE_MIN } from "./config";
import { V2TerrainSampler } from "./terrain";
import { House, Point, RoadSegment, VillagePlan, VillageSite } from "./types";

type SiteCandidate = {
  id: string;
  cellX: number;
  cellY: number;
  x: number;
  y: number;
  angle: number;
  trunkLength: number;
  score: number;
};

type RoadSample = {
  x: number;
  y: number;
  tangentX: number;
  tangentY: number;
};

type AnchorPlacement = {
  house: House;
  driveRoad: RoadSegment;
};

export class V2SettlementGenerator {
  private readonly siteSeed: number;
  private readonly planSeed: number;
  private readonly terrain: V2TerrainSampler;
  private readonly siteCache = new Map<string, VillageSite | null>();
  private readonly planCache = new Map<string, VillagePlan>();
  private readonly siteCellSize = V2_SETTLEMENT_CONFIG.siteCellSize;
  private readonly minSiteScore = V2_SETTLEMENT_CONFIG.minSiteScore;

  constructor(seed: string, terrain: V2TerrainSampler) {
    this.siteSeed = hashString(`${seed}:v2:sites`);
    this.planSeed = hashString(`${seed}:v2:plans`);
    this.terrain = terrain;
  }

  collectSitesInBounds(minX: number, maxX: number, minY: number, maxY: number): VillageSite[] {
    const minCellX = Math.floor(minX / this.siteCellSize) - 1;
    const maxCellX = Math.floor(maxX / this.siteCellSize) + 1;
    const minCellY = Math.floor(minY / this.siteCellSize) - 1;
    const maxCellY = Math.floor(maxY / this.siteCellSize) + 1;
    const sites: VillageSite[] = [];

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const site = this.siteAt(cellX, cellY);
        if (!site) {
          continue;
        }
        if (site.x >= minX && site.x <= maxX && site.y >= minY && site.y <= maxY) {
          sites.push(site);
        }
      }
    }

    return sites.sort((a, b) => a.id.localeCompare(b.id));
  }

  buildVillagePlan(site: VillageSite, stage: number): VillagePlan {
    const stageValue = clamp(Math.floor(stage), V2_STAGE_MIN, V2_STAGE_MAX);
    const cacheKey = `${site.id}:${stageValue}`;
    const cached = this.planCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const roads: RoadSegment[] = [];
    const houses: House[] = [];
    const trunk = this.buildTrunkRoad(site);

    if (stageValue >= 1) {
      const anchor = this.buildAnchorPlacement(site, trunk);
      roads.push(trunk);
      roads.push(anchor.driveRoad);
      houses.push(anchor.house);
    }

    if (stageValue >= 2) {
      this.growHousesAlongRoad(site, trunk, 14, roads, houses, hashString(`${site.id}:trunk-growth`), 0.57);
    }

    if (stageValue >= 3) {
      this.addBranches(site, trunk, roads, houses);
      this.addShortcuts(site, roads, houses);
    }

    const plan: VillagePlan = { site, roads, houses };
    this.planCache.set(cacheKey, plan);
    return plan;
  }

  private siteAt(cellX: number, cellY: number): VillageSite | null {
    const key = `${cellX},${cellY}`;
    const cached = this.siteCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const candidate = this.candidateAt(cellX, cellY);
    if (candidate.score < this.minSiteScore) {
      this.siteCache.set(key, null);
      return null;
    }

    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) {
          continue;
        }
        const other = this.candidateAt(cellX + ox, cellY + oy);
        if (other.score > candidate.score + 0.015) {
          this.siteCache.set(key, null);
          return null;
        }
      }
    }

    const site: VillageSite = {
      id: candidate.id,
      cellX,
      cellY,
      x: candidate.x,
      y: candidate.y,
      angle: candidate.angle,
      trunkLength: candidate.trunkLength,
      score: candidate.score
    };
    this.siteCache.set(key, site);
    return site;
  }

  private candidateAt(cellX: number, cellY: number): SiteCandidate {
    const base = hashCoords(this.siteSeed, cellX, cellY, 19);
    const jitterX = hashToUnit(hashCoords(base, 1, 0, 31));
    const jitterY = hashToUnit(hashCoords(base, 0, 1, 37));
    const x = (cellX + jitterX) * this.siteCellSize;
    const y = (cellY + jitterY) * this.siteCellSize;
    const elevation = this.terrain.elevationAt(x, y);
    const slope = this.terrain.slopeAt(x, y);
    const elevationTarget = 0.5;
    const elevationFactor = 1 - clamp(Math.abs(elevation - elevationTarget) / 0.28, 0, 1);
    const slopeFactor = 1 - clamp(slope / 0.08, 0, 1);
    const randomFactor = 0.72 + hashToUnit(hashCoords(base, 7, 7, 41)) * 0.38;
    const score = clamp((elevationFactor * 0.64 + slopeFactor * 0.36) * randomFactor, 0, 1);
    const angle = hashToUnit(hashCoords(base, 11, 13, 43)) * Math.PI * 2;
    const trunkLength = lerp(160, 290, hashToUnit(hashCoords(base, 17, 19, 47))) * (0.9 + score * 0.25);

    return {
      id: `v2-${cellX},${cellY}`,
      cellX,
      cellY,
      x,
      y,
      angle,
      trunkLength,
      score
    };
  }

  private buildTrunkRoad(site: VillageSite): RoadSegment {
    const dirX = Math.cos(site.angle);
    const dirY = Math.sin(site.angle);
    const normalX = -dirY;
    const normalY = dirX;
    const half = site.trunkLength * 0.5;
    const wobbleRoll = hashToUnit(hashCoords(this.planSeed, site.cellX, site.cellY, 71));
    const wobble = (wobbleRoll * 2 - 1) * Math.min(22, site.trunkLength * 0.13);
    const start = { x: site.x - dirX * half, y: site.y - dirY * half };
    const end = { x: site.x + dirX * half, y: site.y + dirY * half };
    const mid = { x: site.x + normalX * wobble, y: site.y + normalY * wobble };

    return {
      id: `rt-${site.id}`,
      className: "trunk",
      width: V2_SETTLEMENT_CONFIG.roadWidth,
      points: [start, mid, end]
    };
  }

  private buildAnchorPlacement(site: VillageSite, trunk: RoadSegment): AnchorPlacement {
    const sample = this.sampleRoad(trunk.points, 0.52);
    const side: -1 | 1 = hashToUnit(hashCoords(this.planSeed, site.cellX, site.cellY, 89)) < 0.5 ? -1 : 1;
    const normalX = -sample.tangentY;
    const normalY = sample.tangentX;
    const offset = trunk.width * 0.5 + V2_SETTLEMENT_CONFIG.houseSetbackMin + 2;
    const x = sample.x + normalX * side * offset;
    const y = sample.y + normalY * side * offset;
    const width = lerp(12, 18, hashToUnit(hashCoords(this.planSeed, site.cellX, site.cellY, 97))) * V2_SETTLEMENT_CONFIG.houseScale;
    const depth = lerp(8, 13, hashToUnit(hashCoords(this.planSeed, site.cellX, site.cellY, 101))) * V2_SETTLEMENT_CONFIG.houseScale;
    const angle = Math.atan2(sample.tangentY, sample.tangentX) + (hashToUnit(hashCoords(this.planSeed, site.cellX, site.cellY, 103)) * 2 - 1) * 0.07;

    const house: House = {
      id: `ha-${site.id}`,
      x,
      y,
      width,
      depth,
      angle,
      tone: hashToUnit(hashCoords(this.planSeed, site.cellX, site.cellY, 107))
    };
    const frontX = house.x - normalX * side * depth * 0.45;
    const frontY = house.y - normalY * side * depth * 0.45;
    const driveRoad: RoadSegment = {
      id: `rda-${site.id}`,
      className: "drive",
      width: V2_SETTLEMENT_CONFIG.roadWidth,
      points: [
        { x: frontX, y: frontY },
        {
          x: lerp(frontX, sample.x, 0.56),
          y: lerp(frontY, sample.y, 0.56)
        },
        { x: sample.x, y: sample.y }
      ]
    };

    return { house, driveRoad };
  }

  private growHousesAlongRoad(
    site: VillageSite,
    road: RoadSegment,
    slotCount: number,
    roads: RoadSegment[],
    houses: House[],
    seed: number,
    threshold: number
  ): void {
    for (let slot = 1; slot < slotCount; slot += 1) {
      const t = slot / slotCount;
      if (Math.abs(t - 0.5) < 0.1) {
        continue;
      }
      const sample = this.sampleRoad(road.points, t);
      for (const side of [-1, 1] as const) {
        const localHash = hashCoords(seed, slot, side, 137);
        const jitter = hashToUnit(hashCoords(localHash, 2, 3, 139));
        const normalX = -sample.tangentY;
        const normalY = sample.tangentX;
        const offset = road.width * 0.5 + lerp(V2_SETTLEMENT_CONFIG.houseSetbackMin, V2_SETTLEMENT_CONFIG.houseSetbackMax, jitter);
        const x = sample.x + normalX * side * offset;
        const y = sample.y + normalY * side * offset;
        const slope = this.terrain.slopeAt(x, y);
        if (slope > 0.095) {
          continue;
        }

        const elevation = this.terrain.elevationAt(x, y);
        const centerPull = 1 - Math.abs(t - 0.5) * 1.25;
        const desirability =
          site.score * 0.46 +
          (1 - clamp(slope / 0.09, 0, 1)) * 0.34 +
          (1 - clamp(Math.abs(elevation - 0.52) / 0.33, 0, 1)) * 0.2 +
          centerPull * 0.14 +
          (hashToUnit(hashCoords(localHash, 5, 7, 149)) - 0.5) * 0.18;
        if (desirability < threshold) {
          continue;
        }

        const width = lerp(10, 18, hashToUnit(hashCoords(localHash, 11, 13, 151))) * V2_SETTLEMENT_CONFIG.houseScale;
        const depth = lerp(7, 13, hashToUnit(hashCoords(localHash, 17, 19, 157))) * V2_SETTLEMENT_CONFIG.houseScale;
        const angle = Math.atan2(sample.tangentY, sample.tangentX) + (hashToUnit(hashCoords(localHash, 23, 29, 163)) * 2 - 1) * 0.09;
        const house: House = {
          id: `h-${site.id}-${road.id}-${slot}-${side}`,
          x,
          y,
          width,
          depth,
          angle,
          tone: hashToUnit(hashCoords(localHash, 31, 37, 167))
        };
        const roadClearance = Math.max(V2_SETTLEMENT_CONFIG.houseRoadClearance, Math.max(width, depth) * 0.88);
        if (this.distanceToRoadsExcludingRoad(x, y, roads, road.id) < roadClearance) {
          continue;
        }
        if (!this.canPlaceHouse(house, houses)) {
          continue;
        }

        houses.push(house);
        const frontX = house.x - normalX * side * depth * 0.45;
        const frontY = house.y - normalY * side * depth * 0.45;
        roads.push({
          id: `rd-${house.id}`,
          className: "drive",
          width: V2_SETTLEMENT_CONFIG.roadWidth,
          points: [
            { x: frontX, y: frontY },
            {
              x: lerp(frontX, sample.x, 0.55),
              y: lerp(frontY, sample.y, 0.55)
            },
            { x: sample.x, y: sample.y }
          ]
        });
      }
    }
  }

  private addBranches(site: VillageSite, trunk: RoadSegment, roads: RoadSegment[], houses: House[]): void {
    const branchTarget = Math.max(2, Math.round(2 + site.score * 4));
    let added = 0;

    for (let i = 0; i < branchTarget * 8; i += 1) {
      if (added >= branchTarget) {
        break;
      }
      const localHash = hashCoords(this.planSeed, site.cellX * 71 + i, site.cellY * 89 + i, 181);
      if (hashToUnit(hashCoords(localHash, 2, 2, 191)) > 0.7) {
        continue;
      }
      const t = lerp(0.16, 0.84, hashToUnit(hashCoords(localHash, 3, 5, 193)));
      const sample = this.sampleRoad(trunk.points, t);
      const side: -1 | 1 = hashToUnit(hashCoords(localHash, 7, 11, 197)) < 0.5 ? -1 : 1;
      const angleOffset = lerp(0.7, 1.18, hashToUnit(hashCoords(localHash, 13, 17, 199))) * side;
      const baseAngle = Math.atan2(sample.tangentY, sample.tangentX) + angleOffset;
      const length = lerp(82, 176, hashToUnit(hashCoords(localHash, 19, 23, 211)));
      const branch = this.createDirectionalRoad(
        `rb-${site.id}-${i}`,
        "branch",
        V2_SETTLEMENT_CONFIG.roadWidth,
        sample.x,
        sample.y,
        baseAngle,
        length,
        localHash
      );
      if (!this.isRoadUsable(branch.points, roads, 6.2)) {
        continue;
      }
      if (this.isRoadNearHouses(branch.points, houses, V2_SETTLEMENT_CONFIG.branchRoadHouseClearance - 1.5)) {
        continue;
      }

      roads.push(branch);
      this.growHousesAlongRoad(site, branch, 7, roads, houses, localHash ^ 0x27d4eb2f, 0.61);
      added += 1;
    }

    if (added === 0) {
      const fallbackTs = [0.14, 0.86];
      for (let i = 0; i < fallbackTs.length; i += 1) {
        const sample = this.sampleRoad(trunk.points, fallbackTs[i]);
        const side: -1 | 1 = i === 0 ? -1 : 1;
        const angle = Math.atan2(sample.tangentY, sample.tangentX) + side * 0.92;
        const hash = hashCoords(this.planSeed, site.cellX, site.cellY, 1201 + i * 13);
        const fallback = this.createDirectionalRoad(
          `rbf-${site.id}-${i}`,
          "branch",
          V2_SETTLEMENT_CONFIG.roadWidth,
          sample.x,
          sample.y,
          angle,
          116,
          hash
        );
        if (!this.isRoadUsable(fallback.points, roads, 5.8)) {
          continue;
        }
        if (this.isRoadNearHouses(fallback.points, houses, V2_SETTLEMENT_CONFIG.branchRoadHouseClearance - 2)) {
          continue;
        }
        roads.push(fallback);
        this.growHousesAlongRoad(site, fallback, 6, roads, houses, hash ^ 0x27d4eb2f, 0.61);
      }
    }
  }

  private addShortcuts(site: VillageSite, roads: RoadSegment[], houses: House[]): void {
    const branchEnds = roads
      .filter((road) => road.className === "branch")
      .map((road) => ({
        id: road.id,
        end: road.points[road.points.length - 1]
      }));

    let added = 0;
    for (let i = 0; i < branchEnds.length; i += 1) {
      if (added >= 2) {
        break;
      }
      for (let j = i + 1; j < branchEnds.length; j += 1) {
        if (added >= 2) {
          break;
        }
        const a = branchEnds[i];
        const b = branchEnds[j];
        const dist = Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y);
        if (dist < 72 || dist > 184) {
          continue;
        }

        const pairHash = hashString(`${site.id}:${a.id}:${b.id}`);
        if (hashToUnit(hashCoords(pairHash, 29, 31, 223)) > 0.32) {
          continue;
        }

        const nx = -(b.end.y - a.end.y) / dist;
        const ny = (b.end.x - a.end.x) / dist;
        const bend = (hashToUnit(hashCoords(pairHash, 37, 41, 227)) * 2 - 1) * Math.min(16, dist * 0.2);
        const mid = {
          x: (a.end.x + b.end.x) * 0.5 + nx * bend,
          y: (a.end.y + b.end.y) * 0.5 + ny * bend
        };
        const shortcut: RoadSegment = {
          id: `rs-${site.id}-${i}-${j}`,
          className: "shortcut",
          width: V2_SETTLEMENT_CONFIG.roadWidth,
          points: [a.end, mid, b.end]
        };
        if (!this.isRoadUsable(shortcut.points, roads, 6.2)) {
          continue;
        }
        if (this.isRoadNearHouses(shortcut.points, houses, V2_SETTLEMENT_CONFIG.shortcutRoadHouseClearance)) {
          continue;
        }

        roads.push(shortcut);
        added += 1;
      }
    }
  }

  private createDirectionalRoad(
    id: string,
    className: RoadSegment["className"],
    width: number,
    startX: number,
    startY: number,
    angle: number,
    length: number,
    hash: number
  ): RoadSegment {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const normalX = -dirY;
    const normalY = dirX;
    const bend = (hashToUnit(hashCoords(hash, 43, 47, 229)) * 2 - 1) * Math.min(18, length * 0.23);
    const endX = startX + dirX * length;
    const endY = startY + dirY * length;
    const mid = {
      x: startX + dirX * length * 0.52 + normalX * bend,
      y: startY + dirY * length * 0.52 + normalY * bend
    };

    return {
      id,
      className,
      width,
      points: [{ x: startX, y: startY }, mid, { x: endX, y: endY }]
    };
  }

  private sampleRoad(points: Point[], t: number): RoadSample {
    if (points.length < 2) {
      return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, tangentX: 1, tangentY: 0 };
    }

    const length = this.polylineLength(points);
    if (length <= 1e-6) {
      const p = points[0];
      return { x: p.x, y: p.y, tangentX: 1, tangentY: 0 };
    }

    let remaining = clamp(t, 0, 1) * length;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const seg = Math.hypot(dx, dy);
      if (seg <= 1e-6) {
        continue;
      }
      if (remaining <= seg) {
        const s = remaining / seg;
        return {
          x: lerp(a.x, b.x, s),
          y: lerp(a.y, b.y, s),
          tangentX: dx / seg,
          tangentY: dy / seg
        };
      }
      remaining -= seg;
    }

    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const seg = Math.hypot(dx, dy) || 1;
    return {
      x: last.x,
      y: last.y,
      tangentX: dx / seg,
      tangentY: dy / seg
    };
  }

  private isRoadUsable(points: Point[], existingRoads: RoadSegment[], minDistance: number): boolean {
    for (const point of points) {
      if (this.terrain.slopeAt(point.x, point.y) > 0.11) {
        return false;
      }
    }

    for (let i = 0; i < points.length; i += 1) {
      if (i === 0) {
        continue;
      }
      const p = points[i];
      const distance = this.distanceToRoads(p.x, p.y, existingRoads);
      if (distance < minDistance) {
        return false;
      }
    }

    return true;
  }

  private canPlaceHouse(house: House, existing: House[]): boolean {
    const houseRadius = Math.hypot(house.width, house.depth) * 0.6;
    for (const other of existing) {
      const otherRadius = Math.hypot(other.width, other.depth) * 0.6;
      if (Math.hypot(house.x - other.x, house.y - other.y) < houseRadius + otherRadius + V2_SETTLEMENT_CONFIG.houseSpacingPadding) {
        return false;
      }
    }
    return true;
  }

  private distanceToRoadsExcludingRoad(x: number, y: number, roads: RoadSegment[], roadId: string): number {
    const filtered = roads.filter((road) => road.id !== roadId);
    return this.distanceToRoads(x, y, filtered);
  }

  private isRoadNearHouses(points: Point[], houses: House[], clearance: number): boolean {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      for (const house of houses) {
        const houseRadius = Math.hypot(house.width, house.depth) * 0.58;
        const distance = this.distanceToSegment(house.x, house.y, a.x, a.y, b.x, b.y);
        if (distance < houseRadius + clearance) {
          return true;
        }
      }
    }
    return false;
  }

  private distanceToRoads(x: number, y: number, roads: RoadSegment[]): number {
    let best = Number.POSITIVE_INFINITY;
    for (const road of roads) {
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const d = this.distanceToSegment(x, y, a.x, a.y, b.x, b.y);
        if (d < best) {
          best = d;
        }
      }
    }
    return best;
  }

  private distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
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

  private polylineLength(points: Point[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total;
  }
}

import { clamp } from "../../util/math";
import { hashCoords, hashToUnit } from "../../gen/hash";
import { V2TerrainSampler } from "../terrain";
import { VillageSite } from "../types";

type SiteCandidate = {
  id: string;
  x: number;
  y: number;
  angle: number;
  trunkLength: number;
  score: number;
};

export type SiteSelectionContext = {
  siteSeed: number;
  terrain: V2TerrainSampler;
  siteCellSize: number;
  minSiteScore: number;
  siteCache: Map<string, VillageSite | null>;
};

export const collectSitesInBounds = (
  context: SiteSelectionContext,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): VillageSite[] => {
  const minCellX = Math.floor(minX / context.siteCellSize) - 1;
  const maxCellX = Math.floor(maxX / context.siteCellSize) + 1;
  const minCellY = Math.floor(minY / context.siteCellSize) - 1;
  const maxCellY = Math.floor(maxY / context.siteCellSize) + 1;
  const sites: VillageSite[] = [];

  for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const site = siteAt(context, cellX, cellY);
      if (!site) {
        continue;
      }
      if (site.x >= minX && site.x <= maxX && site.y >= minY && site.y <= maxY) {
        sites.push(site);
      }
    }
  }

  return sites.sort((a, b) => a.id.localeCompare(b.id));
};

export const siteAt = (context: SiteSelectionContext, cellX: number, cellY: number): VillageSite | null => {
  const key = `${cellX},${cellY}`;
  const cached = context.siteCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const candidate = candidateAt(context, cellX, cellY);
  if (candidate.score < context.minSiteScore) {
    context.siteCache.set(key, null);
    return null;
  }

  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const other = candidateAt(context, cellX + ox, cellY + oy);
      if (other.score > candidate.score + 0.015) {
        context.siteCache.set(key, null);
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
  context.siteCache.set(key, site);
  return site;
};

export const collectNearbySites = (context: SiteSelectionContext, site: VillageSite, maxDistance: number): VillageSite[] => {
  const radiusCells = Math.ceil(maxDistance / context.siteCellSize) + 1;
  const sites: VillageSite[] = [];

  for (let cy = site.cellY - radiusCells; cy <= site.cellY + radiusCells; cy += 1) {
    for (let cx = site.cellX - radiusCells; cx <= site.cellX + radiusCells; cx += 1) {
      if (cx === site.cellX && cy === site.cellY) {
        continue;
      }
      const other = siteAt(context, cx, cy);
      if (!other) {
        continue;
      }
      if (Math.hypot(other.x - site.x, other.y - site.y) > maxDistance) {
        continue;
      }
      sites.push(other);
    }
  }

  sites.sort((a, b) => Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(b.x - site.x, b.y - site.y));
  return sites;
};

const candidateAt = (context: SiteSelectionContext, cellX: number, cellY: number): SiteCandidate => {
  const base = hashCoords(context.siteSeed, cellX, cellY, 19);
  const jitterX = hashToUnit(hashCoords(base, 1, 0, 31));
  const jitterY = hashToUnit(hashCoords(base, 0, 1, 37));
  const x = (cellX + jitterX) * context.siteCellSize;
  const y = (cellY + jitterY) * context.siteCellSize;
  const elevation = context.terrain.elevationAt(x, y);
  const slope = context.terrain.slopeAt(x, y);
  const elevationTarget = 0.5;
  const elevationFactor = 1 - clamp(Math.abs(elevation - elevationTarget) / 0.28, 0, 1);
  const slopeFactor = 1 - clamp(slope / 0.08, 0, 1);
  const randomFactor = 0.72 + hashToUnit(hashCoords(base, 7, 7, 41)) * 0.38;
  const score = clamp((elevationFactor * 0.64 + slopeFactor * 0.36) * randomFactor, 0, 1);
  const angle = hashToUnit(hashCoords(base, 11, 13, 43)) * Math.PI * 2;
  const trunkLength = (160 + (290 - 160) * hashToUnit(hashCoords(base, 17, 19, 47))) * (0.9 + score * 0.25);

  return {
    id: `v2-${cellX},${cellY}`,
    x,
    y,
    angle,
    trunkLength,
    score
  };
};

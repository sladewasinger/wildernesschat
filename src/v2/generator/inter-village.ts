import { clamp, lerp } from "../../util/math";
import { hashCoords, hashString, hashToUnit } from "../../gen/hash";
import { fbm2D } from "../../gen/noise";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, Point, RoadSegment, VillageSite } from "../types";
import { polylineLength, sampleRoad } from "./geometry";
import { SiteSelectionContext, collectSitesInBounds } from "./site-selection";
import { buildTrunkRoad } from "./trunk";

export type Stage4ContinuityContext = {
  continuitySeed: number;
  fieldSeed: number;
  terrain: V2TerrainSampler;
  roadCache: Map<string, RoadSegment[]>;
};

type AddInterVillageConnectorsParams = {
  site: VillageSite;
  trunk: RoadSegment;
  roads: RoadSegment[];
  houses: House[];
  planSeed: number;
  terrain: V2TerrainSampler;
  continuityRoads: RoadSegment[];
};

type StepCandidate = {
  point: Point;
  dirX: number;
  dirY: number;
};

export const createStage4ContinuityContext = (planSeed: number, terrain: V2TerrainSampler): Stage4ContinuityContext => ({
  continuitySeed: hashString(`${planSeed}:v2:stage4:continuity`),
  fieldSeed: hashString(`${planSeed}:v2:stage4:continuity-field`),
  terrain,
  roadCache: new Map<string, RoadSegment[]>()
});

export const collectContinuityRoadsNearSite = (
  context: Stage4ContinuityContext,
  siteContext: SiteSelectionContext,
  planSeed: number,
  site: VillageSite,
  radius: number
): RoadSegment[] => collectContinuityRoadsInBounds(context, siteContext, planSeed, site.x - radius, site.x + radius, site.y - radius, site.y + radius);

export const collectContinuityRoadsInBounds = (
  context: Stage4ContinuityContext,
  siteContext: SiteSelectionContext,
  planSeed: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): RoadSegment[] => {
  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const sourcePadding = continuity.sourceSitePadding;
  const drawPadding = continuity.boundsPadding;

  const sourceSites = collectSitesInBounds(
    siteContext,
    minX - sourcePadding,
    maxX + sourcePadding,
    minY - sourcePadding,
    maxY + sourcePadding
  );

  const roads: RoadSegment[] = [];
  const seen = new Set<string>();

  for (const site of sourceSites) {
    const siteRoads = continuityRoadsForSite(context, site, planSeed);
    for (const road of siteRoads) {
      if (seen.has(road.id)) {
        continue;
      }
      if (!roadIntersectsBounds(road, minX - drawPadding, maxX + drawPadding, minY - drawPadding, maxY + drawPadding)) {
        continue;
      }
      seen.add(road.id);
      roads.push(road);
    }
  }

  roads.sort((a, b) => a.id.localeCompare(b.id));
  return roads;
};

export const addInterVillageConnectors = ({ site, roads, continuityRoads }: AddInterVillageConnectorsParams): number => {
  // Stage 4 now links villages by emitting village-seeded continuity roads from each trunk endpoint.
  // Connector metric reflects how many continuity spines belong to this village and are visible nearby.
  const prefix = `rvc-${site.id}-`;
  let connected = 0;
  for (const road of continuityRoads) {
    if (!road.id.startsWith(prefix)) {
      continue;
    }
    if (polylineLength(road.points) < V2_SETTLEMENT_CONFIG.stage4.continuity.minRoadLength * 0.55) {
      continue;
    }
    if (roads.some((existing) => existing.id === road.id)) {
      continue;
    }
    connected += 1;
  }
  return connected;
};

const continuityRoadsForSite = (
  context: Stage4ContinuityContext,
  site: VillageSite,
  planSeed: number
): RoadSegment[] => {
  const cached = context.roadCache.get(site.id);
  if (cached) {
    return cached;
  }

  const trunk = buildTrunkRoad(site, planSeed);
  const roads: RoadSegment[] = [];

  const sideA = buildContinuityRoadFromTrunkEndpoint(context, site, trunk, planSeed, 0);
  if (sideA) {
    roads.push(sideA);
  }

  const sideB = buildContinuityRoadFromTrunkEndpoint(context, site, trunk, planSeed, 1);
  if (sideB) {
    roads.push(sideB);
  }

  context.roadCache.set(site.id, roads);
  return roads;
};

const buildContinuityRoadFromTrunkEndpoint = (
  context: Stage4ContinuityContext,
  site: VillageSite,
  trunk: RoadSegment,
  planSeed: number,
  side: 0 | 1
): RoadSegment | null => {
  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const sideHash = hashString(`${site.id}:stage4:continuity:${side}:${planSeed}`);
  const sampleT = side === 0 ? continuity.endpointSampleT : 1 - continuity.endpointSampleT;
  const sample = sampleRoad(trunk.points, sampleT);
  const start = side === 0 ? trunk.points[0] : trunk.points[trunk.points.length - 1];

  let dirX = side === 0 ? -sample.tangentX : sample.tangentX;
  let dirY = side === 0 ? -sample.tangentY : sample.tangentY;
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen <= 1e-6) {
    dirX = 1;
    dirY = 0;
  } else {
    dirX /= dirLen;
    dirY /= dirLen;
  }

  const segmentCountRoll = hashToUnit(hashCoords(sideHash, 11, 13, 1601));
  const segmentCount =
    continuity.segmentCountMin +
    Math.floor(segmentCountRoll * (continuity.segmentCountMax - continuity.segmentCountMin + 1));

  const points: Point[] = [start];
  let current = start;

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const preferred = preferredDirection(context, sideHash, current.x, current.y, dirX, dirY, segment);
    const next = pickFeasibleStep(context, sideHash, current, preferred.x, preferred.y, segment);
    if (!next) {
      break;
    }
    points.push(next.point);
    current = next.point;
    dirX = next.dirX;
    dirY = next.dirY;
  }

  if (points.length < 4 || polylineLength(points) < continuity.minRoadLength) {
    return null;
  }

  return {
    id: `rvc-${site.id}-${side}`,
    className: "branch",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points
  };
};

const preferredDirection = (
  context: Stage4ContinuityContext,
  sideHash: number,
  x: number,
  y: number,
  prevDirX: number,
  prevDirY: number,
  segment: number
): { x: number; y: number } => {
  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const g = continuity.gradientStep;
  const gx = context.terrain.elevationAt(x + g, y) - context.terrain.elevationAt(x - g, y);
  const gy = context.terrain.elevationAt(x, y + g) - context.terrain.elevationAt(x, y - g);

  let contourX = -gy;
  let contourY = gx;
  const contourLen = Math.hypot(contourX, contourY);
  if (contourLen > 1e-6) {
    contourX /= contourLen;
    contourY /= contourLen;
  } else {
    contourX = prevDirX;
    contourY = prevDirY;
  }

  if (contourX * prevDirX + contourY * prevDirY < 0) {
    contourX = -contourX;
    contourY = -contourY;
  }

  const noiseValue = fbm2D(context.fieldSeed, x * continuity.noiseFrequency, y * continuity.noiseFrequency, {
    octaves: 3,
    persistence: 0.56,
    lacunarity: 2.1
  });
  const extraTurn = (hashToUnit(hashCoords(sideHash, segment * 31 + 17, segment * 37 + 23, 1613)) - 0.5) * 0.5;
  const noiseTurn = (noiseValue - 0.5) * Math.PI * 1.35 + extraTurn;
  const prevAngle = Math.atan2(prevDirY, prevDirX);
  const noiseAngle = prevAngle + noiseTurn;
  const noiseX = Math.cos(noiseAngle);
  const noiseY = Math.sin(noiseAngle);

  const desiredX =
    prevDirX * continuity.previousDirectionInfluence +
    contourX * continuity.contourInfluence +
    noiseX * continuity.noiseInfluence;
  const desiredY =
    prevDirY * continuity.previousDirectionInfluence +
    contourY * continuity.contourInfluence +
    noiseY * continuity.noiseInfluence;

  const normalized = normalizeWithFallback(desiredX, desiredY, prevDirX, prevDirY);
  return limitTurn(prevDirX, prevDirY, normalized.x, normalized.y, continuity.maxTurnRadPerStep);
};

const pickFeasibleStep = (
  context: Stage4ContinuityContext,
  sideHash: number,
  current: Point,
  preferredDirX: number,
  preferredDirY: number,
  segment: number
): StepCandidate | null => {
  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const lengthRoll = hashToUnit(hashCoords(sideHash, segment * 41 + 7, segment * 43 + 11, 1627));
  const length = lerp(continuity.segmentLengthMin, continuity.segmentLengthMax, lengthRoll);
  const tryCount = Math.max(1, continuity.candidateTurnTries);

  const offsetAngles: number[] = [0];
  for (let i = 1; i <= tryCount; i += 1) {
    offsetAngles.push(i * continuity.candidateTurnStepRad);
    offsetAngles.push(-i * continuity.candidateTurnStepRad);
  }

  for (const offsetAngle of offsetAngles) {
    const turned = rotateUnit(preferredDirX, preferredDirY, offsetAngle);
    const next = {
      x: current.x + turned.x * length,
      y: current.y + turned.y * length
    };
    if (context.terrain.slopeAt(next.x, next.y) > continuity.maxSlope) {
      continue;
    }
    return {
      point: next,
      dirX: turned.x,
      dirY: turned.y
    };
  }

  return null;
};

const normalizeWithFallback = (x: number, y: number, fallbackX: number, fallbackY: number): { x: number; y: number } => {
  const len = Math.hypot(x, y);
  if (len <= 1e-6) {
    const fallbackLen = Math.hypot(fallbackX, fallbackY);
    if (fallbackLen <= 1e-6) {
      return { x: 1, y: 0 };
    }
    return { x: fallbackX / fallbackLen, y: fallbackY / fallbackLen };
  }
  return { x: x / len, y: y / len };
};

const rotateUnit = (x: number, y: number, angle: number): { x: number; y: number } => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos
  };
};

const limitTurn = (
  prevX: number,
  prevY: number,
  desiredX: number,
  desiredY: number,
  maxTurnRad: number
): { x: number; y: number } => {
  const prevAngle = Math.atan2(prevY, prevX);
  const desiredAngle = Math.atan2(desiredY, desiredX);
  const delta = shortestAngleDelta(prevAngle, desiredAngle);
  const clamped = clamp(delta, -maxTurnRad, maxTurnRad);
  return {
    x: Math.cos(prevAngle + clamped),
    y: Math.sin(prevAngle + clamped)
  };
};

const shortestAngleDelta = (from: number, to: number): number => {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) {
    delta -= twoPi;
  }
  if (delta < -Math.PI) {
    delta += twoPi;
  }
  return delta;
};

const roadIntersectsBounds = (
  road: RoadSegment,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean => {
  let roadMinX = Number.POSITIVE_INFINITY;
  let roadMaxX = Number.NEGATIVE_INFINITY;
  let roadMinY = Number.POSITIVE_INFINITY;
  let roadMaxY = Number.NEGATIVE_INFINITY;

  for (const point of road.points) {
    if (point.x < roadMinX) roadMinX = point.x;
    if (point.x > roadMaxX) roadMaxX = point.x;
    if (point.y < roadMinY) roadMinY = point.y;
    if (point.y > roadMaxY) roadMaxY = point.y;
  }

  return !(roadMaxX < minX || roadMinX > maxX || roadMaxY < minY || roadMinY > maxY);
};

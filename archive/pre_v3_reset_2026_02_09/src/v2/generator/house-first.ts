import { clamp, lerp } from "../../util/math";
import { hashCoords, hashString, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, Point, RoadSegment, VillageSite } from "../types";
import { distanceToRoadsExcludingRoad, sampleRoad } from "./geometry";
import { canPlaceHouse, isRoadNearHouses } from "./housing";

type BuildHouseFirstVillagePlanParams = {
  site: VillageSite;
  stage: number;
  planSeed: number;
  terrain: V2TerrainSampler;
};

export type HouseFirstVillagePlan = {
  roads: RoadSegment[];
  houses: House[];
  branchCount: number;
  shortcutCount: number;
  primaryRoad: RoadSegment | null;
};

type HouseNode = {
  houseIndex: number;
  house: House;
  point: Point;
  forwardX: number;
  forwardY: number;
};

export const buildHouseFirstVillagePlan = ({
  site,
  stage,
  planSeed,
  terrain
}: BuildHouseFirstVillagePlanParams): HouseFirstVillagePlan => {
  const roads: RoadSegment[] = [];
  const houses: House[] = [];
  const stage2 = V2_SETTLEMENT_CONFIG.stage2.houseFirst;
  const localStage = Math.min(stage, 2);

  const anchor = buildAnchorHouse(site, planSeed, terrain);
  houses.push(anchor);

  if (localStage >= 2) {
    const paired = growContourPairedHouse({
      site,
      houses,
      terrain,
      planSeed,
      targetCount: stage2.targetHouseCount,
      attempts: stage2.candidateAttempts,
      attemptSalt: 2601,
      radiusMin: stage2.clusterRadiusMin,
      radiusMax: stage2.clusterRadiusMax,
      spacingPaddingExtra: stage2.clusterSpacingPaddingExtra
    });
    if (!paired) {
      growClusterHouses({
        site,
        houses,
        terrain,
        planSeed,
        targetCount: stage2.targetHouseCount,
        attempts: stage2.candidateAttempts,
        attemptSalt: 2601,
        radiusMin: stage2.clusterRadiusMin,
        radiusMax: stage2.clusterRadiusMax,
        spacingPaddingExtra: stage2.clusterSpacingPaddingExtra
      });
    }
  }

  const nodes = houses.map((house, houseIndex) => ({
    houseIndex,
    house,
    point: houseRoadNode(house, stage2.roadNodeOffset),
    forwardX: Math.cos(house.angle),
    forwardY: Math.sin(house.angle)
  }));

  const edgeKeys = new Set<string>();
  let trunkRoad: RoadSegment | null = null;
  let branchCount = 0;
  let shortcutCount = 0;

  for (const house of houses) {
    roads.push(buildDriveRoad(site, house, stage2.roadNodeOffset));
  }

  if (localStage >= 2 && nodes.length >= 2) {
    const treeEdges = buildMstEdges(nodes);
    for (let i = 0; i < treeEdges.length; i += 1) {
      const edge = treeEdges[i];
      const key = pairKey(edge.a.houseIndex, edge.b.houseIndex);
      edgeKeys.add(key);
      const road = buildConnectorRoad({
        site,
        a: edge.a,
        b: edge.b,
        className: i === 0 ? "trunk" : "branch",
        id: `${i === 0 ? "rht" : "rhb"}-${site.id}-${i}`,
        hash: hashString(`${site.id}:tree:${key}`),
        terrain,
        houses,
        roadNodeOffset: stage2.roadNodeOffset
      });
      if (!road) {
        continue;
      }
      if (i === 0) {
        trunkRoad = road;
      } else {
        branchCount += 1;
      }
      roads.push(road);
    }
  }

  if (!trunkRoad) {
    trunkRoad = roads.find((road) => road.className === "branch" || road.className === "shortcut") ?? null;
  }

  return {
    roads,
    houses,
    branchCount,
    shortcutCount,
    primaryRoad: trunkRoad
  };
};

const buildAnchorHouse = (site: VillageSite, planSeed: number, terrain: V2TerrainSampler): House => {
  const baseHash = hashCoords(planSeed, site.cellX * 41 + 17, site.cellY * 43 + 19, 2503);
  const jitterRadius = 14;
  const jitterAngle = hashToUnit(hashCoords(baseHash, 5, 7, 2507)) * Math.PI * 2;
  const x = site.x + Math.cos(jitterAngle) * jitterRadius * hashToUnit(hashCoords(baseHash, 11, 13, 2513));
  const y = site.y + Math.sin(jitterAngle) * jitterRadius * hashToUnit(hashCoords(baseHash, 17, 19, 2521));
  let contour = contourDirectionAt(terrain, x, y, 56);
  if (hashToUnit(hashCoords(baseHash, 41, 43, 2543)) < 0.5) {
    contour = { x: -contour.x, y: -contour.y };
  }
  const angle = Math.atan2(contour.y, contour.x) + (hashToUnit(hashCoords(baseHash, 47, 53, 2551)) * 2 - 1) * 0.14;

  return {
    id: `ha-${site.id}`,
    x,
    y,
    width: lerp(12, 18, hashToUnit(hashCoords(baseHash, 23, 29, 2531))) * V2_SETTLEMENT_CONFIG.housing.houseScale,
    depth: lerp(8, 13, hashToUnit(hashCoords(baseHash, 31, 37, 2539))) * V2_SETTLEMENT_CONFIG.housing.houseScale,
    angle,
    tone: hashToUnit(hashCoords(baseHash, 59, 61, 2557))
  };
};

type GrowClusterHousesParams = {
  site: VillageSite;
  houses: House[];
  terrain: V2TerrainSampler;
  planSeed: number;
  targetCount: number;
  attempts: number;
  attemptSalt: number;
  radiusMin: number;
  radiusMax: number;
  spacingPaddingExtra: number;
};

const growContourPairedHouse = ({
  site,
  houses,
  terrain,
  planSeed,
  targetCount,
  attempts,
  attemptSalt,
  radiusMin,
  radiusMax,
  spacingPaddingExtra
}: GrowClusterHousesParams): boolean => {
  if (houses.length >= targetCount || houses.length === 0) {
    return true;
  }

  const anchor = houses[0];
  const anchorElevation = terrain.elevationAt(anchor.x, anchor.y);
  const anchorContour = contourDirectionAt(terrain, anchor.x, anchor.y, 56);
  let bestHouse: House | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const baseHash = hashCoords(planSeed, site.cellX * 97 + attempt * 11, site.cellY * 101 + attempt * 13, attemptSalt);
    const side = hashToUnit(hashCoords(baseHash, 3, 5, 2819)) < 0.5 ? -1 : 1;
    const jitter = (hashToUnit(hashCoords(baseHash, 7, 11, 2833)) * 2 - 1) * 0.52;
    const dist = lerp(radiusMin, radiusMax, hashToUnit(hashCoords(baseHash, 13, 17, 2843)));
    const baseDirX = anchorContour.x * side;
    const baseDirY = anchorContour.y * side;
    const cosJ = Math.cos(jitter);
    const sinJ = Math.sin(jitter);
    const dirX = baseDirX * cosJ - baseDirY * sinJ;
    const dirY = baseDirX * sinJ + baseDirY * cosJ;
    const x = anchor.x + dirX * dist;
    const y = anchor.y + dirY * dist;

    const slope = terrain.slopeAt(x, y);
    if (slope > 0.088 || slope < 0.006) {
      continue;
    }
    const elevation = terrain.elevationAt(x, y);
    const elevationDelta = Math.abs(elevation - anchorElevation);
    if (elevationDelta > 0.036) {
      continue;
    }

    let contour = contourDirectionAt(terrain, x, y, 52);
    if (contour.x * anchorContour.x + contour.y * anchorContour.y < 0) {
      contour = { x: -contour.x, y: -contour.y };
    }

    const width = lerp(10, 18, hashToUnit(hashCoords(baseHash, 19, 23, 2857))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
    const depth = lerp(7, 13, hashToUnit(hashCoords(baseHash, 29, 31, 2861))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
    const house: House = {
      id: `h-${site.id}-${houses.length}`,
      x,
      y,
      width,
      depth,
      angle: Math.atan2(contour.y, contour.x) + (hashToUnit(hashCoords(baseHash, 37, 41, 2869)) * 2 - 1) * 0.14,
      tone: hashToUnit(hashCoords(baseHash, 43, 47, 2879))
    };
    if (!canPlaceHouse(house, houses) || hasHouseSpacingConflict(house, houses, spacingPaddingExtra)) {
      continue;
    }

    const contourConsistency = Math.abs(contour.x * anchorContour.x + contour.y * anchorContour.y);
    const score =
      (1 - clamp(slope / 0.088, 0, 1)) * 0.33 +
      (1 - clamp(elevationDelta / 0.036, 0, 1)) * 0.42 +
      contourConsistency * 0.25;
    if (score > bestScore) {
      bestScore = score;
      bestHouse = house;
    }
  }

  if (!bestHouse) {
    return false;
  }
  houses.push(bestHouse);
  return true;
};

const growClusterHouses = ({
  site,
  houses,
  terrain,
  planSeed,
  targetCount,
  attempts,
  attemptSalt,
  radiusMin,
  radiusMax,
  spacingPaddingExtra
}: GrowClusterHousesParams): void => {
  if (houses.length >= targetCount) {
    return;
  }

  const maxAttempts = Math.max(attempts, (targetCount - houses.length) * 10);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (houses.length >= targetCount) {
      break;
    }

    const baseHash = hashCoords(planSeed, site.cellX * 97 + attempt * 11, site.cellY * 101 + attempt * 13, attemptSalt);
    const parentIndex = Math.floor(hashToUnit(hashCoords(baseHash, 3, 5, 2563)) * houses.length);
    const parent = houses[Math.max(0, Math.min(parentIndex, houses.length - 1))];

    const radius = lerp(radiusMin, radiusMax, hashToUnit(hashCoords(baseHash, 7, 11, 2579)));
    const angle = hashToUnit(hashCoords(baseHash, 13, 17, 2591)) * Math.PI * 2;
    const x = parent.x + Math.cos(angle) * radius;
    const y = parent.y + Math.sin(angle) * radius;

    const slope = terrain.slopeAt(x, y);
    if (slope > 0.097) {
      continue;
    }

    const elevation = terrain.elevationAt(x, y);
    const desirability =
      site.score * 0.44 +
      (1 - clamp(slope / 0.095, 0, 1)) * 0.34 +
      (1 - clamp(Math.abs(elevation - 0.52) / 0.34, 0, 1)) * 0.22;
    if (desirability < 0.58) {
      continue;
    }

    let contour = contourDirectionAt(terrain, x, y, 52);
    const parentForwardX = Math.cos(parent.angle);
    const parentForwardY = Math.sin(parent.angle);
    if (contour.x * parentForwardX + contour.y * parentForwardY < 0) {
      contour = { x: -contour.x, y: -contour.y };
    }
    const faceAngle = Math.atan2(contour.y, contour.x) + (hashToUnit(hashCoords(baseHash, 19, 23, 2609)) * 2 - 1) * 0.18;
    const house: House = {
      id: `h-${site.id}-${houses.length}`,
      x,
      y,
      width: lerp(10, 18, hashToUnit(hashCoords(baseHash, 29, 31, 2617))) * V2_SETTLEMENT_CONFIG.housing.houseScale,
      depth: lerp(7, 13, hashToUnit(hashCoords(baseHash, 37, 41, 2623))) * V2_SETTLEMENT_CONFIG.housing.houseScale,
      angle: faceAngle,
      tone: hashToUnit(hashCoords(baseHash, 43, 47, 2633))
    };

    if (!canPlaceHouse(house, houses) || hasHouseSpacingConflict(house, houses, spacingPaddingExtra)) {
      continue;
    }

    houses.push(house);
  }
};

type GrowRoadsideInfillHousesParams = {
  site: VillageSite;
  roads: RoadSegment[];
  houses: House[];
  terrain: V2TerrainSampler;
  planSeed: number;
  slotCount: number;
  maxToAdd: number;
  chance: number;
  threshold: number;
  spacingPaddingExtra: number;
};

const growRoadsideInfillHouses = ({
  site,
  roads,
  houses,
  terrain,
  planSeed,
  slotCount,
  maxToAdd,
  chance,
  threshold,
  spacingPaddingExtra
}: GrowRoadsideInfillHousesParams): void => {
  if (maxToAdd <= 0 || slotCount < 2) {
    return;
  }

  const candidateRoads = roads
    .filter((road) => road.className !== "drive")
    .sort((a, b) => roadClassPriority(a.className) - roadClassPriority(b.className));

  let added = 0;
  for (let roadIndex = 0; roadIndex < candidateRoads.length; roadIndex += 1) {
    if (added >= maxToAdd) {
      break;
    }
    const road = candidateRoads[roadIndex];
    for (let slot = 1; slot < slotCount; slot += 1) {
      if (added >= maxToAdd) {
        break;
      }
      for (const side of [-1, 1] as const) {
        if (added >= maxToAdd) {
          break;
        }
        const localHash = hashCoords(planSeed, roadIndex * 71 + slot * 11, side * 73 + 17, 2693);
        if (hashToUnit(hashCoords(localHash, 2, 3, 2707)) > chance) {
          continue;
        }

        const tBase = slot / slotCount;
        const tJitter = (hashToUnit(hashCoords(localHash, 5, 7, 2711)) * 2 - 1) * 0.07;
        const t = clamp(tBase + tJitter, 0.08, 0.92);
        const sample = sampleRoad(road.points, t);
        const normalX = -sample.tangentY;
        const normalY = sample.tangentX;
        const setback = lerp(
          V2_SETTLEMENT_CONFIG.housing.houseSetbackMin * 0.9,
          V2_SETTLEMENT_CONFIG.housing.houseSetbackMax * 0.96,
          hashToUnit(hashCoords(localHash, 11, 13, 2729))
        );
        const x = sample.x + normalX * side * (road.width * 0.5 + setback);
        const y = sample.y + normalY * side * (road.width * 0.5 + setback);

        const slope = terrain.slopeAt(x, y);
        if (slope > 0.095) {
          continue;
        }

        const elevation = terrain.elevationAt(x, y);
        const desirability =
          site.score * 0.44 +
          (1 - clamp(slope / 0.095, 0, 1)) * 0.34 +
          (1 - clamp(Math.abs(elevation - 0.52) / 0.34, 0, 1)) * 0.22 +
          (1 - Math.abs(t - 0.5) * 0.8) * 0.08;
        if (desirability < threshold) {
          continue;
        }

        const width = lerp(10, 17, hashToUnit(hashCoords(localHash, 17, 19, 2731))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
        const depth = lerp(7, 13, hashToUnit(hashCoords(localHash, 23, 29, 2741))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
        const house: House = {
          id: `hi-${site.id}-${road.id}-${slot}-${side}`,
          x,
          y,
          width,
          depth,
          angle: Math.atan2(sample.tangentY, sample.tangentX) + (hashToUnit(hashCoords(localHash, 31, 37, 2753)) * 2 - 1) * 0.08,
          tone: hashToUnit(hashCoords(localHash, 41, 43, 2767))
        };

        if (!canPlaceHouse(house, houses) || hasHouseSpacingConflict(house, houses, spacingPaddingExtra)) {
          continue;
        }
        const roadClearance = Math.max(V2_SETTLEMENT_CONFIG.housing.houseRoadClearance, Math.max(width, depth) * 0.86);
        if (distanceToRoadsExcludingRoad(house.x, house.y, roads, road.id) < roadClearance) {
          continue;
        }

        houses.push(house);
        const frontX = house.x - normalX * side * depth * 0.45;
        const frontY = house.y - normalY * side * depth * 0.45;
        roads.push({
          id: `rdi-${site.id}-${road.id}-${slot}-${side}`,
          className: "drive",
          width: V2_SETTLEMENT_CONFIG.roads.width,
          points: [
            { x: frontX, y: frontY },
            { x: lerp(frontX, sample.x, 0.55), y: lerp(frontY, sample.y, 0.55) },
            { x: sample.x, y: sample.y }
          ]
        });
        added += 1;
      }
    }
  }
};

const hasHouseSpacingConflict = (house: House, existing: House[], extraPadding: number): boolean => {
  if (extraPadding <= 0) {
    return false;
  }
  const houseRadius = Math.hypot(house.width, house.depth) * 0.6;
  for (const other of existing) {
    const otherRadius = Math.hypot(other.width, other.depth) * 0.6;
    if (
      Math.hypot(house.x - other.x, house.y - other.y) <
      houseRadius + otherRadius + V2_SETTLEMENT_CONFIG.housing.houseSpacingPadding + extraPadding
    ) {
      return true;
    }
  }
  return false;
};

const roadClassPriority = (className: RoadSegment["className"]): number => {
  if (className === "trunk") return 0;
  if (className === "branch") return 1;
  if (className === "shortcut") return 2;
  return 3;
};

const houseRoadNode = (house: House, offset: number): Point => {
  const fx = Math.cos(house.angle);
  const fy = Math.sin(house.angle);
  return {
    x: house.x + fx * (house.depth * 0.55 + offset),
    y: house.y + fy * (house.depth * 0.55 + offset)
  };
};

const buildDriveRoad = (site: VillageSite, house: House, roadNodeOffset: number): RoadSegment => {
  const fx = Math.cos(house.angle);
  const fy = Math.sin(house.angle);
  const frontX = house.x + fx * house.depth * 0.44;
  const frontY = house.y + fy * house.depth * 0.44;
  const node = houseRoadNode(house, roadNodeOffset);

  return {
    id: `rd-${site.id}-${house.id}`,
    className: "drive",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points: [
      { x: frontX, y: frontY },
      {
        x: lerp(frontX, node.x, 0.55),
        y: lerp(frontY, node.y, 0.55)
      },
      node
    ]
  };
};

const buildMstEdges = (nodes: HouseNode[]): Array<{ a: HouseNode; b: HouseNode; distance: number }> => {
  const connected = new Set<number>([0]);
  const edges: Array<{ a: HouseNode; b: HouseNode; distance: number }> = [];

  while (connected.size < nodes.length) {
    let bestA = -1;
    let bestB = -1;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const a of connected) {
      for (let b = 0; b < nodes.length; b += 1) {
        if (connected.has(b)) {
          continue;
        }
        const dx = nodes[b].point.x - nodes[a].point.x;
        const dy = nodes[b].point.y - nodes[a].point.y;
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestA = a;
          bestB = b;
        }
      }
    }

    if (bestA < 0 || bestB < 0) {
      break;
    }

    connected.add(bestB);
    edges.push({ a: nodes[bestA], b: nodes[bestB], distance: bestDist });
  }

  return edges;
};

const buildLoopCandidates = (
  nodes: HouseNode[],
  edgeKeys: Set<string>
): Array<{ a: HouseNode; b: HouseNode; distance: number }> => {
  const candidates: Array<{ a: HouseNode; b: HouseNode; distance: number }> = [];

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const key = pairKey(nodes[i].houseIndex, nodes[j].houseIndex);
      if (edgeKeys.has(key)) {
        continue;
      }
      const dx = nodes[j].point.x - nodes[i].point.x;
      const dy = nodes[j].point.y - nodes[i].point.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 96 || distance > 268) {
        continue;
      }
      candidates.push({ a: nodes[i], b: nodes[j], distance });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates;
};

type BuildConnectorRoadParams = {
  site: VillageSite;
  a: HouseNode;
  b: HouseNode;
  className: RoadSegment["className"];
  id: string;
  hash: number;
  terrain: V2TerrainSampler;
  houses: House[];
  roadNodeOffset: number;
};

const buildConnectorRoad = ({ site, a, b, className, id, hash, terrain, houses, roadNodeOffset }: BuildConnectorRoadParams): RoadSegment | null => {
  const span = Math.hypot(b.point.x - a.point.x, b.point.y - a.point.y);
  if (span < 16) {
    return null;
  }

  const leadLength = clamp(span * 0.12 + roadNodeOffset * 0.4, 14, 34);
  const startLead = {
    x: a.point.x + a.forwardX * leadLength,
    y: a.point.y + a.forwardY * leadLength
  };
  const endLead = {
    x: b.point.x + b.forwardX * leadLength,
    y: b.point.y + b.forwardY * leadLength
  };
  const corridor = buildTerrainFitSpline(startLead, endLead, terrain, hash);
  if (!corridor) {
    return null;
  }

  const points = dedupeRoadPoints([a.point, ...corridor, b.point]);
  if (points.length < 3) {
    return null;
  }

  let steepest = 0;
  for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const sample = sampleRoad(points, t);
    steepest = Math.max(steepest, terrain.slopeAt(sample.x, sample.y));
  }
  if (steepest > 0.115) {
    return null;
  }
  if (isRoadNearHousesExcluding(points, houses, a.houseIndex, b.houseIndex, V2_SETTLEMENT_CONFIG.roads.width * 0.7 + 2.4)) {
    return null;
  }

  return {
    id,
    className,
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points
  };
};

const buildTerrainFitSpline = (start: Point, end: Point, terrain: V2TerrainSampler, seed: number): Point[] | null => {
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span <= 1e-6) {
    return null;
  }
  if (span < 26) {
    return [start, end];
  }

  const dirX = (end.x - start.x) / span;
  const dirY = (end.y - start.y) / span;
  const normalX = -dirY;
  const normalY = dirX;
  const interiorCount = Math.max(2, Math.min(5, Math.round(span / 110)));
  const lateralMax = clamp(span * 0.2, 26, 120);
  const targetElevation = (terrain.elevationAt(start.x, start.y) + terrain.elevationAt(end.x, end.y)) * 0.5;

  const controls: Point[] = [start];
  let prevPoint = start;
  let prevElevation = terrain.elevationAt(start.x, start.y);
  let previousOffset = 0;

  for (let i = 1; i <= interiorCount; i += 1) {
    const t = i / (interiorCount + 1);
    const baseX = lerp(start.x, end.x, t);
    const baseY = lerp(start.y, end.y, t);

    let best: Point | null = null;
    let bestOffset = 0;
    let bestElevation = prevElevation;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let sample = 0; sample <= 12; sample += 1) {
      const u = sample / 12;
      const offset = (u * 2 - 1) * lateralMax;
      const x = baseX + normalX * offset;
      const y = baseY + normalY * offset;
      const slope = terrain.slopeAt(x, y);
      if (slope > 0.128) {
        continue;
      }

      const elevation = terrain.elevationAt(x, y);
      const segmentLen = Math.hypot(x - prevPoint.x, y - prevPoint.y);
      if (segmentLen < 10) {
        continue;
      }
      const segX = (x - prevPoint.x) / segmentLen;
      const segY = (y - prevPoint.y) / segmentLen;
      const grade = Math.abs(elevation - prevElevation) / segmentLen;
      const toEndLen = Math.hypot(end.x - x, end.y - y);
      const toEndX = toEndLen <= 1e-6 ? dirX : (end.x - x) / toEndLen;
      const toEndY = toEndLen <= 1e-6 ? dirY : (end.y - y) / toEndLen;
      const contour = contourDirectionAt(terrain, x, y, 54);
      const contourAlignment = Math.abs(contour.x * toEndX + contour.y * toEndY);
      const contourAlongSegment = Math.abs(contour.x * segX + contour.y * segY);
      const smoothOffsetDelta = Math.abs(offset - previousOffset) / Math.max(1, lateralMax);
      const tieBreak = hashToUnit(hashCoords(seed, i * 53 + sample * 7, 89, 2801)) * 0.02;

      const cost =
        slope * 8.9 +
        Math.abs(elevation - targetElevation) * 4.1 +
        grade * 1350 +
        Math.abs(offset) / Math.max(1, lateralMax) * 0.52 +
        smoothOffsetDelta * 0.67 +
        (1 - contourAlignment) * 0.95 +
        (1 - contourAlongSegment) * 2.45 +
        tieBreak;
      if (cost < bestCost) {
        bestCost = cost;
        best = { x, y };
        bestOffset = offset;
        bestElevation = elevation;
      }
    }

    if (!best) {
      best = { x: baseX, y: baseY };
      bestOffset = 0;
      bestElevation = terrain.elevationAt(best.x, best.y);
    }

    controls.push(best);
    prevPoint = best;
    prevElevation = bestElevation;
    previousOffset = bestOffset;
  }

  controls.push(end);
  const smooth = chaikinSmooth(controls, 2);
  if (smooth.length < 2) {
    return null;
  }

  const smoothLength = polylineLengthLocal(smooth);
  if (smoothLength > span * 1.95) {
    return [start, end];
  }

  return smooth;
};

const contourDirectionAt = (terrain: V2TerrainSampler, x: number, y: number, step: number): Point => {
  const gx = terrain.elevationAt(x + step, y) - terrain.elevationAt(x - step, y);
  const gy = terrain.elevationAt(x, y + step) - terrain.elevationAt(x, y - step);
  const contourX = -gy;
  const contourY = gx;
  const len = Math.hypot(contourX, contourY);
  if (len <= 1e-6) {
    return { x: 1, y: 0 };
  }
  return { x: contourX / len, y: contourY / len };
};

const chaikinSmooth = (points: Point[], passes: number): Point[] => {
  let current = points;
  for (let pass = 0; pass < passes; pass += 1) {
    if (current.length < 3) {
      return current;
    }
    const next: Point[] = [current[0]];
    for (let i = 0; i < current.length - 1; i += 1) {
      const a = current[i];
      const b = current[i + 1];
      next.push(
        { x: lerp(a.x, b.x, 0.25), y: lerp(a.y, b.y, 0.25) },
        { x: lerp(a.x, b.x, 0.75), y: lerp(a.y, b.y, 0.75) }
      );
    }
    next.push(current[current.length - 1]);
    current = dedupeRoadPoints(next);
  }
  return current;
};

const polylineLengthLocal = (points: Point[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
};

const isRoadNearHousesExcluding = (
  points: Point[],
  houses: House[],
  excludeA: number,
  excludeB: number,
  clearance: number
): boolean => {
  if (houses.length <= 2) {
    return false;
  }
  const filtered: House[] = [];
  for (let i = 0; i < houses.length; i += 1) {
    if (i === excludeA || i === excludeB) {
      continue;
    }
    filtered.push(houses[i]);
  }
  return isRoadNearHouses(points, filtered, clearance);
};

const dedupeRoadPoints = (points: Point[]): Point[] => {
  if (points.length <= 1) {
    return points;
  }
  const deduped: Point[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = deduped[deduped.length - 1];
    const next = points[i];
    if (Math.hypot(next.x - prev.x, next.y - prev.y) <= 1e-4) {
      continue;
    }
    deduped.push(next);
  }
  return deduped;
};

const pairKey = (a: number, b: number): string => {
  const low = a < b ? a : b;
  const high = a < b ? b : a;
  return `${low}|${high}`;
};

import { clamp, lerp } from "../../util/math";
import { hashCoords, hashString, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, Point, RoadSegment, VillageSite } from "../types";
import { distanceToRoadsExcludingRoad, sampleRoad } from "./geometry";
import { canPlaceHouse } from "./housing";

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
  point: Point;
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
  const stage3 = V2_SETTLEMENT_CONFIG.stage3.houseFirst;

  const anchor = buildAnchorHouse(site, planSeed);
  houses.push(anchor);

  if (stage >= 2) {
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

  if (stage >= 3) {
    growClusterHouses({
      site,
      houses,
      terrain,
      planSeed,
      targetCount: stage2.targetHouseCount + stage3.extraHouseCount,
      attempts: stage3.extraCandidateAttempts,
      attemptSalt: 2621,
      radiusMin: stage2.clusterRadiusMin,
      radiusMax: stage2.clusterRadiusMax * 1.05,
      spacingPaddingExtra: stage2.clusterSpacingPaddingExtra
    });
  }

  const nodes = houses.map((house, houseIndex) => ({
    houseIndex,
    point: houseRoadNode(house, stage2.roadNodeOffset)
  }));

  const edgeKeys = new Set<string>();
  let trunkRoad: RoadSegment | null = null;
  let branchCount = 0;
  let shortcutCount = 0;

  for (const house of houses) {
    roads.push(buildDriveRoad(site, house, stage2.roadNodeOffset));
  }

  if (stage >= 2 && nodes.length >= 2) {
    const treeEdges = buildMstEdges(nodes);
    for (let i = 0; i < treeEdges.length; i += 1) {
      const edge = treeEdges[i];
      const key = pairKey(edge.a.houseIndex, edge.b.houseIndex);
      edgeKeys.add(key);
      const road = buildConnectorRoad({
        site,
        a: edge.a.point,
        b: edge.b.point,
        className: i === 0 ? "trunk" : "branch",
        id: `${i === 0 ? "rht" : "rhb"}-${site.id}-${i}`,
        hash: hashString(`${site.id}:tree:${key}`),
        terrain
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

  if (stage >= 3 && nodes.length >= 4) {
    const loopCandidates = buildLoopCandidates(nodes, edgeKeys);
    const maxLoops = stage3.maxLoopRoads;
    let added = 0;

    for (const candidate of loopCandidates) {
      if (added >= maxLoops) {
        break;
      }
      const key = pairKey(candidate.a.houseIndex, candidate.b.houseIndex);
      const roll = hashToUnit(hashCoords(planSeed, candidate.a.houseIndex * 73 + 11, candidate.b.houseIndex * 79 + 17, 2689));
      if (roll > stage3.loopPairChance) {
        continue;
      }

      const road = buildConnectorRoad({
        site,
        a: candidate.a.point,
        b: candidate.b.point,
        className: "shortcut",
        id: `rhs-${site.id}-${added}`,
        hash: hashString(`${site.id}:loop:${key}`),
        terrain
      });
      if (!road) {
        continue;
      }

      roads.push(road);
      edgeKeys.add(key);
      shortcutCount += 1;
      added += 1;
    }
  }

  if (stage >= 2) {
    growRoadsideInfillHouses({
      site,
      roads,
      houses,
      terrain,
      planSeed,
      slotCount: stage2.roadsideInfillSlotCount,
      maxToAdd: stage2.roadsideInfillMaxHouses + (stage >= 3 ? stage3.roadsideInfillExtraMaxHouses : 0),
      chance: stage >= 3 ? stage3.roadsideInfillChance : stage2.roadsideInfillChance,
      threshold: stage >= 3 ? stage3.roadsideInfillThreshold : stage2.roadsideInfillThreshold,
      spacingPaddingExtra: stage2.roadsideSpacingPaddingExtra
    });
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

const buildAnchorHouse = (site: VillageSite, planSeed: number): House => {
  const baseHash = hashCoords(planSeed, site.cellX * 41 + 17, site.cellY * 43 + 19, 2503);
  const jitterRadius = 14;
  const jitterAngle = hashToUnit(hashCoords(baseHash, 5, 7, 2507)) * Math.PI * 2;
  const x = site.x + Math.cos(jitterAngle) * jitterRadius * hashToUnit(hashCoords(baseHash, 11, 13, 2513));
  const y = site.y + Math.sin(jitterAngle) * jitterRadius * hashToUnit(hashCoords(baseHash, 17, 19, 2521));

  return {
    id: `ha-${site.id}`,
    x,
    y,
    width: lerp(12, 18, hashToUnit(hashCoords(baseHash, 23, 29, 2531))) * V2_SETTLEMENT_CONFIG.housing.houseScale,
    depth: lerp(8, 13, hashToUnit(hashCoords(baseHash, 31, 37, 2539))) * V2_SETTLEMENT_CONFIG.housing.houseScale,
    angle: hashToUnit(hashCoords(baseHash, 41, 43, 2543)) * Math.PI * 2,
    tone: hashToUnit(hashCoords(baseHash, 47, 53, 2551))
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

    const faceAngle =
      Math.atan2(parent.y - y, parent.x - x) + (hashToUnit(hashCoords(baseHash, 19, 23, 2609)) * 2 - 1) * 0.42;
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
  a: Point;
  b: Point;
  className: RoadSegment["className"];
  id: string;
  hash: number;
  terrain: V2TerrainSampler;
};

const buildConnectorRoad = ({ site, a, b, className, id, hash, terrain }: BuildConnectorRoadParams): RoadSegment | null => {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  if (span < 16) {
    return null;
  }

  const normalX = -(b.y - a.y) / Math.max(1e-6, span);
  const normalY = (b.x - a.x) / Math.max(1e-6, span);
  const bend = (hashToUnit(hashCoords(hash, 53, 59, 2657)) * 2 - 1) * Math.min(22, span * 0.18);
  const mid = {
    x: (a.x + b.x) * 0.5 + normalX * bend,
    y: (a.y + b.y) * 0.5 + normalY * bend
  };

  const steepest = Math.max(terrain.slopeAt(a.x, a.y), terrain.slopeAt(mid.x, mid.y), terrain.slopeAt(b.x, b.y));
  if (steepest > 0.115) {
    return null;
  }

  return {
    id,
    className,
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points: [a, mid, b]
  };
};

const pairKey = (a: number, b: number): string => {
  const low = a < b ? a : b;
  const high = a < b ? b : a;
  return `${low}|${high}`;
};

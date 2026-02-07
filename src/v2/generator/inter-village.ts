import { lerp } from "../../util/math";
import { hashCoords, hashString, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, RoadSegment, VillageSite } from "../types";
import { closestPointOnRoad, hasParallelRoadConflict, isRoadUsable, sampleRoad } from "./geometry";
import { growHousesAlongRoad, isRoadNearHouses } from "./housing";
import { collectNearbySites, SiteSelectionContext } from "./site-selection";
import { buildTrunkRoad, createDirectionalRoad } from "./trunk";

type AddInterVillageConnectorsParams = {
  site: VillageSite;
  trunk: RoadSegment;
  roads: RoadSegment[];
  houses: House[];
  planSeed: number;
  terrain: V2TerrainSampler;
  siteContext: SiteSelectionContext;
};

type PairBuild = {
  pairKey: string;
  pairHash: number;
  span: number;
  localAnchor: { x: number; y: number };
  remoteAnchor: { x: number; y: number };
};

export const addInterVillageConnectors = ({
  site,
  trunk,
  roads,
  houses,
  planSeed,
  terrain,
  siteContext
}: AddInterVillageConnectorsParams): number => {
  const stage4 = V2_SETTLEMENT_CONFIG.stage4;
  const interVillage = stage4.interVillage;
  const extensions = stage4.extensions;
  const outbound = stage4.outbound;
  const allNeighbors = collectNearbySites(siteContext, site, interVillage.maxDistance);
  const eligibleNeighbors = allNeighbors.filter((neighbor) => {
    const dist = Math.hypot(neighbor.x - site.x, neighbor.y - site.y);
    return dist >= interVillage.minDistance && dist <= interVillage.maxDistance;
  });

  const connectorTarget = resolveConnectorTargetCount(site, planSeed);
  if (connectorTarget <= 0) {
    return 0;
  }

  let connectorAdded = 0;
  let extensionAdded = 0;
  let outboundAdded = 0;
  const connectedPairs = new Set<string>();

  for (const neighbor of eligibleNeighbors) {
    if (connectorAdded >= connectorTarget) {
      break;
    }

    const pair = buildPair(site, trunk, neighbor, planSeed, interVillage.minDistance);
    if (!pair || connectedPairs.has(pair.pairKey)) {
      continue;
    }

    const chanceRoll = hashToUnit(hashCoords(pair.pairHash, 11, 17, 601));
    if (!interVillage.forceNearestConnections && chanceRoll > interVillage.pairChanceThreshold) {
      continue;
    }

    const connector = buildConnectorRoad(pair);
    if (!interVillage.forceNearestConnections) {
      if (!canUseStage4Road(connector, roads, houses, terrain, stage4.connectorRoadDistanceMultiplier, stage4.connectorHouseClearanceExtra, {
        allowLastPointTouch: true
      })) {
        continue;
      }
    }

    roads.push(connector);
    if (stage4.spawnHousesOnConnectors) {
      growHousesAlongRoad({
        site,
        road: connector,
        slotCount: stage4.connectorGrowthHouseSlotCount,
        roads,
        houses,
        seed: pair.pairHash ^ 0x7f4a7c15,
        threshold: stage4.connectorGrowthHouseThreshold,
        terrain
      });
    }
    connectorAdded += 1;
    connectedPairs.add(pair.pairKey);
  }

  if (extensions.maxPerVillage > 0 && connectorAdded < connectorTarget) {
    for (const neighbor of eligibleNeighbors) {
      if (extensionAdded >= extensions.maxPerVillage || connectorAdded + extensionAdded >= connectorTarget) {
        break;
      }

      const pair = buildPair(site, trunk, neighbor, planSeed, interVillage.minDistance);
      if (!pair || connectedPairs.has(pair.pairKey)) {
        continue;
      }

      const extensionChanceRoll = hashToUnit(hashCoords(pair.pairHash, 59, 61, 619));
      if (extensionChanceRoll > extensions.attemptChanceThreshold) {
        continue;
      }

      const extensionLengthBase = pair.span * extensions.targetSpanFraction;
      const extensionLength = Math.max(extensions.minLength, Math.min(extensions.maxLength, extensionLengthBase));
      const angle = Math.atan2(pair.remoteAnchor.y - pair.localAnchor.y, pair.remoteAnchor.x - pair.localAnchor.x);
      const angleJitter = (hashToUnit(hashCoords(pair.pairHash, 67, 71, 631)) * 2 - 1) * extensions.angleJitterMaxRad;
      const extension = createDirectionalRoad(
        `rve-${pair.pairKey}`,
        "branch",
        V2_SETTLEMENT_CONFIG.roads.width,
        pair.localAnchor.x,
        pair.localAnchor.y,
        angle + angleJitter,
        extensionLength,
        hashCoords(pair.pairHash, 73, 79, 641)
      );

      if (!canUseStage4Road(extension, roads, houses, terrain, extensions.roadDistanceMultiplier, extensions.houseClearanceExtra)) {
        continue;
      }

      roads.push(extension);
      if (extensions.spawnHouses) {
        growHousesAlongRoad({
          site,
          road: extension,
          slotCount: extensions.growthHouseSlotCount,
          roads,
          houses,
          seed: pair.pairHash ^ 0x4f1bbcdc,
          threshold: extensions.growthHouseThreshold,
          terrain
        });
      }
      extensionAdded += 1;
      connectedPairs.add(pair.pairKey);
    }
  }

  const remainingTarget = connectorTarget - (connectorAdded + extensionAdded);
  if (remainingTarget > 0 && outbound.maxPerVillage > 0) {
    outboundAdded = addOutboundRoads({
      site,
      trunk,
      roads,
      houses,
      planSeed,
      terrain,
      maxToAdd: Math.min(remainingTarget, outbound.maxPerVillage)
    });
  }

  return connectorAdded + extensionAdded + outboundAdded;
};

const resolveConnectorTargetCount = (site: VillageSite, planSeed: number): number => {
  const interVillage = V2_SETTLEMENT_CONFIG.stage4.interVillage;
  const min = Math.max(0, Math.min(interVillage.nearestTargetCountMin, interVillage.maxPerVillage));
  const max = Math.max(min, Math.min(interVillage.nearestTargetCountMax, interVillage.maxPerVillage));
  if (max <= 0) {
    return 0;
  }
  if (min === max) {
    return min;
  }
  const roll = hashToUnit(hashCoords(planSeed, site.cellX * 83 + 41, site.cellY * 97 + 47, 887));
  const range = max - min + 1;
  return min + Math.floor(roll * range);
};

const buildPair = (
  site: VillageSite,
  trunk: RoadSegment,
  neighbor: VillageSite,
  planSeed: number,
  minDistance: number
): PairBuild | null => {
  const lowId = site.id < neighbor.id ? site.id : neighbor.id;
  const highId = site.id < neighbor.id ? neighbor.id : site.id;
  const pairKey = `${lowId}|${highId}`;
  const pairHash = hashString(`${pairKey}:connector`);

  const localAnchorRoad = trunk;
  const localAnchor = closestPointOnRoad(localAnchorRoad, neighbor.x, neighbor.y).point;
  const neighborTrunk = buildTrunkRoad(neighbor, planSeed);
  const remoteAnchor = closestPointOnRoad(neighborTrunk, site.x, site.y).point;
  const span = Math.hypot(remoteAnchor.x - localAnchor.x, remoteAnchor.y - localAnchor.y);
  if (span < minDistance * 0.72) {
    return null;
  }

  return {
    pairKey,
    pairHash,
    span,
    localAnchor,
    remoteAnchor
  };
};

const buildConnectorRoad = (pair: PairBuild): RoadSegment => {
  const normalX = -(pair.remoteAnchor.y - pair.localAnchor.y) / Math.max(1, pair.span);
  const normalY = (pair.remoteAnchor.x - pair.localAnchor.x) / Math.max(1, pair.span);
  const bend = (hashToUnit(hashCoords(pair.pairHash, 23, 29, 607)) * 2 - 1) * Math.min(24, pair.span * 0.16);
  const mid = {
    x: (pair.localAnchor.x + pair.remoteAnchor.x) * 0.5 + normalX * bend,
    y: (pair.localAnchor.y + pair.remoteAnchor.y) * 0.5 + normalY * bend
  };

  return {
    id: `rv-${pair.pairKey}`,
    className: "branch",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points: [pair.localAnchor, mid, pair.remoteAnchor]
  };
};

type AddOutboundRoadsParams = {
  site: VillageSite;
  trunk: RoadSegment;
  roads: RoadSegment[];
  houses: House[];
  planSeed: number;
  terrain: V2TerrainSampler;
  maxToAdd: number;
};

const addOutboundRoads = ({ site, trunk, roads, houses, planSeed, terrain, maxToAdd }: AddOutboundRoadsParams): number => {
  const outbound = V2_SETTLEMENT_CONFIG.stage4.outbound;
  const attemptBudget = Math.max(maxToAdd * 8, 8);
  let added = 0;

  for (let i = 0; i < attemptBudget; i += 1) {
    if (added >= maxToAdd) {
      break;
    }
    const attemptHash = hashCoords(planSeed, site.cellX * 157 + i * 13, site.cellY * 163 + i * 17, 991);
    const roll = hashToUnit(hashCoords(attemptHash, 2, 3, 997));
    if (roll > outbound.attemptChanceThreshold) {
      continue;
    }

    const t = lerp(outbound.anchorTMin, outbound.anchorTMax, hashToUnit(hashCoords(attemptHash, 5, 7, 1009)));
    const anchor = sampleRoad(trunk.points, t);
    const baseAngle = Math.atan2(anchor.tangentY, anchor.tangentX);
    const sign: -1 | 1 = hashToUnit(hashCoords(attemptHash, 11, 13, 1013)) < 0.5 ? -1 : 1;
    const turn = lerp(outbound.minTurnRad, outbound.maxTurnRad, hashToUnit(hashCoords(attemptHash, 17, 19, 1021))) * sign;
    const length = lerp(outbound.minLength, outbound.maxLength, hashToUnit(hashCoords(attemptHash, 23, 29, 1031)));
    const outboundRoad = createDirectionalRoad(
      `rvo-${site.id}-${i}`,
      "branch",
      V2_SETTLEMENT_CONFIG.roads.width,
      anchor.x,
      anchor.y,
      baseAngle + turn,
      length,
      attemptHash
    );

    if (!canUseStage4Road(outboundRoad, roads, houses, terrain, outbound.roadDistanceMultiplier, outbound.houseClearanceExtra)) {
      continue;
    }

    roads.push(outboundRoad);
    if (outbound.spawnHouses) {
      growHousesAlongRoad({
        site,
        road: outboundRoad,
        slotCount: outbound.growthHouseSlotCount,
        roads,
        houses,
        seed: attemptHash ^ 0x2f6e2b1d,
        threshold: outbound.growthHouseThreshold,
        terrain
      });
    }
    added += 1;
  }

  return added;
};

const canUseStage4Road = (
  road: RoadSegment,
  roads: RoadSegment[],
  houses: House[],
  terrain: V2TerrainSampler,
  roadDistanceMultiplier: number,
  houseClearanceExtra: number,
  options?: { allowLastPointTouch?: boolean }
): boolean => {
  if (hasParallelRoadConflict(road, roads)) {
    return false;
  }
  if (
    !isRoadUsable(
      road.points,
      roads,
      V2_SETTLEMENT_CONFIG.roads.branch.minDistance * roadDistanceMultiplier,
      terrain,
      options
    )
  ) {
    return false;
  }
  if (
    isRoadNearHouses(
      road.points,
      houses,
      V2_SETTLEMENT_CONFIG.stage3.branching.houseClearance + houseClearanceExtra
    )
  ) {
    return false;
  }
  return true;
};

import { hashCoords, hashString, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, RoadSegment, VillageSite } from "../types";
import { closestPointOnRoad, hasParallelRoadConflict, isRoadUsable } from "./geometry";
import { growHousesAlongRoad, isRoadNearHouses } from "./housing";
import { collectNearbySites, SiteSelectionContext } from "./site-selection";
import { buildTrunkRoad } from "./trunk";

type AddInterVillageConnectorsParams = {
  site: VillageSite;
  trunk: RoadSegment;
  roads: RoadSegment[];
  houses: House[];
  planSeed: number;
  terrain: V2TerrainSampler;
  siteContext: SiteSelectionContext;
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
  const neighbors = collectNearbySites(siteContext, site, interVillage.maxDistance);
  let added = 0;

  for (const neighbor of neighbors) {
    if (added >= interVillage.maxPerVillage) {
      break;
    }
    if (site.id >= neighbor.id) {
      continue;
    }

    const dx = neighbor.x - site.x;
    const dy = neighbor.y - site.y;
    const dist = Math.hypot(dx, dy);
    if (dist < interVillage.minDistance || dist > interVillage.maxDistance) {
      continue;
    }

    const pairKey = `${site.id}|${neighbor.id}`;
    const pairHash = hashString(`${pairKey}:connector`);
    if (hashToUnit(hashCoords(pairHash, 11, 17, 601)) > 0.86) {
      continue;
    }

    const localAnchor = closestPointOnRoad(trunk, neighbor.x, neighbor.y);
    const neighborTrunk = buildTrunkRoad(neighbor, planSeed);
    const remoteAnchor = closestPointOnRoad(neighborTrunk, site.x, site.y);

    const span = Math.hypot(remoteAnchor.point.x - localAnchor.point.x, remoteAnchor.point.y - localAnchor.point.y);
    if (span < interVillage.minDistance * 0.85) {
      continue;
    }

    const normalX = -(remoteAnchor.point.y - localAnchor.point.y) / Math.max(1, span);
    const normalY = (remoteAnchor.point.x - localAnchor.point.x) / Math.max(1, span);
    const bend = (hashToUnit(hashCoords(pairHash, 23, 29, 607)) * 2 - 1) * Math.min(24, span * 0.16);
    const mid = {
      x: (localAnchor.point.x + remoteAnchor.point.x) * 0.5 + normalX * bend,
      y: (localAnchor.point.y + remoteAnchor.point.y) * 0.5 + normalY * bend
    };
    const connector: RoadSegment = {
      id: `rv-${pairKey}`,
      className: "branch",
      width: V2_SETTLEMENT_CONFIG.roads.width,
      points: [localAnchor.point, mid, remoteAnchor.point]
    };
    if (hasParallelRoadConflict(connector, roads)) {
      continue;
    }
    if (
      !isRoadUsable(
        connector.points,
        roads,
        V2_SETTLEMENT_CONFIG.roads.branch.minDistance * stage4.connectorRoadDistanceMultiplier,
        terrain,
        { allowLastPointTouch: true }
      )
    ) {
      continue;
    }
    if (isRoadNearHouses(connector.points, houses, V2_SETTLEMENT_CONFIG.stage3.branching.houseClearance + stage4.connectorHouseClearanceExtra)) {
      continue;
    }

    roads.push(connector);
    growHousesAlongRoad({
      site,
      road: connector,
      slotCount: stage4.connectorGrowthHouseSlotCount,
      roads,
      houses,
      seed: pairHash ^ 0x7f4a7c15,
      threshold: stage4.connectorGrowthHouseThreshold,
      terrain
    });
    added += 1;
  }

  return added;
};

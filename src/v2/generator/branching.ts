import { lerp } from "../../util/math";
import { hashCoords, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, RoadSegment, VillageSite } from "../types";
import { angularDistance, hasParallelRoadConflict, hasRoadReuseOpportunity, isRoadUsable, sampleRoad } from "./geometry";
import { growHousesAlongRoad, isRoadNearHouses } from "./housing";
import { computeStage3BranchTarget, Stage3GrowthProfile } from "./stage3-profile";
import { createDirectionalRoad } from "./trunk";

type BranchAnchor = {
  t: number;
  side: -1 | 1;
  angle: number;
};

type AddBranchesParams = {
  site: VillageSite;
  trunk: RoadSegment;
  roads: RoadSegment[];
  houses: House[];
  allowReuseHeuristic: boolean;
  planSeed: number;
  terrain: V2TerrainSampler;
  growthProfile: Stage3GrowthProfile;
};

export const addBranches = ({
  site,
  trunk,
  roads,
  houses,
  allowReuseHeuristic,
  planSeed,
  terrain,
  growthProfile
}: AddBranchesParams): number => {
  const stage3 = V2_SETTLEMENT_CONFIG.stage3;
  const branching = stage3.branching;
  const branchTarget = computeStage3BranchTarget(site, planSeed, growthProfile);
  const attemptBudget = Math.max(branchTarget * 8, Math.round(branchTarget * 8 * growthProfile.branchAttemptMultiplier));
  const anchorMinDeltaT = V2_SETTLEMENT_CONFIG.roads.branch.anchorMinDeltaT * growthProfile.branchAnchorSpacingMultiplier;
  let added = 0;
  const anchors: BranchAnchor[] = [];

  for (let i = 0; i < attemptBudget; i += 1) {
    if (added >= branchTarget) {
      break;
    }
    const localHash = hashCoords(planSeed, site.cellX * 71 + i, site.cellY * 89 + i, 181);
    if (hashToUnit(hashCoords(localHash, 2, 2, 191)) > growthProfile.branchCandidateGate) {
      continue;
    }
    const t = lerp(0.16, 0.84, hashToUnit(hashCoords(localHash, 3, 5, 193)));
    const sample = sampleRoad(trunk.points, t);
    const side: -1 | 1 = hashToUnit(hashCoords(localHash, 7, 11, 197)) < 0.5 ? -1 : 1;
    const angleOffset = lerp(0.7, 1.18, hashToUnit(hashCoords(localHash, 13, 17, 199))) * side;
    const baseAngle = Math.atan2(sample.tangentY, sample.tangentX) + angleOffset;
    const lengthRoll = hashToUnit(hashCoords(localHash, 19, 23, 211));
    const lengthVariance = lerp(0.94, 1.12, hashToUnit(hashCoords(localHash, 41, 43, 217)));
    const length =
      lerp(branching.candidateLengthMin, branching.candidateLengthMax, lengthRoll) *
      growthProfile.branchLengthMultiplier *
      lengthVariance;
    if (hasNearbyBranchAnchor(t, side, baseAngle, anchors, anchorMinDeltaT)) {
      continue;
    }
    const branch = createDirectionalRoad(
      `rb-${site.id}-${i}`,
      "branch",
      V2_SETTLEMENT_CONFIG.roads.width,
      sample.x,
      sample.y,
      baseAngle,
      length,
      localHash
    );
    if (allowReuseHeuristic && hasRoadReuseOpportunity(branch, roads)) {
      continue;
    }

    if (hasParallelRoadConflict(branch, roads)) {
      continue;
    }
    if (!isRoadUsable(branch.points, roads, V2_SETTLEMENT_CONFIG.roads.branch.minDistance, terrain)) {
      continue;
    }
    if (isRoadNearHouses(branch.points, houses, branching.houseClearance - 1.5)) {
      continue;
    }

    roads.push(branch);
    anchors.push({ t, side, angle: baseAngle });
    growHousesAlongRoad({
      site,
      road: branch,
      slotCount: branching.growthHouseSlotCount,
      roads,
      houses,
      seed: localHash ^ 0x27d4eb2f,
      threshold: branching.growthHouseThreshold,
      terrain
    });
    added += 1;
  }

  if (added === 0) {
    const fallbackTs = [0.14, 0.86];
    for (let i = 0; i < fallbackTs.length; i += 1) {
      const sample = sampleRoad(trunk.points, fallbackTs[i]);
      const side: -1 | 1 = i === 0 ? -1 : 1;
      const angle = Math.atan2(sample.tangentY, sample.tangentX) + side * 0.92;
      if (hasNearbyBranchAnchor(fallbackTs[i], side, angle, anchors, anchorMinDeltaT)) {
        continue;
      }
      const hash = hashCoords(planSeed, site.cellX, site.cellY, 1201 + i * 13);
      const fallback = createDirectionalRoad(
        `rbf-${site.id}-${i}`,
        "branch",
        V2_SETTLEMENT_CONFIG.roads.width,
        sample.x,
        sample.y,
        angle,
        branching.fallbackLength * growthProfile.branchLengthMultiplier,
        hash
      );
      if (allowReuseHeuristic && hasRoadReuseOpportunity(fallback, roads)) {
        continue;
      }
      if (hasParallelRoadConflict(fallback, roads)) {
        continue;
      }
      if (!isRoadUsable(fallback.points, roads, branching.fallbackMinRoadDistance, terrain)) {
        continue;
      }
      if (isRoadNearHouses(fallback.points, houses, branching.houseClearance - 2)) {
        continue;
      }
      roads.push(fallback);
      anchors.push({ t: fallbackTs[i], side, angle });
      growHousesAlongRoad({
        site,
        road: fallback,
        slotCount: branching.fallbackHouseSlotCount,
        roads,
        houses,
        seed: hash ^ 0x27d4eb2f,
        threshold: branching.growthHouseThreshold,
        terrain
      });
      added += 1;
    }
  }

  return added;
};

const hasNearbyBranchAnchor = (t: number, side: -1 | 1, angle: number, anchors: BranchAnchor[], minDeltaT: number): boolean => {
  for (const anchor of anchors) {
    if (anchor.side !== side) {
      continue;
    }
    if (Math.abs(anchor.t - t) > minDeltaT) {
      continue;
    }
    if (angularDistance(anchor.angle, angle) < 0.52) {
      return true;
    }
  }
  return false;
};

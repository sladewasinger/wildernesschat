import { clamp } from "../../util/math";
import { hashCoords, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { VillageSite } from "../types";

export type Stage3GrowthProfileId = "sparse" | "normal" | "dense" | "burst";

export type Stage3GrowthProfile = {
  id: Stage3GrowthProfileId;
  branchTargetMultiplier: number;
  branchAttemptMultiplier: number;
  branchLengthMultiplier: number;
  branchAnchorSpacingMultiplier: number;
  branchCandidateGate: number;
  shortcutMaxCount: number;
  shortcutPairChance: number;
};

const buildProfile = (id: Stage3GrowthProfileId): Stage3GrowthProfile => {
  const profile = V2_SETTLEMENT_CONFIG.stage3.growthProfiles[id];
  return {
    id,
    branchTargetMultiplier: profile.branchTargetMultiplier,
    branchAttemptMultiplier: profile.branchAttemptMultiplier,
    branchLengthMultiplier: profile.branchLengthMultiplier,
    branchAnchorSpacingMultiplier: profile.branchAnchorSpacingMultiplier,
    branchCandidateGate: profile.branchCandidateGate,
    shortcutMaxCount: profile.shortcutMaxCount,
    shortcutPairChance: profile.shortcutPairChance
  };
};

export const pickStage3GrowthProfile = (site: VillageSite, planSeed: number): Stage3GrowthProfile => {
  const growthProfiles = V2_SETTLEMENT_CONFIG.stage3.growthProfiles;
  const roll = hashToUnit(hashCoords(planSeed, site.cellX * 29 + 17, site.cellY * 31 + 23, 887));

  if (roll < growthProfiles.burstChance) {
    return buildProfile("burst");
  }
  if (roll < growthProfiles.burstChance + growthProfiles.denseChance) {
    return buildProfile("dense");
  }
  if (roll > 1 - growthProfiles.sparseChance) {
    return buildProfile("sparse");
  }
  return buildProfile("normal");
};

export const computeStage3BranchTarget = (site: VillageSite, planSeed: number, profile: Stage3GrowthProfile): number => {
  const growthProfiles = V2_SETTLEMENT_CONFIG.stage3.growthProfiles;
  const base = 2 + site.score * 4;
  const extraRoll = hashToUnit(hashCoords(planSeed, site.cellX * 37 + 19, site.cellY * 41 + 29, 907));
  const extra = extraRoll * growthProfiles.branchExtraTargetMax;
  const target = Math.round((base + extra) * profile.branchTargetMultiplier);
  return clamp(target, 2, growthProfiles.branchTargetCap);
};

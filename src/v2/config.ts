export const V2_STAGE_MIN = 0;
export const V2_STAGE_MAX = 4;

export const V2_VIEW_CONFIG = {
  defaultZoom: 1.45,
  minZoom: 0.65,
  maxZoom: 2.8,
  keyZoomStep: 1.12,
  wheelZoomStep: 1.1,
  terrainWorldStep: 4
} as const;

export const V2_SETTLEMENT_CONFIG = {
  siting: {
    siteCellSize: 620,
    minSiteScore: 0.54
  },
  roads: {
    width: 3.2,
    branch: {
      minDistance: 6.2,
      parallelDistance: 16,
      parallelMaxAngleDeg: 18,
      anchorMinDeltaT: 0.17,
      reuseSnapMinDistance: 14,
      reuseSnapMaxDistance: 58,
      reuseMaxAngleDeg: 18
    }
  },
  housing: {
    houseScale: 2.4,
    houseSpacingPadding: 12,
    houseSetbackMin: 24,
    houseSetbackMax: 38,
    houseRoadClearance: 12
  },
  stage2: {
    trunkGrowth: {
      slotCount: 14,
      threshold: 0.8
    }
  },
  stage3: {
    branching: {
      houseClearance: 11,
      growthHouseSlotCount: 7,
      growthHouseThreshold: 0.61,
      candidateLengthMin: 82,
      candidateLengthMax: 176,
      fallbackLength: 116,
      fallbackMinRoadDistance: 5.8,
      fallbackHouseSlotCount: 6
    },
    shortcuts: {
      houseClearance: 10,
      minBranchStartDistance: 52,
      minAngleDeg: 35,
      minSpanDistance: 72,
      maxSpanDistance: 184
    },
    growthProfiles: {
      // Primary village-size levers: profile mix and branch target cap.
      burstChance: 0.2,
      denseChance: 0.38,
      sparseChance: 0.08,
      branchTargetCap: 15,
      branchExtraTargetMax: 3,
      sparse: {
        branchTargetMultiplier: 0.82,
        branchAttemptMultiplier: 1,
        branchLengthMultiplier: 0.94,
        branchAnchorSpacingMultiplier: 1.08,
        branchCandidateGate: 0.64,
        shortcutMaxCount: 1,
        shortcutPairChance: 0.3
      },
      normal: {
        // Raising normal multipliers increases overall village size, not just rare bursts.
        branchTargetMultiplier: 1.8,
        branchAttemptMultiplier: 1.35,
        branchLengthMultiplier: 3,
        branchAnchorSpacingMultiplier: 0.95,
        branchCandidateGate: 0.78,
        shortcutMaxCount: 1,
        shortcutPairChance: 0.4
      },
      dense: {
        branchTargetMultiplier: 1.6,
        branchAttemptMultiplier: 2.05,
        branchLengthMultiplier: 1.2,
        branchAnchorSpacingMultiplier: 0.8,
        branchCandidateGate: 0.86,
        shortcutMaxCount: 2,
        shortcutPairChance: 0.58
      },
      burst: {
        branchTargetMultiplier: 2.35,
        branchAttemptMultiplier: 2.8,
        branchLengthMultiplier: 1.36,
        branchAnchorSpacingMultiplier: 0.66,
        branchCandidateGate: 0.92,
        shortcutMaxCount: 3,
        shortcutPairChance: 0.74
      }
    }
  },
  stage4: {
    interVillage: {
      minDistance: 320,
      maxDistance: 980,
      maxPerVillage: 2
    },
    connectorRoadDistanceMultiplier: 0.65,
    connectorHouseClearanceExtra: 2,
    connectorGrowthHouseSlotCount: 6,
    connectorGrowthHouseThreshold: 0.66
  }
} as const;

export const V2_RENDER_CONFIG = {
  roadOutlinePad: 2.6,
  roadOutlineColor: "rgba(8, 10, 11, 0.9)",
  roadFillColor: "rgba(212, 198, 158, 0.97)"
} as const;

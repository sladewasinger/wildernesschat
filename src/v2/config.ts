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
  siteCellSize: 620,
  minSiteScore: 0.54,
  houseScale: 2.4,
  houseSpacingPadding: 12,
  houseSetbackMin: 24,
  houseSetbackMax: 38,
  houseRoadClearance: 12,
  branchRoadHouseClearance: 11,
  shortcutRoadHouseClearance: 10,
  roadWidth: 3.2,
  branchRoadMinDistance: 6.2,
  branchParallelDistance: 16,
  branchParallelMaxAngleDeg: 18,
  branchAnchorMinDeltaT: 0.17,
  branchReuseSnapMinDistance: 14,
  branchReuseSnapMaxDistance: 58,
  branchReuseMaxAngleDeg: 18,
  shortcutMaxCount: 1,
  shortcutMinBranchStartDistance: 52,
  shortcutMinAngleDeg: 35,
  interVillageMinDistance: 320,
  interVillageMaxDistance: 980,
  interVillageMaxPerVillage: 2
} as const;

export const V2_RENDER_CONFIG = {
  roadOutlinePad: 2.6,
  roadOutlineColor: "rgba(8, 10, 11, 0.9)",
  roadFillColor: "rgba(212, 198, 158, 0.97)"
} as const;

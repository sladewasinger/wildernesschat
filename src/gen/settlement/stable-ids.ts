export const villageIdForCell = (cellX: number, cellY: number): string => {
  return `v-${cellX},${cellY}`;
};

export const roadEdgeKey = (villageAId: string, villageBId: string): string => {
  return villageAId < villageBId ? `${villageAId}|${villageBId}` : `${villageBId}|${villageAId}`;
};

export const regionalRoadId = (edgeKey: string): string => {
  return `r-${edgeKey}`;
};

export const localSpokeRoadId = (villageId: string, spokeIndex: number): string => {
  return `rl-${villageId}-${spokeIndex}`;
};

export const localBranchRoadId = (villageId: string, spokeIndex: number, branchIndex: number): string => {
  return `rlb-${villageId}-${spokeIndex}-${branchIndex}`;
};

export const parcelIdForRoadPosition = (roadId: string, segmentIndex: number, stepIndex: number, side: -1 | 1): string => {
  return `p-${roadId}-${segmentIndex}-${stepIndex}-${side}`;
};

export const houseIdForParcel = (parcelId: string): string => {
  return `h-${parcelId}`;
};

export const roadNodeId = (roadId: string, position: "start" | "end"): string => {
  return `rn-${roadId}-${position}`;
};

export const bridgeNodeId = (roadId: string, bridgeIndex: number): string => {
  return `rnb-${roadId}-${bridgeIndex}`;
};

export const roadGraphEdgeId = (roadId: string): string => {
  return `re-${roadId}`;
};

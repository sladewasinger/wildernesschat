export type Point = {
  x: number;
  y: number;
};

export type V3LodLevel = "low" | "medium" | "high";

export type TerrainFeatureKind = "none" | "lake" | "river";

export type TerrainFeatureSample = {
  kind: TerrainFeatureKind;
  lakeMask: number;
  riverMask: number;
  waterMask: number;
};

export type TerrainSample = TerrainFeatureSample & {
  height: number;
};

export type TerrainRenderStats = {
  lod: V3LodLevel;
  activeChunks: number;
  worldStep: number;
  cellsDrawn: number;
  lakeCells: number;
  riverCells: number;
};

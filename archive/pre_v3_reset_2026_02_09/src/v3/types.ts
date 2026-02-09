export type Point = {
  x: number;
  y: number;
};

export type WaterKind = "none" | "river" | "lake";

export type WaterSample = {
  lakeMask: number;
  riverMask: number;
  waterMask: number;
  kind: WaterKind;
};

export type TerrainSample = WaterSample & {
  grassTone: number;
};

export type TerrainRenderStats = {
  worldStep: number;
  cellsDrawn: number;
  lakeCells: number;
  riverCells: number;
};

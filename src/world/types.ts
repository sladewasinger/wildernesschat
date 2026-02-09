import { RenderTexture, Sprite } from "pixi.js";
import { V3LodLevel } from "../types";

export type ChunkDirtyFlags = {
  fill: boolean;
  outline: boolean;
  roads: boolean;
  buildings: boolean;
};

export type ContourPath = {
  points: { x: number; y: number }[];
  closed: boolean;
};

export type ChunkGeneratedData = {
  seed: number;
  chunkX: number;
  chunkY: number;
  lod: V3LodLevel;
  sampleStep: number;
  cols: number;
  rows: number;
  paddingCells: number;
  chunkSize: number;
  waterMask: Float32Array;
  xCoords: Float32Array;
  yCoords: Float32Array;
  cellsDrawn: number;
  lakeCells: number;
  riverCells: number;
};

export type ChunkGeometry = {
  shallowContours: ContourPath[];
  midContours: ContourPath[];
  deepContours: ContourPath[];
  shallowFillContours: ContourPath[];
  midFillContours: ContourPath[];
  deepFillContours: ContourPath[];
};

export type ChunkDisplay = {
  sprite: Sprite;
  texture: RenderTexture;
  bleed: number;
};

export type ChunkRecord = {
  key: string;
  lod: V3LodLevel;
  chunkX: number;
  chunkY: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  generatedData: ChunkGeneratedData;
  geometry: ChunkGeometry;
  display: ChunkDisplay;
  dirty: ChunkDirtyFlags;
  lastTouchedFrame: number;
};

import { V3_CHUNK_CONFIG, V3_LOD_CONFIG } from "../config";
import { hashString } from "../lib/hash";
import { V3LodLevel } from "../types";
import { V3TerrainSampler } from "../terrain-sampler";
import { ChunkGeneratedData } from "./types";

export class V3ChunkGenerator {
  private readonly worldSeed: string;
  private readonly sampler: V3TerrainSampler;

  constructor(worldSeed: string, sampler: V3TerrainSampler) {
    this.worldSeed = worldSeed;
    this.sampler = sampler;
  }

  generate(chunkX: number, chunkY: number, lod: V3LodLevel): ChunkGeneratedData {
    const chunkSize = V3_CHUNK_CONFIG.worldSize;
    const paddingCells = V3_CHUNK_CONFIG.samplePaddingCells;
    const sampleStep = this.sampleStepForLod(lod);
    if (chunkSize % sampleStep !== 0) {
      throw new Error(`Invalid chunk sampling config: chunkSize=${chunkSize} must be divisible by sampleStep=${sampleStep}.`);
    }
    const innerCols = chunkSize / sampleStep + 1;
    const innerRows = chunkSize / sampleStep + 1;
    const cols = innerCols + paddingCells * 2;
    const rows = innerRows + paddingCells * 2;
    const waterMask = new Float32Array(cols * rows);
    const xCoords = new Float32Array(cols);
    const yCoords = new Float32Array(rows);

    for (let gx = 0; gx < cols; gx += 1) {
      xCoords[gx] = (gx - paddingCells) * sampleStep;
    }
    for (let gy = 0; gy < rows; gy += 1) {
      yCoords[gy] = (gy - paddingCells) * sampleStep;
    }

    let cellsDrawn = 0;
    let lakeCells = 0;
    let riverCells = 0;
    const chunkOriginX = chunkX * chunkSize;
    const chunkOriginY = chunkY * chunkSize;
    for (let gy = 0; gy < rows; gy += 1) {
      const localY = yCoords[gy];
      for (let gx = 0; gx < cols; gx += 1) {
        const localX = xCoords[gx];
        const sample = this.sampler.sampleAt(chunkOriginX + localX, chunkOriginY + localY);
        waterMask[this.index(gx, gy, cols)] = sample.waterMask;
        const isInnerX = gx >= paddingCells && gx < cols - paddingCells;
        const isInnerY = gy >= paddingCells && gy < rows - paddingCells;
        if (!isInnerX || !isInnerY) {
          continue;
        }
        cellsDrawn += 1;
        if (sample.kind === "lake") {
          lakeCells += 1;
        } else if (sample.kind === "river") {
          riverCells += 1;
        }
      }
    }
    return {
      seed: hashString(`${this.worldSeed}:${chunkX}:${chunkY}:${lod}`),
      chunkX,
      chunkY,
      lod,
      sampleStep,
      cols,
      rows,
      paddingCells,
      chunkSize,
      waterMask,
      xCoords,
      yCoords,
      cellsDrawn,
      lakeCells,
      riverCells
    };
  }

  private sampleStepForLod(lod: V3LodLevel): number {
    if (lod === "high") {
      return V3_LOD_CONFIG.high.sampleStep;
    }
    if (lod === "medium") {
      return V3_LOD_CONFIG.medium.sampleStep;
    }
    return V3_LOD_CONFIG.low.sampleStep;
  }

  private index(x: number, y: number, cols: number): number {
    return y * cols + x;
  }
}

import { V3_CACHE_CONFIG } from "./config";
import { V3HeightField } from "./height-field";
import { V3RiverField } from "./river-field";
import { TerrainSample } from "./types";

export class V3TerrainSampler {
  private readonly heightField: V3HeightField;
  private readonly riverField: V3RiverField;
  private readonly sampleCache = new Map<number, Map<number, TerrainSample>>();
  private cachedSampleCount = 0;

  constructor(seed: string) {
    this.heightField = new V3HeightField();
    this.riverField = new V3RiverField(seed);
  }

  sampleAt(x: number, y: number): TerrainSample {
    const quantize = V3_CACHE_CONFIG.sampleQuantize;
    const qx = Math.round(x * quantize);
    const qy = Math.round(y * quantize);
    const cached = this.sampleCache.get(qy)?.get(qx);
    if (cached) {
      return cached;
    }

    const sx = qx / quantize;
    const sy = qy / quantize;
    const featureSample = this.riverField.sampleAt(sx, sy);
    const sample: TerrainSample = {
      height: this.heightField.heightAtPos(sx, sy),
      ...featureSample
    };

    const row = this.sampleCache.get(qy);
    if (row) {
      row.set(qx, sample);
    } else {
      this.sampleCache.set(qy, new Map<number, TerrainSample>([[qx, sample]]));
    }
    this.cachedSampleCount += 1;
    if (this.cachedSampleCount > V3_CACHE_CONFIG.maxCachedSamples) {
      this.sampleCache.clear();
      this.cachedSampleCount = 0;
    }
    return sample;
  }

  cachedSamples(): number {
    return this.cachedSampleCount;
  }

  heightAtPos(x: number, y: number): number {
    return this.heightField.heightAtPos(x, y);
  }
}

import { hashString } from "../gen/hash";
import { fbm2D, FbmOptions } from "../gen/noise";
import { clamp } from "../util/math";
import { V3_CACHE_CONFIG } from "./config";
import { TerrainSample } from "./types";
import { V3WaterField } from "./water-field";

const GRASS_MACRO_OPTIONS: FbmOptions = {
  octaves: 4,
  persistence: 0.57,
  lacunarity: 2.08
};

const GRASS_DETAIL_OPTIONS: FbmOptions = {
  octaves: 3,
  persistence: 0.48,
  lacunarity: 2.22
};

export class V3TerrainSampler {
  private readonly grassMacroSeed: number;
  private readonly grassDetailSeed: number;
  private readonly waterField: V3WaterField;
  private readonly sampleCache = new Map<number, Map<number, TerrainSample>>();
  private cachedSampleCount = 0;

  constructor(seed: string) {
    this.grassMacroSeed = hashString(`${seed}:v3:grass:macro`);
    this.grassDetailSeed = hashString(`${seed}:v3:grass:detail`);
    this.waterField = new V3WaterField(seed);
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
    const water = this.waterField.sampleAt(sx, sy);
    const sample: TerrainSample = {
      ...water,
      grassTone: this.sampleGrassTone(sx, sy)
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

  private sampleGrassTone(x: number, y: number): number {
    const macro = fbm2D(this.grassMacroSeed, x * 0.00072, y * 0.00072, GRASS_MACRO_OPTIONS);
    const detail = fbm2D(this.grassDetailSeed, x * 0.0022, y * 0.0022, GRASS_DETAIL_OPTIONS);
    return clamp(macro * 0.78 + detail * 0.22, 0, 1);
  }
}

import { clamp } from "../util/math";
import { hashString } from "../gen/hash";
import { fbm2D } from "../gen/noise";

const ELEVATION_OPTIONS = {
  octaves: 5,
  persistence: 0.52,
  lacunarity: 2.05
} as const;

const MACRO_OPTIONS = {
  octaves: 4,
  persistence: 0.56,
  lacunarity: 2.1
} as const;

export class V2TerrainSampler {
  private readonly warpSeed: number;
  private readonly macroSeed: number;
  private readonly localSeed: number;
  private readonly renderElevationCache = new Map<number, Map<number, number>>();
  private renderElevationCount = 0;

  constructor(seed: string) {
    this.warpSeed = hashString(`${seed}:v2:warp`);
    this.macroSeed = hashString(`${seed}:v2:macro`);
    this.localSeed = hashString(`${seed}:v2:local`);
  }

  elevationAt(x: number, y: number): number {
    const warpX = (fbm2D(this.warpSeed, x * 0.0008, y * 0.0008, ELEVATION_OPTIONS) - 0.5) * 120;
    const warpY = (fbm2D(this.warpSeed ^ 0x7f4a7c15, x * 0.0008, y * 0.0008, ELEVATION_OPTIONS) - 0.5) * 120;
    const wx = x + warpX;
    const wy = y + warpY;

    const macro = fbm2D(this.macroSeed, wx * 0.00022, wy * 0.00022, MACRO_OPTIONS);
    const local = fbm2D(this.localSeed, wx * 0.00105, wy * 0.00105, ELEVATION_OPTIONS);
    return clamp(macro * 0.72 + local * 0.28, 0, 1);
  }

  slopeAt(x: number, y: number): number {
    const step = 12;
    const l = this.elevationAt(x - step, y);
    const r = this.elevationAt(x + step, y);
    const d = this.elevationAt(x, y - step);
    const u = this.elevationAt(x, y + step);
    return Math.hypot(r - l, u - d);
  }

  elevationAtRender(x: number, y: number): number {
    const qx = Math.round(x * 4);
    const qy = Math.round(y * 4);
    const row = this.renderElevationCache.get(qy);
    if (row) {
      const cached = row.get(qx);
      if (cached !== undefined) {
        return cached;
      }
    }

    const value = this.elevationAt(x, y);
    if (row) {
      row.set(qx, value);
    } else {
      this.renderElevationCache.set(qy, new Map<number, number>([[qx, value]]));
    }

    this.renderElevationCount += 1;
    if (this.renderElevationCount > 240000) {
      this.renderElevationCache.clear();
      this.renderElevationCount = 0;
    }

    return value;
  }
}

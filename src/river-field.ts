import { V3_RIVER_CONFIG } from "./config";
import { hashCoords, hashString, hashToUnit } from "./lib/hash";
import { clamp, lerp, smoothstep } from "./lib/math";
import { TerrainFeatureSample } from "./types";

export type RiverRenderPath = {
  width: number;
  points: { x: number; y: number }[];
};

const TOPO = {
  baseScale: 3200,
  detailScale: 1400,
  warpScale: 2600,
  warpStrength: 360,
  derivativeStep: 26,
  seaLevel: -0.045,
  lakeFeather: 0.1,
  contourStep: 0.082,
  contourWidth: 0.115,
  riverLowStart: -0.01,
  riverLowEnd: 0.24,
  valleyMin: 0.001,
  valleyMax: 0.016,
  slopeMin: 0.001,
  slopeMax: 0.028,
  islandScale: 1900
} as const;

export class V3RiverField {
  private readonly heightSeedA: number;
  private readonly heightSeedB: number;
  private readonly warpSeedX: number;
  private readonly warpSeedY: number;
  private readonly channelSeed: number;
  private readonly islandSeed: number;
  private readonly contourOffset: number;

  constructor(seed: string) {
    this.heightSeedA = hashString(`${seed}:topo:height-a`);
    this.heightSeedB = hashString(`${seed}:topo:height-b`);
    this.warpSeedX = hashString(`${seed}:topo:warp-x`);
    this.warpSeedY = hashString(`${seed}:topo:warp-y`);
    this.channelSeed = hashString(`${seed}:topo:channel`);
    this.islandSeed = hashString(`${seed}:topo:island`);
    this.contourOffset = lerp(-0.5, 0.5, hashToUnit(hashString(`${seed}:topo:contour-offset`)));
  }

  sampleAt(x: number, y: number): TerrainFeatureSample {
    const height = this.heightAt(x, y);
    const lakeMask = this.lakeMaskAt(x, y, height);
    const riverMask = this.riverMaskAt(x, y, height, lakeMask);
    const waterMask = Math.max(lakeMask, riverMask);
    if (waterMask < V3_RIVER_CONFIG.kindThreshold) {
      return { kind: "none", lakeMask, riverMask, waterMask };
    }
    return {
      kind: lakeMask >= riverMask ? "lake" : "river",
      lakeMask,
      riverMask,
      waterMask
    };
  }

  riverPathsInBounds(
    _minX: number,
    _minY: number,
    _maxX: number,
    _maxY: number,
    _padding = 0
  ): RiverRenderPath[] {
    // Rivers are now rendered from the shared water contour field.
    return [];
  }

  private heightAt(x: number, y: number): number {
    const wx = this.fbm(this.warpSeedX, x, y, TOPO.warpScale, 3) * TOPO.warpStrength;
    const wy = this.fbm(this.warpSeedY, x, y, TOPO.warpScale, 3) * TOPO.warpStrength;

    const broad = this.fbm(this.heightSeedA, x + wx, y + wy, TOPO.baseScale, 5);
    const detail = this.fbm(this.heightSeedB, x - wx * 0.45, y + wy * 0.35, TOPO.detailScale, 4);
    const ridge = 1 - Math.abs(this.fbm(this.channelSeed, x, y, TOPO.detailScale * 0.7, 3));

    return broad * 0.68 + detail * 0.24 + ridge * 0.08;
  }

  private lakeMaskAt(x: number, y: number, height: number): number {
    const depth = 1 - smoothstep(TOPO.seaLevel, TOPO.seaLevel + TOPO.lakeFeather, height);
    if (depth <= 0) {
      return 0;
    }

    const islandBase = this.valueNoise(this.islandSeed, x, y, TOPO.islandScale);
    const islandCandidate = smoothstep(0.74, 0.9, islandBase * 0.5 + 0.5);
    const deepLake = smoothstep(0.55, 0.95, depth);
    const islandMask = islandCandidate * deepLake;
    return clamp(depth * (1 - islandMask), 0, 1);
  }

  private riverMaskAt(x: number, y: number, height: number, lakeMask: number): number {
    const step = TOPO.derivativeStep;
    const hx1 = this.heightAt(x + step, y);
    const hx0 = this.heightAt(x - step, y);
    const hy1 = this.heightAt(x, y + step);
    const hy0 = this.heightAt(x, y - step);

    const dx = (hx1 - hx0) / (step * 2);
    const dy = (hy1 - hy0) / (step * 2);
    const slope = Math.hypot(dx, dy);
    const laplacian = hx1 + hx0 + hy1 + hy0 - height * 4;

    const valley = smoothstep(TOPO.valleyMin, TOPO.valleyMax, laplacian);
    const lowland = 1 - smoothstep(TOPO.seaLevel + TOPO.riverLowStart, TOPO.seaLevel + TOPO.riverLowEnd, height);
    const slopeGate = 1 - smoothstep(TOPO.slopeMin, TOPO.slopeMax, slope);
    const contour = this.contourBand(height);
    const channel = smoothstep(0.48, 0.78, this.fbm(this.channelSeed, x, y, TOPO.detailScale * 0.8, 3) * 0.5 + 0.5);

    const raw = (contour * 0.66 + channel * 0.18) * lowland * (valley * 0.5 + slopeGate * 0.18 + 0.06);
    return clamp(raw * (1 - lakeMask * 0.9), 0, 1);
  }

  private contourBand(height: number): number {
    const u = (height - this.contourOffset) / TOPO.contourStep;
    const f = u - Math.floor(u);
    const d = Math.min(f, 1 - f);
    return 1 - smoothstep(TOPO.contourWidth * 0.5, TOPO.contourWidth, d);
  }

  private fbm(seed: number, x: number, y: number, scale: number, octaves: number): number {
    let total = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let norm = 0;

    for (let i = 0; i < octaves; i += 1) {
      total += this.valueNoise(seed + i * 1013904223, x * frequency, y * frequency, scale) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    if (norm <= 1e-9) {
      return 0;
    }
    return total / norm;
  }

  private valueNoise(seed: number, x: number, y: number, scale: number): number {
    const fx = x / scale;
    const fy = y / scale;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);

    const n00 = this.corner(seed, x0, y0);
    const n10 = this.corner(seed, x1, y0);
    const n01 = this.corner(seed, x0, y1);
    const n11 = this.corner(seed, x1, y1);

    const nx0 = lerp(n00, n10, sx);
    const nx1 = lerp(n01, n11, sx);
    return lerp(nx0, nx1, sy);
  }

  private corner(seed: number, x: number, y: number): number {
    return hashToUnit(hashCoords(seed, x, y)) * 2 - 1;
  }
}

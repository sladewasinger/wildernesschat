import { hashCoords, hashString, hashToUnit } from "../gen/hash";
import { fbm2D, FbmOptions } from "../gen/noise";
import { clamp, lerp, smoothstep } from "../util/math";
import { V3_WATER_CONFIG } from "./config";
import { WaterKind, WaterSample } from "./types";

const WARP_OPTIONS: FbmOptions = {
  octaves: 4,
  persistence: 0.54,
  lacunarity: 2.06
};

const LAKE_EDGE_OPTIONS: FbmOptions = {
  octaves: 3,
  persistence: 0.52,
  lacunarity: 2.08
};

const RIVER_OPTIONS: FbmOptions = {
  octaves: 5,
  persistence: 0.52,
  lacunarity: 2.02
};

const RIVER_DENSITY_OPTIONS: FbmOptions = {
  octaves: 4,
  persistence: 0.55,
  lacunarity: 2.1
};

export class V3WaterField {
  private readonly macroWarpXSeed: number;
  private readonly macroWarpYSeed: number;
  private readonly lakeLayoutSeed: number;
  private readonly lakePresenceSeed: number;
  private readonly lakeRadiusSeed: number;
  private readonly lakeEdgeSeed: number;
  private readonly riverSeed: number;
  private readonly riverWarpXSeed: number;
  private readonly riverWarpYSeed: number;
  private readonly riverDensitySeed: number;
  private readonly lakeCellCache = new Map<string, LakeCandidate | null>();

  constructor(seed: string) {
    this.macroWarpXSeed = hashString(`${seed}:v3:water:macro-warp-x`);
    this.macroWarpYSeed = hashString(`${seed}:v3:water:macro-warp-y`);
    this.lakeLayoutSeed = hashString(`${seed}:v3:water:lake-layout`);
    this.lakePresenceSeed = hashString(`${seed}:v3:water:lake-presence`);
    this.lakeRadiusSeed = hashString(`${seed}:v3:water:lake-radius`);
    this.lakeEdgeSeed = hashString(`${seed}:v3:water:lake-edge`);
    this.riverSeed = hashString(`${seed}:v3:water:river`);
    this.riverWarpXSeed = hashString(`${seed}:v3:water:river-warp-x`);
    this.riverWarpYSeed = hashString(`${seed}:v3:water:river-warp-y`);
    this.riverDensitySeed = hashString(`${seed}:v3:water:river-density`);
  }

  sampleAt(x: number, y: number): WaterSample {
    const macroWarped = this.applyMacroWarp(x, y);
    const lakeMask = this.sampleLakeMask(macroWarped.x, macroWarped.y);
    const riverMask = this.sampleRiverMask(macroWarped.x, macroWarped.y, lakeMask);
    const rawWaterMask = Math.max(lakeMask, riverMask);
    const waterMask = rawWaterMask <= V3_WATER_CONFIG.kindThreshold
      ? 0
      : clamp((rawWaterMask - V3_WATER_CONFIG.kindThreshold) / (1 - V3_WATER_CONFIG.kindThreshold), 0, 1);
    const kind = this.classifyWaterKind(lakeMask, riverMask, waterMask);
    return {
      lakeMask,
      riverMask,
      waterMask,
      kind
    };
  }

  private applyMacroWarp(x: number, y: number): { x: number; y: number } {
    const freq = V3_WATER_CONFIG.macroWarpFrequency;
    const amp = V3_WATER_CONFIG.macroWarpAmplitude;
    const warpX = (fbm2D(this.macroWarpXSeed, x * freq, y * freq, WARP_OPTIONS) - 0.5) * amp;
    const warpY = (fbm2D(this.macroWarpYSeed, x * freq, y * freq, WARP_OPTIONS) - 0.5) * amp;
    return {
      x: x + warpX,
      y: y + warpY
    };
  }

  private sampleLakeMask(x: number, y: number): number {
    const cellSize = V3_WATER_CONFIG.lakeCellSize;
    const baseCellX = Math.floor(x / cellSize);
    const baseCellY = Math.floor(y / cellSize);
    const searchRadiusCells = Math.max(1, Math.ceil(V3_WATER_CONFIG.lakeRadiusMax / cellSize) + 1);
    let mask = 0;

    for (let oy = -searchRadiusCells; oy <= searchRadiusCells; oy += 1) {
      for (let ox = -searchRadiusCells; ox <= searchRadiusCells; ox += 1) {
        const candidate = this.resolveLakeCandidate(baseCellX + ox, baseCellY + oy);
        if (!candidate) {
          continue;
        }
        const dx = x - candidate.centerX;
        const dy = y - candidate.centerY;
        const dist = Math.hypot(dx, dy);
        const edgeNoise = fbm2D(
          this.lakeEdgeSeed,
          (x + candidate.centerX * 0.37) * V3_WATER_CONFIG.lakeEdgeNoiseFrequency,
          (y + candidate.centerY * 0.37) * V3_WATER_CONFIG.lakeEdgeNoiseFrequency,
          LAKE_EDGE_OPTIONS
        );
        const irregularScale = clamp(
          1 + (edgeNoise - 0.5) * 2 * V3_WATER_CONFIG.lakeEdgeNoiseAmplitude,
          0.56,
          1.46
        );
        const effectiveRadius = candidate.radius * irregularScale;
        const normalizedDistance = dist / Math.max(1, effectiveRadius);
        const lakeContribution =
          1 -
          smoothstep(
            1 - V3_WATER_CONFIG.lakeEdgeFeather,
            1 + V3_WATER_CONFIG.lakeEdgeFeather,
            normalizedDistance
          );
        if (lakeContribution > mask) {
          mask = lakeContribution;
        }
      }
    }

    return clamp(Math.pow(clamp(mask, 0, 1), V3_WATER_CONFIG.lakeMaskPower), 0, 1);
  }

  private sampleLakeProximity(x: number, y: number): number {
    const cellSize = V3_WATER_CONFIG.lakeCellSize;
    const baseCellX = Math.floor(x / cellSize);
    const baseCellY = Math.floor(y / cellSize);
    const reach = V3_WATER_CONFIG.lakeRadiusMax * V3_WATER_CONFIG.riverLakeReach;
    const searchRadiusCells = Math.max(1, Math.ceil(reach / cellSize));
    let proximity = 0;

    for (let oy = -searchRadiusCells; oy <= searchRadiusCells; oy += 1) {
      for (let ox = -searchRadiusCells; ox <= searchRadiusCells; ox += 1) {
        const candidate = this.resolveLakeCandidate(baseCellX + ox, baseCellY + oy);
        if (!candidate) {
          continue;
        }
        const dist = Math.hypot(x - candidate.centerX, y - candidate.centerY);
        const candidateReach = candidate.radius * V3_WATER_CONFIG.riverLakeReach;
        const candidateProximity = 1 - clamp(dist / Math.max(1, candidateReach), 0, 1);
        if (candidateProximity > proximity) {
          proximity = candidateProximity;
        }
      }
    }

    return clamp(proximity, 0, 1);
  }

  private sampleRiverMask(x: number, y: number, lakeMask: number): number {
    const riverWarpX = (fbm2D(this.riverWarpXSeed, x * V3_WATER_CONFIG.riverWarpFrequency, y * V3_WATER_CONFIG.riverWarpFrequency, WARP_OPTIONS) - 0.5) * V3_WATER_CONFIG.riverWarpAmplitude;
    const riverWarpY = (fbm2D(this.riverWarpYSeed, x * V3_WATER_CONFIG.riverWarpFrequency, y * V3_WATER_CONFIG.riverWarpFrequency, WARP_OPTIONS) - 0.5) * V3_WATER_CONFIG.riverWarpAmplitude;
    const rx = x + riverWarpX;
    const ry = y + riverWarpY;

    const riverCenterNoise = fbm2D(this.riverSeed, rx * V3_WATER_CONFIG.riverFrequency, ry * V3_WATER_CONFIG.riverFrequency, RIVER_OPTIONS);
    const centerDistance = Math.abs(riverCenterNoise - 0.5);
    const densityNoise = fbm2D(
      this.riverDensitySeed,
      rx * V3_WATER_CONFIG.riverDensityFrequency,
      ry * V3_WATER_CONFIG.riverDensityFrequency,
      RIVER_DENSITY_OPTIONS
    );
    const densityBase = smoothstep(V3_WATER_CONFIG.riverDensityLow, V3_WATER_CONFIG.riverDensityHigh, densityNoise);
    const lakeProximity = this.sampleLakeProximity(rx, ry);
    const densityMask = clamp(densityBase * 0.76 + lakeProximity * V3_WATER_CONFIG.riverLakeBoost, 0, 1);
    if (densityMask <= 0.01) {
      return 0;
    }
    const riverWidth = lerp(V3_WATER_CONFIG.riverWidthMin, V3_WATER_CONFIG.riverWidthMax, densityMask);
    const riverCore = 1 - smoothstep(riverWidth, riverWidth + V3_WATER_CONFIG.riverWidthFeather, centerDistance);
    const riverMask = riverCore * densityMask * (1 - lakeMask * 0.22);
    return clamp(riverMask, 0, 1);
  }

  private classifyWaterKind(lakeMask: number, riverMask: number, waterMask: number): WaterKind {
    if (waterMask <= 0) {
      return "none";
    }
    return lakeMask >= riverMask ? "lake" : "river";
  }

  private resolveLakeCandidate(cellX: number, cellY: number): LakeCandidate | null {
    const key = `${cellX}:${cellY}`;
    const cached = this.lakeCellCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const presence = hashToUnit(hashCoords(this.lakePresenceSeed, cellX, cellY));
    if (presence > V3_WATER_CONFIG.lakeCellChance) {
      this.lakeCellCache.set(key, null);
      return null;
    }

    const cellSize = V3_WATER_CONFIG.lakeCellSize;
    const jitterRange = 0.5 * V3_WATER_CONFIG.lakeJitter;
    const jx = hashToUnit(hashCoords(this.lakeLayoutSeed, cellX, cellY, 1));
    const jy = hashToUnit(hashCoords(this.lakeLayoutSeed, cellX, cellY, 2));
    const fx = 0.5 + (jx * 2 - 1) * jitterRange;
    const fy = 0.5 + (jy * 2 - 1) * jitterRange;
    const radiusNoise = hashToUnit(hashCoords(this.lakeRadiusSeed, cellX, cellY, 3));
    const candidate: LakeCandidate = {
      centerX: (cellX + fx) * cellSize,
      centerY: (cellY + fy) * cellSize,
      radius: lerp(V3_WATER_CONFIG.lakeRadiusMin, V3_WATER_CONFIG.lakeRadiusMax, radiusNoise)
    };
    this.lakeCellCache.set(key, candidate);
    return candidate;
  }
}

type LakeCandidate = {
  centerX: number;
  centerY: number;
  radius: number;
};

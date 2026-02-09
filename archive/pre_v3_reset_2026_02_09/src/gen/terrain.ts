import { clamp, smoothstep } from "../util/math";
import { WorldConfig } from "./config";
import { hashString } from "./hash";
import { FbmOptions, fbm2D } from "./noise";

export type TerrainSample = {
  elevation: number;
  moisture: number;
  waterDepth: number;
  shore: number;
};

export type TerrainProbe = TerrainSample & {
  slope: number;
  forestDensity: number;
};

export type Gradient2 = {
  x: number;
  y: number;
};

export type TerrainSampler = {
  sample: (x: number, y: number) => TerrainSample;
  probe: (x: number, y: number) => TerrainProbe;
  gradientAt: (x: number, y: number, epsilon?: number) => Gradient2;
  slopeAt: (x: number, y: number) => number;
  forestDensityAt: (x: number, y: number) => number;
};

type TerrainSeedSet = {
  elevation: number;
  continental: number;
  warpX: number;
  warpY: number;
  moisture: number;
};

const sampleSeeds = (seed: string): TerrainSeedSet => {
  return {
    elevation: hashString(`${seed}:terrain:elevation`),
    continental: hashString(`${seed}:terrain:continental`),
    warpX: hashString(`${seed}:terrain:warpX`),
    warpY: hashString(`${seed}:terrain:warpY`),
    moisture: hashString(`${seed}:terrain:moisture`)
  };
};

const buildOptions = (config: WorldConfig): { elevation: FbmOptions; moisture: FbmOptions } => {
  return {
    elevation: {
      octaves: config.terrain.elevationOctaves,
      persistence: config.terrain.elevationPersistence,
      lacunarity: config.terrain.elevationLacunarity
    },
    moisture: {
      octaves: config.terrain.moistureOctaves,
      persistence: config.terrain.moisturePersistence,
      lacunarity: config.terrain.moistureLacunarity
    }
  };
};

export const createTerrainSampler = (config: WorldConfig): TerrainSampler => {
  const seeds = sampleSeeds(config.seed);
  const options = buildOptions(config);

  const elevationAt = (x: number, y: number): number => {
    const warpX =
      (fbm2D(seeds.warpX, x * config.terrain.warpFrequency, y * config.terrain.warpFrequency, {
        octaves: 3,
        persistence: 0.54,
        lacunarity: 2.15
      }) *
        2 -
        1) *
      config.terrain.warpAmplitude;
    const warpY =
      (fbm2D(seeds.warpY, (x + 271.3) * config.terrain.warpFrequency, (y - 194.8) * config.terrain.warpFrequency, {
        octaves: 3,
        persistence: 0.54,
        lacunarity: 2.15
      }) *
        2 -
        1) *
      config.terrain.warpAmplitude;

    const wx = x + warpX;
    const wy = y + warpY;

    const local = fbm2D(
      seeds.elevation,
      wx * config.terrain.elevationFrequency,
      wy * config.terrain.elevationFrequency,
      options.elevation
    );
    const continental = fbm2D(
      seeds.continental,
      x * config.terrain.continentalFrequency,
      y * config.terrain.continentalFrequency,
      {
        octaves: 4,
        persistence: 0.58,
        lacunarity: 2
      }
    );

    const merged = clamp(local * 0.64 + continental * 0.36, 0, 1);
    const shaped = merged * merged * (3 - 2 * merged);
    return clamp(shaped, 0, 1);
  };

  const moistureAt = (x: number, y: number, waterDepth: number, shore: number): number => {
    const base = fbm2D(
      seeds.moisture,
      (x + 5000) * config.terrain.moistureFrequency,
      (y - 2800) * config.terrain.moistureFrequency,
      options.moisture
    );

    const coastalBoost = shore * 0.33;
    const waterBoost = waterDepth > 0 ? 0.19 : 0;
    return clamp(base * 0.72 + coastalBoost + waterBoost, 0, 1);
  };

  const sample = (x: number, y: number): TerrainSample => {
    const elevation = elevationAt(x, y);
    const waterDepth = config.terrain.seaLevel - elevation;
    const shore = 1 - clamp(Math.abs(waterDepth) / config.terrain.shoreBand, 0, 1);
    const moisture = moistureAt(x, y, waterDepth, shore);
    return {
      elevation,
      moisture,
      waterDepth,
      shore
    };
  };

  const gradientAt = (x: number, y: number, epsilon = 3): Gradient2 => {
    const dx = (elevationAt(x + epsilon, y) - elevationAt(x - epsilon, y)) / (2 * epsilon);
    const dy = (elevationAt(x, y + epsilon) - elevationAt(x, y - epsilon)) / (2 * epsilon);
    return { x: dx, y: dy };
  };

  const slopeAt = (x: number, y: number): number => {
    const gradient = gradientAt(x, y, 5);
    return clamp(Math.hypot(gradient.x, gradient.y) * 60, 0, 1);
  };

  const forestDensityAt = (x: number, y: number): number => {
    const data = sample(x, y);
    if (data.waterDepth > 0.012) {
      return 0;
    }
    const slope = slopeAt(x, y);
    const moistureFactor = smoothstep(0.28, 0.9, data.moisture);
    const flatnessFactor = 1 - smoothstep(0.22, 0.78, slope);
    const shorePenalty = smoothstep(0.6, 0.95, data.shore) * 0.3;
    const highlandPenalty = smoothstep(0.76, 0.98, data.elevation) * 0.35;
    return clamp(moistureFactor * 0.73 + flatnessFactor * 0.34 - shorePenalty - highlandPenalty, 0, 1);
  };

  const probe = (x: number, y: number): TerrainProbe => {
    const core = sample(x, y);
    const slope = slopeAt(x, y);
    const forestDensity = forestDensityAt(x, y);
    return {
      ...core,
      slope,
      forestDensity
    };
  };

  return {
    sample,
    probe,
    gradientAt,
    slopeAt,
    forestDensityAt
  };
};

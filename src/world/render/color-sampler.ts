import { DebugLayerConfig, WorldConfig } from "../../gen/config";
import { hashCoords, hashToUnit } from "../../gen/hash";
import { TerrainSample, TerrainSampler } from "../../gen/terrain";
import { clamp, lerp, smoothstep } from "../../util/math";

export type RgbColor = {
  r: number;
  g: number;
  b: number;
};

export class SurfaceColorSampler {
  private readonly terrain: TerrainSampler;
  private readonly config: WorldConfig;
  private readonly debug: DebugLayerConfig;
  private readonly seedHash: number;

  constructor(config: WorldConfig, terrain: TerrainSampler, debug: DebugLayerConfig, seedHash: number) {
    this.config = config;
    this.terrain = terrain;
    this.debug = debug;
    this.seedHash = seedHash;
  }

  sample(worldX: number, worldY: number, terrain: TerrainSample): RgbColor {
    if (this.debug.showWaterMask) {
      if (terrain.waterDepth > 0.001) {
        return { r: 84, g: 144, b: 212 };
      }
      if (terrain.shore > 0.48) {
        return { r: 188, g: 210, b: 175 };
      }
      return { r: 159, g: 191, b: 145 };
    }

    if (this.debug.showMoisture) {
      const moisture = clamp(terrain.moisture, 0, 1);
      if (moisture < 0.33) {
        const t = moisture / 0.33;
        return {
          r: lerp(25, 52, t),
          g: lerp(45, 122, t),
          b: lerp(120, 112, t)
        };
      }
      if (moisture < 0.66) {
        const t = (moisture - 0.33) / 0.33;
        return {
          r: lerp(52, 116, t),
          g: lerp(122, 178, t),
          b: lerp(112, 64, t)
        };
      }
      const t = (moisture - 0.66) / 0.34;
      return {
        r: lerp(116, 222, t),
        g: lerp(178, 201, t),
        b: lerp(64, 78, t)
      };
    }

    if (this.debug.showForestMask) {
      const density = this.terrain.forestDensityAt(worldX, worldY);
      return {
        r: lerp(18, 95, density),
        g: lerp(27, 198, density),
        b: lerp(22, 74, density)
      };
    }

    const noiseGrain = (hashToUnit(hashCoords(this.seedHash, worldX, worldY, 77)) - 0.5) * 7;

    const elevationTone = smoothstep(0.18, 0.87, terrain.elevation);
    const moistureTone = smoothstep(0.1, 0.92, terrain.moisture);
    let landR = lerp(132, 173, elevationTone) - moistureTone * 17;
    let landG = lerp(167, 196, elevationTone) - moistureTone * 11;
    let landB = lerp(122, 156, elevationTone) - moistureTone * 18;

    if (this.debug.showContours && this.config.terrain.contourInterval > 0) {
      const contourValue = (terrain.elevation / this.config.terrain.contourInterval) % 1;
      if (contourValue < this.config.terrain.contourStrength) {
        landR -= 18;
        landG -= 18;
        landB -= 18;
      }
    }

    const shoreBlend = terrain.shore * 0.42;
    landR = lerp(landR, 193, shoreBlend);
    landG = lerp(landG, 198, shoreBlend);
    landB = lerp(landB, 165, shoreBlend);
    landR += noiseGrain;
    landG += noiseGrain;
    landB += noiseGrain;

    const depthNorm = clamp(terrain.waterDepth / Math.max(this.config.terrain.shoreBand * 1.8, 0.001), 0, 1);
    const deepTone = smoothstep(0.22, 1, depthNorm);
    let waterR = lerp(86, 74, deepTone);
    let waterG = lerp(147, 131, deepTone);
    let waterB = lerp(214, 199, deepTone);
    const waterNoise = noiseGrain * 0.16;
    waterR += waterNoise;
    waterG += waterNoise;
    waterB += waterNoise;

    const waterCoverage = this.sampleWaterCoverage(worldX, worldY, terrain);
    const coastBlend = clamp(waterCoverage, 0, 1);
    let r = lerp(landR, waterR, coastBlend);
    let g = lerp(landG, waterG, coastBlend);
    let b = lerp(landB, waterB, coastBlend);

    const shorelineEdge = 1 - Math.abs(waterCoverage * 2 - 1);
    const shallowWater = 1 - smoothstep(0.003, 0.02, terrain.waterDepth);
    const waterOnly = smoothstep(0.8, 1, waterCoverage);
    const coastOutline = Math.max(shorelineEdge, smoothstep(0.82, 0.99, terrain.shore) * shallowWater * waterOnly);
    r = lerp(r, 27, coastOutline * 0.44);
    g = lerp(g, 52, coastOutline * 0.44);
    b = lerp(b, 80, coastOutline * 0.44);

    return { r, g, b };
  }

  private sampleWaterCoverage(worldX: number, worldY: number, terrain: TerrainSample): number {
    if (terrain.shore < 0.22) {
      return terrain.waterDepth > 0 ? 1 : 0;
    }

    let waterHits = 0;
    const offsets = [-0.28, 0.28];
    for (let oy = 0; oy < offsets.length; oy += 1) {
      for (let ox = 0; ox < offsets.length; ox += 1) {
        const sample = this.terrain.sample(worldX + offsets[ox], worldY + offsets[oy]);
        if (sample.waterDepth > 0) {
          waterHits += 1;
        }
      }
    }

    return waterHits / 4;
  }
}

import { WorldConfig } from "../../gen/config";
import { RiverPath } from "../../gen/rivers";
import { TerrainSample, TerrainSampler } from "../../gen/terrain";
import { clamp } from "../../util/math";
import { SurfaceColorSampler } from "./color-sampler";

const toByte = (value: number): number => {
  return Math.max(0, Math.min(255, Math.round(value)));
};

export class TerrainSurfaceRenderer {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly colorSampler: SurfaceColorSampler;

  constructor(config: WorldConfig, terrain: TerrainSampler, colorSampler: SurfaceColorSampler) {
    this.config = config;
    this.terrain = terrain;
    this.colorSampler = colorSampler;
  }

  render(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    chunkSize: number,
    step: number,
    rivers: RiverPath[]
  ): void {
    const segments = this.buildRiverSegments(rivers);
    if (step === 1) {
      this.renderFullResolution(ctx, startX, startY, chunkSize, segments);
      return;
    }
    this.renderBlockSampled(ctx, startX, startY, chunkSize, step, segments);
  }

  private renderFullResolution(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    chunkSize: number,
    riverSegments: RiverSegment[]
  ): void {
    const image = ctx.createImageData(chunkSize, chunkSize);
    const data = image.data;
    let cursor = 0;

    for (let y = 0; y < chunkSize; y += 1) {
      for (let x = 0; x < chunkSize; x += 1) {
        const worldX = startX + x;
        const worldY = startY + y;
        const terrain = this.sampleUnifiedWater(worldX, worldY, riverSegments);
        const color = this.colorSampler.sample(worldX, worldY, terrain);
        data[cursor] = toByte(color.r);
        data[cursor + 1] = toByte(color.g);
        data[cursor + 2] = toByte(color.b);
        data[cursor + 3] = 255;
        cursor += 4;
      }
    }

    ctx.putImageData(image, 0, 0);
  }

  private renderBlockSampled(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    chunkSize: number,
    step: number,
    riverSegments: RiverSegment[]
  ): void {
    const image = ctx.createImageData(chunkSize, chunkSize);
    const data = image.data;

    for (let y = 0; y < chunkSize; y += step) {
      for (let x = 0; x < chunkSize; x += step) {
        const blockWidth = Math.min(step, chunkSize - x);
        const blockHeight = Math.min(step, chunkSize - y);
        const sampleX = startX + x + step * 0.5;
        const sampleY = startY + y + step * 0.5;
        const terrain = this.sampleUnifiedWater(sampleX, sampleY, riverSegments);
        const nearShore = terrain.shore > 0.14;

        if (nearShore) {
          for (let by = 0; by < blockHeight; by += 1) {
            for (let bx = 0; bx < blockWidth; bx += 1) {
              const px = x + bx;
              const py = y + by;
              const worldX = startX + px + 0.5;
              const worldY = startY + py + 0.5;
              const subTerrain = this.sampleUnifiedWater(worldX, worldY, riverSegments);
              const color = this.colorSampler.sample(worldX, worldY, subTerrain);
              const cursor = (py * chunkSize + px) * 4;
              data[cursor] = toByte(color.r);
              data[cursor + 1] = toByte(color.g);
              data[cursor + 2] = toByte(color.b);
              data[cursor + 3] = 255;
            }
          }
          continue;
        }

        const color = this.colorSampler.sample(sampleX, sampleY, terrain);
        const r = toByte(color.r);
        const g = toByte(color.g);
        const b = toByte(color.b);
        for (let by = 0; by < blockHeight; by += 1) {
          for (let bx = 0; bx < blockWidth; bx += 1) {
            const px = x + bx;
            const py = y + by;
            const cursor = (py * chunkSize + px) * 4;
            data[cursor] = r;
            data[cursor + 1] = g;
            data[cursor + 2] = b;
            data[cursor + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(image, 0, 0);
  }

  private sampleUnifiedWater(worldX: number, worldY: number, riverSegments: RiverSegment[]): TerrainSample {
    const base = this.terrain.sample(worldX, worldY);
    if (riverSegments.length === 0) {
      return base;
    }

    const aaMargin = 1.4;
    let augmentedDepth = base.waterDepth;
    let boostMoisture = 0;

    for (const segment of riverSegments) {
      if (
        worldX < segment.minX - aaMargin ||
        worldX > segment.maxX + aaMargin ||
        worldY < segment.minY - aaMargin ||
        worldY > segment.maxY + aaMargin
      ) {
        continue;
      }

      const distance = this.distanceToSegment(worldX, worldY, segment.ax, segment.ay, segment.bx, segment.by);
      if (distance > segment.halfWidth + aaMargin) {
        continue;
      }

      if (distance <= segment.halfWidth) {
        const depthRatio = 1 - clamp(distance / Math.max(segment.halfWidth, 0.001), 0, 1);
        const maxRiverDepth = Math.min(0.048, this.config.terrain.shoreBand * 0.92);
        const syntheticDepth = 0.003 + depthRatio * maxRiverDepth;
        if (syntheticDepth > augmentedDepth) {
          augmentedDepth = syntheticDepth;
          boostMoisture = Math.max(boostMoisture, 0.16 * depthRatio + 0.06);
        }
      } else if (base.waterDepth <= 0.0015) {
        const fringeRatio = 1 - clamp((distance - segment.halfWidth) / aaMargin, 0, 1);
        const syntheticDepth = fringeRatio * 0.0018;
        if (syntheticDepth > augmentedDepth) {
          augmentedDepth = syntheticDepth;
          boostMoisture = Math.max(boostMoisture, 0.05 * fringeRatio);
        }
      }
    }

    if (augmentedDepth <= base.waterDepth + 1e-6) {
      return base;
    }

    const shore = 1 - clamp(Math.abs(augmentedDepth) / this.config.terrain.shoreBand, 0, 1);
    return {
      elevation: base.elevation,
      moisture: clamp(base.moisture + boostMoisture, 0, 1),
      waterDepth: augmentedDepth,
      shore: Math.max(base.shore, shore)
    };
  }

  private buildRiverSegments(rivers: RiverPath[]): RiverSegment[] {
    const segments: RiverSegment[] = [];
    for (const river of rivers) {
      if (river.points.length < 2) {
        continue;
      }
      const halfWidth = Math.max(1.4, river.width * 0.5);
      for (let i = 1; i < river.points.length; i += 1) {
        const a = river.points[i - 1];
        const b = river.points[i];
        segments.push({
          ax: a.x,
          ay: a.y,
          bx: b.x,
          by: b.y,
          halfWidth,
          minX: Math.min(a.x, b.x),
          maxX: Math.max(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxY: Math.max(a.y, b.y)
        });
      }
    }
    return segments;
  }

  private distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const vx = bx - ax;
    const vy = by - ay;
    const lenSq = vx * vx + vy * vy;
    if (lenSq <= 1e-6) {
      return Math.hypot(px - ax, py - ay);
    }
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / lenSq, 0, 1);
    const qx = ax + vx * t;
    const qy = ay + vy * t;
    return Math.hypot(px - qx, py - qy);
  }
}

type RiverSegment = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  halfWidth: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

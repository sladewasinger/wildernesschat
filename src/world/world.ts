import { clamp, floorDiv, lerp, smoothstep } from "../util/math";
import { DebugLayerConfig, WorldConfig } from "../gen/config";
import { hashCoords, hashString, hashToUnit, mixUint32 } from "../gen/hash";
import { RiverSystem } from "../gen/rivers";
import { TerrainProbe, TerrainSampler, createTerrainSampler } from "../gen/terrain";

type Chunk = {
  x: number;
  y: number;
  canvas: HTMLCanvasElement;
};

const chunkKey = (x: number, y: number): string => `${x},${y}`;

const toByte = (value: number): number => {
  return Math.max(0, Math.min(255, Math.round(value)));
};

export class World {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly rivers: RiverSystem;
  private readonly seedHash: number;
  private readonly treeSeed: number;
  private readonly chunkCache = new Map<string, Chunk>();
  private readonly debug: DebugLayerConfig;

  constructor(config: WorldConfig) {
    this.config = config;
    this.terrain = createTerrainSampler(config);
    this.rivers = new RiverSystem(config, this.terrain);
    this.seedHash = hashString(`${config.seed}:surface`);
    this.treeSeed = hashString(`${config.seed}:trees`);
    this.debug = { ...config.debug };
  }

  getSeed(): string {
    return this.config.seed;
  }

  getChunkSize(): number {
    return this.config.chunk.pixelSize;
  }

  getDebugLayers(): DebugLayerConfig {
    return { ...this.debug };
  }

  toggleDebugLayer(layer: keyof DebugLayerConfig): void {
    this.debug[layer] = !this.debug[layer];
    this.chunkCache.clear();
  }

  sampleAt(worldX: number, worldY: number): TerrainProbe {
    return this.terrain.probe(worldX, worldY);
  }

  getChunkCanvas(chunkX: number, chunkY: number): HTMLCanvasElement {
    return this.getChunk(chunkX, chunkY).canvas;
  }

  private getChunk(chunkX: number, chunkY: number): Chunk {
    const key = chunkKey(chunkX, chunkY);
    const cached = this.chunkCache.get(key);
    if (cached) {
      return cached;
    }

    const chunk: Chunk = {
      x: chunkX,
      y: chunkY,
      canvas: this.renderChunk(chunkX, chunkY)
    };
    this.chunkCache.set(key, chunk);
    this.pruneCache();
    return chunk;
  }

  private pruneCache(): void {
    const max = this.config.chunk.maxCachedChunks;
    if (this.chunkCache.size <= max) {
      return;
    }
    const overflow = this.chunkCache.size - max;
    const keys = this.chunkCache.keys();
    for (let i = 0; i < overflow; i += 1) {
      const next = keys.next();
      if (next.done) {
        break;
      }
      this.chunkCache.delete(next.value);
    }
  }

  private renderChunk(chunkX: number, chunkY: number): HTMLCanvasElement {
    const chunkSize = this.getChunkSize();
    const startX = chunkX * chunkSize;
    const startY = chunkY * chunkSize;
    const canvas = document.createElement("canvas");
    canvas.width = chunkSize;
    canvas.height = chunkSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable.");
    }

    const image = ctx.createImageData(chunkSize, chunkSize);
    const data = image.data;
    let cursor = 0;

    for (let y = 0; y < chunkSize; y += 1) {
      for (let x = 0; x < chunkSize; x += 1) {
        const worldX = startX + x;
        const worldY = startY + y;
        const terrain = this.terrain.sample(worldX, worldY);
        const color = this.sampleColor(worldX, worldY, terrain);
        data[cursor] = toByte(color.r);
        data[cursor + 1] = toByte(color.g);
        data[cursor + 2] = toByte(color.b);
        data[cursor + 3] = 255;
        cursor += 4;
      }
    }

    ctx.putImageData(image, 0, 0);
    this.drawRivers(ctx, startX, startY, chunkSize);
    this.drawForest(ctx, startX, startY, chunkSize);
    return canvas;
  }

  private sampleColor(
    worldX: number,
    worldY: number,
    terrain: { elevation: number; moisture: number; waterDepth: number; shore: number }
  ): { r: number; g: number; b: number } {
    if (this.debug.showWaterMask) {
      if (terrain.waterDepth > 0) {
        const depth = clamp(terrain.waterDepth / 0.24, 0, 1);
        return {
          r: lerp(95, 5, depth),
          g: lerp(135, 16, depth),
          b: lerp(165, 41, depth)
        };
      }
      return { r: 155, g: 166, b: 158 };
    }

    if (this.debug.showMoisture) {
      return {
        r: lerp(30, 170, terrain.moisture),
        g: lerp(48, 220, terrain.moisture),
        b: lerp(42, 120, terrain.moisture)
      };
    }

    if (this.debug.showForestMask) {
      const density = this.terrain.forestDensityAt(worldX, worldY);
      return {
        r: lerp(36, 180, density),
        g: lerp(52, 205, density),
        b: lerp(36, 150, density)
      };
    }

    const noiseGrain = (hashToUnit(hashCoords(this.seedHash, worldX, worldY, 77)) - 0.5) * 7;

    if (terrain.waterDepth > 0) {
      const depth = clamp(terrain.waterDepth / 0.24, 0, 1);
      const ripple = Math.sin((worldX + worldY * 0.31) * 0.045 + depth * 6) * 0.5 + 0.5;
      const coastal = terrain.shore;

      return {
        r: lerp(108, 10, depth) + ripple * 4 + coastal * 28 + noiseGrain * 0.3,
        g: lerp(129, 24, depth) + ripple * 5 + coastal * 20 + noiseGrain * 0.3,
        b: lerp(138, 50, depth) + ripple * 8 + coastal * 10 + noiseGrain * 0.2
      };
    }

    const elevationTone = smoothstep(0.18, 0.87, terrain.elevation);
    const moistureTone = smoothstep(0.1, 0.92, terrain.moisture);
    let r = lerp(136, 173, elevationTone) - moistureTone * 15;
    let g = lerp(144, 178, elevationTone) - moistureTone * 8;
    let b = lerp(138, 170, elevationTone) - moistureTone * 13;

    if (this.debug.showContours && this.config.terrain.contourInterval > 0) {
      const contourValue = (terrain.elevation / this.config.terrain.contourInterval) % 1;
      if (contourValue < this.config.terrain.contourStrength) {
        r -= 18;
        g -= 18;
        b -= 18;
      }
    }

    const shoreBlend = terrain.shore * 0.35;
    r = lerp(r, 184, shoreBlend);
    g = lerp(g, 185, shoreBlend);
    b = lerp(b, 176, shoreBlend);

    r += noiseGrain;
    g += noiseGrain;
    b += noiseGrain;
    return { r, g, b };
  }

  private drawRivers(ctx: CanvasRenderingContext2D, startX: number, startY: number, chunkSize: number): void {
    if (!this.debug.showRivers) {
      return;
    }

    const margin = 28;
    const minX = startX - margin;
    const maxX = startX + chunkSize + margin;
    const minY = startY - margin;
    const maxY = startY + chunkSize + margin;
    const rivers = this.rivers.getRiversForBounds(minX, maxX, minY, maxY);

    for (const river of rivers) {
      if (river.points.length < 2) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(river.points[0].x - startX, river.points[0].y - startY);
      for (let i = 1; i < river.points.length; i += 1) {
        ctx.lineTo(river.points[i].x - startX, river.points[i].y - startY);
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(14, 28, 46, 0.72)";
      ctx.lineWidth = river.width + 1.8;
      ctx.stroke();

      ctx.strokeStyle = "rgba(124, 160, 188, 0.55)";
      ctx.lineWidth = river.width;
      ctx.stroke();
    }
  }

  private drawForest(ctx: CanvasRenderingContext2D, startX: number, startY: number, chunkSize: number): void {
    const cellSize = this.config.vegetation.treeGridSize;
    const margin = this.config.vegetation.treeRenderMargin;
    const minCellX = floorDiv(startX - margin, cellSize);
    const maxCellX = floorDiv(startX + chunkSize + margin, cellSize);
    const minCellY = floorDiv(startY - margin, cellSize);
    const maxCellY = floorDiv(startY + chunkSize + margin, cellSize);
    const denseThreshold = this.config.vegetation.forestDenseThreshold;
    const minDensity = this.config.vegetation.forestMinDensity;

    const densePoints: { x: number; y: number; radius: number; alpha: number }[] = [];
    const edgePoints: { x: number; y: number; radius: number; alpha: number }[] = [];

    for (let gy = minCellY; gy <= maxCellY; gy += 1) {
      for (let gx = minCellX; gx <= maxCellX; gx += 1) {
        const baseHash = hashCoords(this.treeSeed, gx, gy);
        const jitterX = hashToUnit(mixUint32(baseHash ^ 0xa5b35721));
        const jitterY = hashToUnit(mixUint32(baseHash ^ 0xf12c9d43));
        const worldX = gx * cellSize + jitterX * cellSize;
        const worldY = gy * cellSize + jitterY * cellSize;
        const density = this.terrain.forestDensityAt(worldX, worldY);
        if (density < minDensity) {
          continue;
        }

        const chance = clamp((density - minDensity) / (1 - minDensity), 0, 1);
        const roll = hashToUnit(mixUint32(baseHash ^ 0x6d2b79f5));
        if (roll > chance * chance) {
          continue;
        }

        const radiusScale = hashToUnit(mixUint32(baseHash ^ 0x9e3779b9));
        const radius = lerp(this.config.vegetation.treeMinRadius, this.config.vegetation.treeMaxRadius, density) * (0.8 + radiusScale * 0.5);
        const localX = worldX - startX;
        const localY = worldY - startY;

        if (density >= denseThreshold) {
          densePoints.push({
            x: localX,
            y: localY,
            radius,
            alpha: clamp(0.32 + density * 0.34, 0.2, 0.7)
          });
        } else {
          edgePoints.push({
            x: localX,
            y: localY,
            radius: radius * 0.72,
            alpha: clamp(0.42 + density * 0.3, 0.25, 0.7)
          });
        }
      }
    }

    for (const tree of densePoints) {
      ctx.fillStyle = `rgba(49, 63, 72, ${tree.alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineWidth = 1;
    for (const tree of edgePoints) {
      ctx.fillStyle = `rgba(74, 90, 100, ${tree.alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(27, 35, 42, 0.92)";
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

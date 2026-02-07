import { clamp, floorDiv, lerp, smoothstep } from "../util/math";
import { DebugLayerConfig, WorldConfig } from "../gen/config";
import { hashCoords, hashString, hashToUnit, mixUint32 } from "../gen/hash";
import { RiverSystem } from "../gen/rivers";
import { House, SettlementFeatures, SettlementSystem, Village } from "../gen/settlements";
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
  private readonly settlements: SettlementSystem;
  private readonly seedHash: number;
  private readonly treeSeed: number;
  private readonly chunkCache = new Map<string, Chunk>();
  private readonly debug: DebugLayerConfig;

  constructor(config: WorldConfig) {
    this.config = config;
    this.terrain = createTerrainSampler(config);
    this.rivers = new RiverSystem(config, this.terrain);
    this.settlements = new SettlementSystem(config, this.terrain);
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
    const featureMargin = 140;
    const features = this.settlements.getFeaturesForBounds(
      startX - featureMargin,
      startX + chunkSize + featureMargin,
      startY - featureMargin,
      startY + chunkSize + featureMargin
    );
    this.drawRoadsAndVillages(ctx, startX, startY, features);
    this.drawHouses(ctx, startX, startY, features);
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
          r: lerp(94, 14, depth),
          g: lerp(130, 26, depth),
          b: lerp(168, 60, depth)
        };
      }
      return { r: 155, g: 178, b: 144 };
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
        r: lerp(110, 18, depth) + ripple * 4 + coastal * 24 + noiseGrain * 0.25,
        g: lerp(152, 42, depth) + ripple * 5 + coastal * 20 + noiseGrain * 0.25,
        b: lerp(184, 76, depth) + ripple * 8 + coastal * 10 + noiseGrain * 0.2
      };
    }

    const elevationTone = smoothstep(0.18, 0.87, terrain.elevation);
    const moistureTone = smoothstep(0.1, 0.92, terrain.moisture);
    let r = lerp(132, 173, elevationTone) - moistureTone * 17;
    let g = lerp(167, 196, elevationTone) - moistureTone * 11;
    let b = lerp(122, 156, elevationTone) - moistureTone * 18;

    if (this.debug.showContours && this.config.terrain.contourInterval > 0) {
      const contourValue = (terrain.elevation / this.config.terrain.contourInterval) % 1;
      if (contourValue < this.config.terrain.contourStrength) {
        r -= 18;
        g -= 18;
        b -= 18;
      }
    }

    const shoreBlend = terrain.shore * 0.42;
    r = lerp(r, 193, shoreBlend);
    g = lerp(g, 198, shoreBlend);
    b = lerp(b, 165, shoreBlend);

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
      ctx.fillStyle = `rgba(79, 109, 94, ${tree.alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineWidth = 1;
    for (const tree of edgePoints) {
      ctx.fillStyle = `rgba(117, 161, 138, ${tree.alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(37, 56, 47, 0.9)";
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawRoadsAndVillages(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    features: SettlementFeatures
  ): void {
    if (!this.debug.showRoads && !this.debug.showVillages) {
      return;
    }

    if (this.debug.showRoads) {
      for (const road of features.roads) {
        if (road.points.length < 2) {
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(road.points[0].x - startX, road.points[0].y - startY);
        for (let i = 1; i < road.points.length; i += 1) {
          ctx.lineTo(road.points[i].x - startX, road.points[i].y - startY);
        }

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = road.type === "major" ? "rgba(72, 72, 58, 0.55)" : "rgba(78, 82, 70, 0.45)";
        ctx.lineWidth = road.width + 2.2;
        ctx.stroke();

        ctx.strokeStyle = road.type === "major" ? "rgba(215, 206, 166, 0.98)" : "rgba(199, 191, 154, 0.92)";
        ctx.lineWidth = road.width;
        ctx.stroke();
      }
    }

    if (this.debug.showVillages) {
      this.drawVillageMarkers(ctx, startX, startY, features.villages);
    }
  }

  private drawVillageMarkers(
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    villages: Village[]
  ): void {
    for (const village of villages) {
      const x = village.x - startX;
      const y = village.y - startY;
      const radius = clamp(village.radius * 0.1, 4, 10);
      ctx.fillStyle = "rgba(247, 236, 201, 0.88)";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(50, 60, 52, 0.82)";
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
  }

  private drawHouses(ctx: CanvasRenderingContext2D, startX: number, startY: number, features: SettlementFeatures): void {
    if (!this.debug.showHouses) {
      return;
    }

    for (const house of features.houses) {
      this.drawHouse(ctx, startX, startY, house);
    }
  }

  private drawHouse(ctx: CanvasRenderingContext2D, startX: number, startY: number, house: House): void {
    const x = house.x - startX;
    const y = house.y - startY;
    const roofPalette = [
      { roof: "#907367", wall: "#c3b59d" },
      { roof: "#6f7680", wall: "#b7b8b0" },
      { roof: "#8f6654", wall: "#c2b19e" },
      { roof: "#7d6f5f", wall: "#bbb09f" }
    ];
    const palette = roofPalette[house.roofStyle % roofPalette.length];

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(house.angle);

    ctx.fillStyle = "rgba(25, 33, 38, 0.2)";
    ctx.fillRect(-house.width * 0.55 + 1.5, -house.depth * 0.5 + 2.5, house.width, house.depth);

    ctx.fillStyle = palette.wall;
    ctx.strokeStyle = "rgba(49, 51, 47, 0.8)";
    ctx.lineWidth = 1;
    ctx.fillRect(-house.width * 0.5, -house.depth * 0.5, house.width, house.depth);
    ctx.strokeRect(-house.width * 0.5, -house.depth * 0.5, house.width, house.depth);

    ctx.fillStyle = palette.roof;
    ctx.fillRect(-house.width * 0.6, -house.depth * 0.52, house.width * 1.2, house.depth * 0.58);
    ctx.strokeRect(-house.width * 0.6, -house.depth * 0.52, house.width * 1.2, house.depth * 0.58);

    ctx.strokeStyle = "rgba(45, 38, 35, 0.42)";
    ctx.beginPath();
    ctx.moveTo(-house.width * 0.55, -house.depth * 0.4);
    ctx.lineTo(house.width * 0.55, -house.depth * 0.4);
    ctx.stroke();

    ctx.restore();
  }
}

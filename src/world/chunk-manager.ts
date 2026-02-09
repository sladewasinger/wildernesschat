import { Container, Renderer } from "pixi.js";
import { V3_CHUNK_CONFIG, V3_LOD_CONFIG } from "../config";
import { V3LodLevel, TerrainRenderStats } from "../types";
import { V3TerrainSampler } from "../terrain-sampler";
import { V3ChunkBaker } from "./chunk-baker";
import { V3ChunkGenerator } from "./chunk-generator";
import { V3ChunkMesher } from "./chunk-mesher";
import { ChunkRecord } from "./types";

export class V3ChunkManager {
  private readonly worldSeed: string;
  private readonly worldContainer: Container;
  private readonly generator: V3ChunkGenerator;
  private readonly mesher = new V3ChunkMesher();
  private readonly baker: V3ChunkBaker;
  private readonly cache = new Map<string, ChunkRecord>();
  private readonly activeKeys = new Set<string>();
  private frameCounter = 0;

  constructor(renderer: Renderer, worldContainer: Container, worldSeed: string, sampler: V3TerrainSampler) {
    this.worldSeed = worldSeed;
    this.worldContainer = worldContainer;
    this.generator = new V3ChunkGenerator(worldSeed, sampler);
    this.baker = new V3ChunkBaker(renderer);
  }

  update(
    viewMinX: number,
    viewMinY: number,
    viewMaxX: number,
    viewMaxY: number,
    zoom: number
  ): TerrainRenderStats {
    this.frameCounter += 1;
    const lod = this.resolveLod(zoom);
    const chunkSize = V3_CHUNK_CONFIG.worldSize;
    const padding = V3_CHUNK_CONFIG.visiblePaddingChunks * chunkSize;
    const minChunkX = Math.floor((viewMinX - padding) / chunkSize);
    const maxChunkX = Math.floor((viewMaxX + padding) / chunkSize);
    const minChunkY = Math.floor((viewMinY - padding) / chunkSize);
    const maxChunkY = Math.floor((viewMaxY + padding) / chunkSize);
    const nextActive = new Set<string>();

    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        const key = this.keyFor(chunkX, chunkY, lod);
        const record = this.ensureChunk(chunkX, chunkY, lod);
        record.lastTouchedFrame = this.frameCounter;
        nextActive.add(key);
        if (!this.activeKeys.has(key)) {
          this.worldContainer.addChild(record.display.sprite);
        }
      }
    }

    for (const key of this.activeKeys) {
      if (nextActive.has(key)) {
        continue;
      }
      const record = this.cache.get(key);
      if (!record) {
        continue;
      }
      if (record.display.sprite.parent === this.worldContainer) {
        this.worldContainer.removeChild(record.display.sprite);
      }
    }

    this.activeKeys.clear();
    for (const key of nextActive) {
      this.activeKeys.add(key);
    }

    let cellsDrawn = 0;
    let lakeCells = 0;
    let riverCells = 0;
    for (const key of this.activeKeys) {
      const record = this.cache.get(key);
      if (!record) {
        continue;
      }
      cellsDrawn += record.generatedData.cellsDrawn;
      lakeCells += record.generatedData.lakeCells;
      riverCells += record.generatedData.riverCells;
    }

    return {
      lod,
      activeChunks: this.activeKeys.size,
      worldStep: this.sampleStepForLod(lod),
      cellsDrawn,
      lakeCells,
      riverCells
    };
  }

  destroy(): void {
    for (const record of this.cache.values()) {
      this.destroyChunkRecord(record);
    }
    this.cache.clear();
    this.activeKeys.clear();
  }

  private ensureChunk(chunkX: number, chunkY: number, lod: V3LodLevel): ChunkRecord {
    const key = this.keyFor(chunkX, chunkY, lod);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const generatedData = this.generator.generate(chunkX, chunkY, lod);
    const geometry = this.mesher.mesh(generatedData);
    const bleed = generatedData.sampleStep * generatedData.paddingCells;
    const display = this.baker.bake(geometry, lod, generatedData.chunkSize, bleed, this.zoomHintForLod(lod));
    display.sprite.x = chunkX * generatedData.chunkSize - display.bleed;
    display.sprite.y = chunkY * generatedData.chunkSize - display.bleed;

    const record: ChunkRecord = {
      key,
      lod,
      chunkX,
      chunkY,
      bounds: {
        minX: chunkX * generatedData.chunkSize,
        minY: chunkY * generatedData.chunkSize,
        maxX: (chunkX + 1) * generatedData.chunkSize,
        maxY: (chunkY + 1) * generatedData.chunkSize
      },
      generatedData,
      geometry,
      display,
      dirty: { fill: false, outline: false, roads: false, buildings: false },
      lastTouchedFrame: this.frameCounter
    };
    this.cache.set(key, record);
    return record;
  }

  private destroyChunkRecord(record: ChunkRecord): void {
    if (record.display.sprite.parent) {
      record.display.sprite.parent.removeChild(record.display.sprite);
    }
    record.display.sprite.destroy({ texture: true, textureSource: true });
  }

  private resolveLod(zoom: number): V3LodLevel {
    if (zoom >= V3_LOD_CONFIG.high.minZoom) {
      return "high";
    }
    if (zoom >= V3_LOD_CONFIG.medium.minZoom) {
      return "medium";
    }
    return "low";
  }

  private sampleStepForLod(lod: V3LodLevel): number {
    if (lod === "high") {
      return V3_LOD_CONFIG.high.sampleStep;
    }
    if (lod === "medium") {
      return V3_LOD_CONFIG.medium.sampleStep;
    }
    return V3_LOD_CONFIG.low.sampleStep;
  }

  private zoomHintForLod(lod: V3LodLevel): number {
    if (lod === "high") {
      return V3_LOD_CONFIG.high.minZoom;
    }
    if (lod === "medium") {
      return V3_LOD_CONFIG.medium.minZoom;
    }
    return 0.8;
  }

  private keyFor(chunkX: number, chunkY: number, lod: V3LodLevel): string {
    return `${this.worldSeed}:${lod}:${chunkX}:${chunkY}`;
  }
}

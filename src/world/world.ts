import { DebugLayerConfig, WorldConfig } from "../gen/config";
import { hashString } from "../gen/hash";
import { RiverSystem } from "../gen/rivers";
import { SettlementSystem } from "../gen/settlements";
import { TerrainProbe, TerrainSampler, createTerrainSampler } from "../gen/terrain";
import { buildWorldHandshake, serializeWorldHandshake, WorldHandshake } from "../net/handshake";
import { floorDiv } from "../util/math";
import { ChunkRenderer } from "./render/chunk-renderer";
import { ChunkSeamValidator } from "./render/chunk-seam-validator";

type Chunk = {
  x: number;
  y: number;
  canvas: HTMLCanvasElement;
  status: "pending" | "ready";
};

const chunkKey = (x: number, y: number): string => `${x},${y}`;
const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class World {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly chunkRenderer: ChunkRenderer;
  private readonly seamValidator: ChunkSeamValidator;
  private readonly placeholderCanvas: HTMLCanvasElement;
  private readonly chunkCache = new Map<string, Chunk>();
  private readonly pendingQueue: string[] = [];
  private readonly pendingSet = new Set<string>();
  private readonly debug: DebugLayerConfig;

  constructor(config: WorldConfig) {
    this.config = config;
    this.terrain = createTerrainSampler(config);
    const rivers = new RiverSystem(config, this.terrain);
    const settlements = new SettlementSystem(config, this.terrain);
    this.debug = { ...config.debug };

    const seedHash = hashString(`${config.seed}:surface`);
    const treeSeed = hashString(`${config.seed}:trees`);
    const fieldSeed = hashString(`${config.seed}:fields`);
    this.chunkRenderer = new ChunkRenderer(config, this.terrain, rivers, settlements, this.debug, seedHash, treeSeed, fieldSeed);
    this.seamValidator = new ChunkSeamValidator(config);
    this.placeholderCanvas = this.createPlaceholderChunkCanvas(config.chunk.pixelSize);
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
    this.pendingSet.clear();
    this.pendingQueue.length = 0;
  }

  sampleAt(worldX: number, worldY: number): TerrainProbe {
    return this.terrain.probe(worldX, worldY);
  }

  getWorldHandshake(): WorldHandshake {
    return buildWorldHandshake(this.config);
  }

  getSerializedWorldHandshake(): string {
    return serializeWorldHandshake(this.getWorldHandshake());
  }

  advanceGenerationBudget(): void {
    const budgetMs = Math.max(0.2, this.config.chunk.generationBudgetMs);
    const maxBuilds = Math.max(1, this.config.chunk.maxChunkBuildsPerFrame | 0);
    const start = nowMs();
    let built = 0;

    while (built < maxBuilds && this.pendingQueue.length > 0) {
      if (nowMs() - start > budgetMs) {
        break;
      }
      const key = this.pendingQueue.shift();
      if (!key) {
        break;
      }
      this.pendingSet.delete(key);
      const chunk = this.chunkCache.get(key);
      if (!chunk || chunk.status === "ready") {
        continue;
      }

      chunk.canvas = this.chunkRenderer.renderChunk(chunk.x, chunk.y);
      chunk.status = "ready";
      built += 1;

      this.seamValidator.validate(chunk.x, chunk.y, this.getReadyChunkCanvas);
    }
  }

  getGenerationStats(): { pendingChunks: number; seamWarnings: number } {
    return {
      pendingChunks: this.pendingSet.size,
      seamWarnings: this.seamValidator.getWarningCount()
    };
  }

  getChunkCanvas(chunkX: number, chunkY: number): HTMLCanvasElement {
    return this.getChunk(chunkX, chunkY, true).canvas;
  }

  prefetchChunksNearPlayer(
    playerX: number,
    playerY: number,
    viewportWidth: number,
    viewportHeight: number,
    moveDirX: number,
    moveDirY: number
  ): void {
    const chunkSize = this.config.chunk.pixelSize;
    const basePadding = 1;
    this.ensureChunkRange(
      floorDiv(playerX - viewportWidth * 0.5, chunkSize) - basePadding,
      floorDiv(playerX + viewportWidth * 0.5, chunkSize) + basePadding,
      floorDiv(playerY - viewportHeight * 0.5, chunkSize) - basePadding,
      floorDiv(playerY + viewportHeight * 0.5, chunkSize) + basePadding,
      false
    );

    const mag = Math.hypot(moveDirX, moveDirY);
    if (mag < 0.12) {
      return;
    }

    const dirX = moveDirX / mag;
    const dirY = moveDirY / mag;
    const lookahead = Math.max(0, this.config.chunk.prefetchLookaheadChunks | 0);
    const lateral = Math.max(0, this.config.chunk.prefetchLateralChunks | 0);
    if (lookahead === 0 && lateral === 0) {
      return;
    }

    const focusX = playerX + dirX * lookahead * chunkSize;
    const focusY = playerY + dirY * lookahead * chunkSize;
    const halfW = viewportWidth * 0.5 + lateral * chunkSize;
    const halfH = viewportHeight * 0.5 + lateral * chunkSize;
    this.ensureChunkRange(
      floorDiv(focusX - halfW, chunkSize),
      floorDiv(focusX + halfW, chunkSize),
      floorDiv(focusY - halfH, chunkSize),
      floorDiv(focusY + halfH, chunkSize),
      false
    );
  }

  private getChunk(chunkX: number, chunkY: number, priority: boolean): Chunk {
    const key = chunkKey(chunkX, chunkY);
    const cached = this.chunkCache.get(key);
    if (cached && priority && cached.status === "pending") {
      this.enqueueChunkGeneration(key, true);
    }
    if (cached) {
      return cached;
    }

    const chunk: Chunk = {
      x: chunkX,
      y: chunkY,
      canvas: this.placeholderCanvas,
      status: "pending"
    };
    this.chunkCache.set(key, chunk);
    this.enqueueChunkGeneration(key, priority);
    this.pruneCache();
    return chunk;
  }

  private enqueueChunkGeneration(key: string, priority: boolean): void {
    if (this.pendingSet.has(key)) {
      if (priority) {
        const index = this.pendingQueue.indexOf(key);
        if (index > 0) {
          this.pendingQueue.splice(index, 1);
          this.pendingQueue.unshift(key);
        }
      }
      return;
    }
    this.pendingSet.add(key);
    if (priority) {
      this.pendingQueue.unshift(key);
    } else {
      this.pendingQueue.push(key);
    }
  }

  private ensureChunkRange(
    minChunkX: number,
    maxChunkX: number,
    minChunkY: number,
    maxChunkY: number,
    priority: boolean
  ): void {
    for (let cy = minChunkY; cy <= maxChunkY; cy += 1) {
      for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
        this.getChunk(cx, cy, priority);
      }
    }
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
      const key = next.value;
      this.chunkCache.delete(key);
      this.pendingSet.delete(key);
    }
  }

  private readonly getReadyChunkCanvas = (chunkX: number, chunkY: number): HTMLCanvasElement | null => {
    const chunk = this.chunkCache.get(chunkKey(chunkX, chunkY));
    if (!chunk || chunk.status !== "ready") {
      return null;
    }
    return chunk.canvas;
  };

  private createPlaceholderChunkCanvas(size: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return canvas;
    }

    ctx.fillStyle = "#8fa486";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(65, 76, 60, 0.36)";
    ctx.lineWidth = 1;
    const spacing = 16;
    for (let i = -size; i < size * 2; i += spacing) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i - size, size);
      ctx.stroke();
    }
    return canvas;
  }
}

import { DebugLayerConfig, WorldConfig } from "../../gen/config";
import { RiverPath, RiverSystem } from "../../gen/rivers";
import { SettlementSystem } from "../../gen/settlements";
import { TerrainSampler } from "../../gen/terrain";
import { SurfaceColorSampler } from "./color-sampler";
import { FeatureOverlayRenderer } from "./feature-overlay-renderer";
import { TerrainSurfaceRenderer } from "./terrain-surface-renderer";

export class ChunkRenderer {
  private readonly config: WorldConfig;
  private readonly rivers: RiverSystem;
  private readonly debug: DebugLayerConfig;
  private readonly terrainSurface: TerrainSurfaceRenderer;
  private readonly overlays: FeatureOverlayRenderer;

  constructor(
    config: WorldConfig,
    terrain: TerrainSampler,
    rivers: RiverSystem,
    settlements: SettlementSystem,
    debug: DebugLayerConfig,
    seedHash: number,
    treeSeed: number,
    fieldSeed: number
  ) {
    this.config = config;
    this.rivers = rivers;
    this.debug = debug;

    const colorSampler = new SurfaceColorSampler(config, terrain, debug, seedHash);
    this.terrainSurface = new TerrainSurfaceRenderer(config, terrain, colorSampler);
    this.overlays = new FeatureOverlayRenderer(config, terrain, settlements, debug, treeSeed, fieldSeed);
  }

  renderChunk(chunkX: number, chunkY: number): HTMLCanvasElement {
    const chunkSize = this.config.chunk.pixelSize;
    const step = Math.max(1, this.config.chunk.sampleStep | 0);
    const startX = chunkX * chunkSize;
    const startY = chunkY * chunkSize;
    const rivers = this.getRiversForChunk(startX, startY, chunkSize);

    const canvas = document.createElement("canvas");
    canvas.width = chunkSize;
    canvas.height = chunkSize;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable.");
    }

    this.terrainSurface.render(ctx, startX, startY, chunkSize, step, rivers);
    this.overlays.draw(ctx, chunkX, chunkY, startX, startY, chunkSize, rivers);
    return canvas;
  }

  private getRiversForChunk(startX: number, startY: number, chunkSize: number): RiverPath[] {
    if (!this.debug.showRivers) {
      return [];
    }
    const margin = 48;
    return this.rivers.getRiversForBounds(
      startX - margin,
      startX + chunkSize + margin,
      startY - margin,
      startY + chunkSize + margin
    );
  }
}

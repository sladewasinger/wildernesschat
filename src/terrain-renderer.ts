import { Container, Renderer } from "pixi.js";
import { TerrainRenderStats } from "./types";
import { V3TerrainSampler } from "./terrain-sampler";
import { V3ChunkManager } from "./world/chunk-manager";

export class V3TerrainRenderer {
  private readonly chunkManager: V3ChunkManager;

  constructor(renderer: Renderer, worldContainer: Container, sampler: V3TerrainSampler, worldSeed: string) {
    this.chunkManager = new V3ChunkManager(renderer, worldContainer, worldSeed, sampler);
  }

  draw(
    width: number,
    height: number,
    viewMinX: number,
    viewMinY: number,
    zoom: number
  ): TerrainRenderStats {
    const viewMaxX = viewMinX + width / zoom;
    const viewMaxY = viewMinY + height / zoom;
    return this.chunkManager.update(viewMinX, viewMinY, viewMaxX, viewMaxY, zoom);
  }

  destroy(): void {
    this.chunkManager.destroy();
  }
}

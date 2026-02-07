import { TerrainSampler } from "../../gen/terrain";
import { SurfaceColorSampler } from "./color-sampler";

const toByte = (value: number): number => {
  return Math.max(0, Math.min(255, Math.round(value)));
};

export class TerrainSurfaceRenderer {
  private readonly terrain: TerrainSampler;
  private readonly colorSampler: SurfaceColorSampler;

  constructor(terrain: TerrainSampler, colorSampler: SurfaceColorSampler) {
    this.terrain = terrain;
    this.colorSampler = colorSampler;
  }

  render(ctx: CanvasRenderingContext2D, startX: number, startY: number, chunkSize: number, step: number): void {
    if (step === 1) {
      this.renderFullResolution(ctx, startX, startY, chunkSize);
      return;
    }
    this.renderBlockSampled(ctx, startX, startY, chunkSize, step);
  }

  private renderFullResolution(ctx: CanvasRenderingContext2D, startX: number, startY: number, chunkSize: number): void {
    const image = ctx.createImageData(chunkSize, chunkSize);
    const data = image.data;
    let cursor = 0;

    for (let y = 0; y < chunkSize; y += 1) {
      for (let x = 0; x < chunkSize; x += 1) {
        const worldX = startX + x;
        const worldY = startY + y;
        const terrain = this.terrain.sample(worldX, worldY);
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
    step: number
  ): void {
    const image = ctx.createImageData(chunkSize, chunkSize);
    const data = image.data;

    for (let y = 0; y < chunkSize; y += step) {
      for (let x = 0; x < chunkSize; x += step) {
        const blockWidth = Math.min(step, chunkSize - x);
        const blockHeight = Math.min(step, chunkSize - y);
        const sampleX = startX + x + step * 0.5;
        const sampleY = startY + y + step * 0.5;
        const terrain = this.terrain.sample(sampleX, sampleY);
        const nearShore = terrain.shore > 0.14;

        if (nearShore) {
          for (let by = 0; by < blockHeight; by += 1) {
            for (let bx = 0; bx < blockWidth; bx += 1) {
              const px = x + bx;
              const py = y + by;
              const worldX = startX + px + 0.5;
              const worldY = startY + py + 0.5;
              const subTerrain = this.terrain.sample(worldX, worldY);
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
}

import { WorldConfig } from "../../gen/config";

type CanvasProvider = (x: number, y: number) => HTMLCanvasElement | null;

export class ChunkSeamValidator {
  private readonly config: WorldConfig;
  private warningCount = 0;

  constructor(config: WorldConfig) {
    this.config = config;
  }

  getWarningCount(): number {
    return this.warningCount;
  }

  validate(chunkX: number, chunkY: number, getCanvas: CanvasProvider): void {
    if (!this.config.chunk.enableSeamValidation) {
      return;
    }

    const current = getCanvas(chunkX, chunkY);
    if (!current) {
      return;
    }

    const left = getCanvas(chunkX - 1, chunkY);
    if (left) {
      this.compareVertical(left, current, chunkX, chunkY);
    }

    const top = getCanvas(chunkX, chunkY - 1);
    if (top) {
      this.compareHorizontal(top, current, chunkX, chunkY);
    }
  }

  private compareVertical(left: HTMLCanvasElement, right: HTMLCanvasElement, chunkX: number, chunkY: number): void {
    const tolerance = this.config.chunk.seamColorTolerance;
    const width = Math.min(left.width, right.width);
    const height = Math.min(left.height, right.height);
    if (width < 1 || height < 1) {
      return;
    }

    const leftCtx = left.getContext("2d");
    const rightCtx = right.getContext("2d");
    if (!leftCtx || !rightCtx) {
      return;
    }

    const leftEdge = leftCtx.getImageData(width - 1, 0, 1, height).data;
    const rightEdge = rightCtx.getImageData(0, 0, 1, height).data;

    let totalDiff = 0;
    for (let i = 0; i < leftEdge.length; i += 4) {
      totalDiff += Math.abs(leftEdge[i] - rightEdge[i]);
      totalDiff += Math.abs(leftEdge[i + 1] - rightEdge[i + 1]);
      totalDiff += Math.abs(leftEdge[i + 2] - rightEdge[i + 2]);
    }

    const avgDiff = totalDiff / Math.max(1, height * 3);
    if (avgDiff <= tolerance) {
      return;
    }

    this.warningCount += 1;
    if (this.warningCount <= 14) {
      console.warn(`Seam mismatch (vertical) at chunk ${chunkX - 1},${chunkY} -> ${chunkX},${chunkY}: avg RGB diff ${avgDiff.toFixed(2)}`);
    }
  }

  private compareHorizontal(top: HTMLCanvasElement, bottom: HTMLCanvasElement, chunkX: number, chunkY: number): void {
    const tolerance = this.config.chunk.seamColorTolerance;
    const width = Math.min(top.width, bottom.width);
    const height = Math.min(top.height, bottom.height);
    if (width < 1 || height < 1) {
      return;
    }

    const topCtx = top.getContext("2d");
    const bottomCtx = bottom.getContext("2d");
    if (!topCtx || !bottomCtx) {
      return;
    }

    const topEdge = topCtx.getImageData(0, height - 1, width, 1).data;
    const bottomEdge = bottomCtx.getImageData(0, 0, width, 1).data;

    let totalDiff = 0;
    for (let i = 0; i < topEdge.length; i += 4) {
      totalDiff += Math.abs(topEdge[i] - bottomEdge[i]);
      totalDiff += Math.abs(topEdge[i + 1] - bottomEdge[i + 1]);
      totalDiff += Math.abs(topEdge[i + 2] - bottomEdge[i + 2]);
    }

    const avgDiff = totalDiff / Math.max(1, width * 3);
    if (avgDiff <= tolerance) {
      return;
    }

    this.warningCount += 1;
    if (this.warningCount <= 14) {
      console.warn(`Seam mismatch (horizontal) at chunk ${chunkX},${chunkY - 1} -> ${chunkX},${chunkY}: avg RGB diff ${avgDiff.toFixed(2)}`);
    }
  }
}

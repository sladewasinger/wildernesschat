import { clamp, lerp } from "../util/math";
import { V3_RENDER_CONFIG, V3_VIEW_CONFIG, V3_WATER_CONFIG } from "./config";
import { TerrainRenderStats, TerrainSample } from "./types";
import { V3TerrainSampler } from "./terrain-sampler";

export class V3TerrainRenderer {
  private readonly sampler: V3TerrainSampler;

  constructor(sampler: V3TerrainSampler) {
    this.sampler = sampler;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    viewMinX: number,
    viewMinY: number,
    zoom: number
  ): TerrainRenderStats {
    const baseStep = V3_VIEW_CONFIG.terrainWorldStep;
    const minScreenPx = V3_VIEW_CONFIG.terrainMinScreenStepPx;
    const stepMultiplier = Math.max(1, Math.ceil((minScreenPx / zoom) / baseStep));
    const worldStep = baseStep * stepMultiplier;
    const viewMaxX = viewMinX + width / zoom;
    const viewMaxY = viewMinY + height / zoom;
    const startWX = Math.floor(viewMinX / worldStep) * worldStep;
    const startWY = Math.floor(viewMinY / worldStep) * worldStep;
    const colCount = Math.floor((viewMaxX + worldStep - startWX) / worldStep) + 1;
    const rowCount = Math.floor((viewMaxY + worldStep - startWY) / worldStep) + 1;
    const samples = this.sampleGrid(startWX, startWY, worldStep, colCount, rowCount);
    const baseStats = this.drawTerrainFill(ctx, samples, startWX, startWY, worldStep, colCount, rowCount, viewMinX, viewMinY, zoom);
    this.drawContourInk(ctx, samples, startWX, startWY, worldStep, colCount, rowCount, viewMinX, viewMinY, zoom);
    this.drawUnifiedWaterOutline(ctx, samples, startWX, startWY, worldStep, colCount, rowCount, viewMinX, viewMinY, zoom);

    return {
      worldStep,
      cellsDrawn: baseStats.cellsDrawn,
      lakeCells: baseStats.lakeCells,
      riverCells: baseStats.riverCells
    };
  }

  private sampleGrid(
    startWX: number,
    startWY: number,
    worldStep: number,
    colCount: number,
    rowCount: number
  ): TerrainSample[] {
    const samples = new Array<TerrainSample>(colCount * rowCount);
    for (let gy = 0; gy < rowCount; gy += 1) {
      const wy = startWY + gy * worldStep;
      for (let gx = 0; gx < colCount; gx += 1) {
        const wx = startWX + gx * worldStep;
        samples[this.sampleIndex(gx, gy, colCount)] = this.sampler.sampleAt(wx, wy);
      }
    }
    return samples;
  }

  private drawTerrainFill(
    ctx: CanvasRenderingContext2D,
    samples: TerrainSample[],
    startWX: number,
    startWY: number,
    worldStep: number,
    colCount: number,
    rowCount: number,
    viewMinX: number,
    viewMinY: number,
    zoom: number
  ): { cellsDrawn: number; lakeCells: number; riverCells: number } {
    let cellsDrawn = 0;
    let lakeCells = 0;
    let riverCells = 0;
    const size = Math.ceil(worldStep * zoom) + 1;
    for (let gy = 0; gy < rowCount; gy += 1) {
      const wy = startWY + gy * worldStep;
      const sy = Math.floor((wy - viewMinY) * zoom);
      for (let gx = 0; gx < colCount; gx += 1) {
        const sample = samples[this.sampleIndex(gx, gy, colCount)];
        if (sample.kind === "lake") {
          lakeCells += 1;
        } else if (sample.kind === "river") {
          riverCells += 1;
        }
        ctx.fillStyle = this.colorForSample(sample);
        const wx = startWX + gx * worldStep;
        const sx = Math.floor((wx - viewMinX) * zoom);
        ctx.fillRect(sx, sy, size, size);
        cellsDrawn += 1;
      }
    }
    return { cellsDrawn, lakeCells, riverCells };
  }

  private drawContourInk(
    ctx: CanvasRenderingContext2D,
    samples: TerrainSample[],
    startWX: number,
    startWY: number,
    worldStep: number,
    colCount: number,
    rowCount: number,
    viewMinX: number,
    viewMinY: number,
    zoom: number
  ): void {
    const minorPath = new Path2D();
    const majorPath = new Path2D();
    for (let levelIndex = 0; levelIndex < V3_RENDER_CONFIG.contourLevels.length; levelIndex += 1) {
      const level = V3_RENDER_CONFIG.contourLevels[levelIndex];
      const targetPath = levelIndex % V3_RENDER_CONFIG.contourMajorEvery === 0 ? majorPath : minorPath;
      for (let gy = 0; gy < rowCount - 1; gy += 1) {
        const wy = startWY + gy * worldStep;
        for (let gx = 0; gx < colCount - 1; gx += 1) {
          const wx = startWX + gx * worldStep;
          const s00 = samples[this.sampleIndex(gx, gy, colCount)];
          const s10 = samples[this.sampleIndex(gx + 1, gy, colCount)];
          const s11 = samples[this.sampleIndex(gx + 1, gy + 1, colCount)];
          const s01 = samples[this.sampleIndex(gx, gy + 1, colCount)];
          const waterCut = Math.max(s00.waterMask, s10.waterMask, s11.waterMask, s01.waterMask);
          if (waterCut >= V3_RENDER_CONFIG.waterOutlineThreshold) {
            continue;
          }

          this.appendIsoSegments(
            targetPath,
            s00.grassTone - level,
            s10.grassTone - level,
            s11.grassTone - level,
            s01.grassTone - level,
            wx,
            wy,
            worldStep,
            viewMinX,
            viewMinY,
            zoom
          );
        }
      }
    }

    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.strokeStyle = V3_RENDER_CONFIG.contourMinorColor;
    ctx.lineWidth = Math.max(0.8, V3_RENDER_CONFIG.contourMinorWidth * zoom);
    ctx.stroke(minorPath);
    ctx.strokeStyle = V3_RENDER_CONFIG.contourMajorColor;
    ctx.lineWidth = Math.max(1.1, V3_RENDER_CONFIG.contourMajorWidth * zoom);
    ctx.stroke(majorPath);
    ctx.restore();
  }

  private drawUnifiedWaterOutline(
    ctx: CanvasRenderingContext2D,
    samples: TerrainSample[],
    startWX: number,
    startWY: number,
    worldStep: number,
    colCount: number,
    rowCount: number,
    viewMinX: number,
    viewMinY: number,
    zoom: number
  ): void {
    const threshold = V3_RENDER_CONFIG.waterOutlineThreshold;
    const outline = new Path2D();
    for (let gy = 0; gy < rowCount; gy += 1) {
      const wy = startWY + gy * worldStep;
      const y0 = (wy - viewMinY) * zoom;
      const y1 = (wy + worldStep - viewMinY) * zoom;
      for (let gx = 0; gx < colCount; gx += 1) {
        const sample = samples[this.sampleIndex(gx, gy, colCount)];
        if (sample.waterMask < threshold) {
          continue;
        }
        const wx = startWX + gx * worldStep;
        const x0 = (wx - viewMinX) * zoom;
        const x1 = (wx + worldStep - viewMinX) * zoom;
        const upWater = gy > 0 && samples[this.sampleIndex(gx, gy - 1, colCount)].waterMask >= threshold;
        const downWater = gy < rowCount - 1 && samples[this.sampleIndex(gx, gy + 1, colCount)].waterMask >= threshold;
        const leftWater = gx > 0 && samples[this.sampleIndex(gx - 1, gy, colCount)].waterMask >= threshold;
        const rightWater = gx < colCount - 1 && samples[this.sampleIndex(gx + 1, gy, colCount)].waterMask >= threshold;

        if (!upWater) {
          outline.moveTo(x0, y0);
          outline.lineTo(x1, y0);
        }
        if (!downWater) {
          outline.moveTo(x0, y1);
          outline.lineTo(x1, y1);
        }
        if (!leftWater) {
          outline.moveTo(x0, y0);
          outline.lineTo(x0, y1);
        }
        if (!rightWater) {
          outline.moveTo(x1, y0);
          outline.lineTo(x1, y1);
        }
      }
    }

    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.strokeStyle = V3_RENDER_CONFIG.waterOutlineOuterColor;
    ctx.lineWidth = Math.max(1.4, V3_RENDER_CONFIG.waterOutlineOuterWidth * zoom);
    ctx.stroke(outline);
    ctx.strokeStyle = V3_RENDER_CONFIG.waterOutlineInnerColor;
    ctx.lineWidth = Math.max(0.8, V3_RENDER_CONFIG.waterOutlineInnerWidth * zoom);
    ctx.stroke(outline);
    ctx.restore();
  }

  private appendIsoSegments(
    path: Path2D,
    v00: number,
    v10: number,
    v11: number,
    v01: number,
    wx: number,
    wy: number,
    worldStep: number,
    viewMinX: number,
    viewMinY: number,
    zoom: number
  ): void {
    const hits: { x: number; y: number }[] = [];
    if ((v00 <= 0 && v10 >= 0) || (v00 >= 0 && v10 <= 0)) {
      const p = this.isoInterpolate(wx, wy, wx + worldStep, wy, v00, v10);
      hits.push(p);
    }
    if ((v10 <= 0 && v11 >= 0) || (v10 >= 0 && v11 <= 0)) {
      const p = this.isoInterpolate(wx + worldStep, wy, wx + worldStep, wy + worldStep, v10, v11);
      hits.push(p);
    }
    if ((v11 <= 0 && v01 >= 0) || (v11 >= 0 && v01 <= 0)) {
      const p = this.isoInterpolate(wx + worldStep, wy + worldStep, wx, wy + worldStep, v11, v01);
      hits.push(p);
    }
    if ((v01 <= 0 && v00 >= 0) || (v01 >= 0 && v00 <= 0)) {
      const p = this.isoInterpolate(wx, wy + worldStep, wx, wy, v01, v00);
      hits.push(p);
    }
    if (hits.length < 2) {
      return;
    }
    const drawSegment = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
      path.moveTo((a.x - viewMinX) * zoom, (a.y - viewMinY) * zoom);
      path.lineTo((b.x - viewMinX) * zoom, (b.y - viewMinY) * zoom);
    };
    if (hits.length === 2 || hits.length === 3) {
      drawSegment(hits[0], hits[1]);
    } else {
      drawSegment(hits[0], hits[1]);
      drawSegment(hits[2], hits[3]);
    }
  }

  private isoInterpolate(ax: number, ay: number, bx: number, by: number, va: number, vb: number): { x: number; y: number } {
    const denom = va - vb;
    const t = Math.abs(denom) <= 1e-6 ? 0.5 : clamp(va / denom, 0, 1);
    return {
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t
    };
  }

  private sampleIndex(gx: number, gy: number, colCount: number): number {
    return gy * colCount + gx;
  }

  private colorForSample(sample: TerrainSample): string {
    const grassTone = clamp(sample.grassTone, 0, 1);
    let landR = lerp(V3_RENDER_CONFIG.grassLow.r, V3_RENDER_CONFIG.grassHigh.r, grassTone);
    let landG = lerp(V3_RENDER_CONFIG.grassLow.g, V3_RENDER_CONFIG.grassHigh.g, grassTone);
    let landB = lerp(V3_RENDER_CONFIG.grassLow.b, V3_RENDER_CONFIG.grassHigh.b, grassTone);

    const waterBlend =
      sample.waterMask <= 0
        ? 0
        : clamp(
            (sample.waterMask - V3_WATER_CONFIG.waterFillThreshold) /
              (1 - V3_WATER_CONFIG.waterFillThreshold),
            0,
            1
          );
    const coastBlend = waterBlend * 0.22;
    landR = lerp(landR, V3_RENDER_CONFIG.coastTint.r, coastBlend);
    landG = lerp(landG, V3_RENDER_CONFIG.coastTint.g, coastBlend);
    landB = lerp(landB, V3_RENDER_CONFIG.coastTint.b, coastBlend);

    const lakeDepth = clamp(sample.lakeMask, 0, 1);
    const riverDepth = clamp(sample.riverMask, 0, 1);
    const lakeR = lerp(V3_RENDER_CONFIG.lakeShallow.r, V3_RENDER_CONFIG.lakeDeep.r, lakeDepth);
    const lakeG = lerp(V3_RENDER_CONFIG.lakeShallow.g, V3_RENDER_CONFIG.lakeDeep.g, lakeDepth);
    const lakeB = lerp(V3_RENDER_CONFIG.lakeShallow.b, V3_RENDER_CONFIG.lakeDeep.b, lakeDepth);
    const riverR = lerp(V3_RENDER_CONFIG.riverShallow.r, V3_RENDER_CONFIG.riverDeep.r, riverDepth);
    const riverG = lerp(V3_RENDER_CONFIG.riverShallow.g, V3_RENDER_CONFIG.riverDeep.g, riverDepth);
    const riverB = lerp(V3_RENDER_CONFIG.riverShallow.b, V3_RENDER_CONFIG.riverDeep.b, riverDepth);

    const lakeShare = sample.lakeMask + sample.riverMask <= 1e-6 ? 0.5 : sample.lakeMask / (sample.lakeMask + sample.riverMask);
    const waterR = lerp(riverR, lakeR, lakeShare);
    const waterG = lerp(riverG, lakeG, lakeShare);
    const waterB = lerp(riverB, lakeB, lakeShare);

    const finalR = Math.round(lerp(landR, waterR, waterBlend));
    const finalG = Math.round(lerp(landG, waterG, waterBlend));
    const finalB = Math.round(lerp(landB, waterB, waterBlend));
    return `rgb(${finalR}, ${finalG}, ${finalB})`;
  }
}

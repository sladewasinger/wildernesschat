import { Container, Graphics, Rectangle, Renderer, SCALE_MODE, Sprite } from "pixi.js";
import { V3_RENDER_CONFIG } from "../config";
import { V3LodLevel } from "../types";
import { ChunkDisplay, ChunkGeometry } from "./types";

export class V3ChunkBaker {
  private readonly renderer: Renderer;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  bake(geometry: ChunkGeometry, lod: V3LodLevel, chunkSize: number, bleed: number, zoomHint = 1): ChunkDisplay {
    const temp = new Container();
    const land = new Graphics();
    const shallow = new Graphics();
    const debug = new Graphics();

    temp.addChild(land, shallow, debug);

    this.drawLandBase(land, chunkSize, bleed);
    this.drawFilledContours(shallow, geometry.shallowFillContours, V3_RENDER_CONFIG.waterShallowColor, bleed);
    this.drawChunkDebug(debug, geometry, chunkSize, bleed);

    const textureSize = chunkSize + bleed * 2;
    const textureResolution = this.renderer.resolution; // Math.max(1, this.renderer.resolution || 1);
    const texture = this.renderer.textureGenerator.generateTexture({
      target: temp,
      frame: new Rectangle(0, 0, textureSize, textureSize),
      antialias: true,
      resolution: textureResolution,
      clearColor: [0, 0, 0, 0]
    });
    texture.source.scaleMode = <SCALE_MODE>"nearest";   // was LINEAR default
    texture.source.wrapMode = "clamp-to-edge";
    const sprite = new Sprite(texture);
    sprite.texture.source.scaleMode = <SCALE_MODE>"nearest";   // was LINEAR default
    
    temp.destroy({ children: true });
    return { sprite, texture, bleed };
  }

  private drawLandBase(graphics: Graphics, chunkSize: number, bleed: number): void {
    const totalSize = chunkSize + bleed * 2;
    graphics.clear();
    graphics
      .rect(0, 0, totalSize, totalSize)
      .fill({
        color: this.rgbToHex(
          V3_RENDER_CONFIG.flatGrassColor.r,
          V3_RENDER_CONFIG.flatGrassColor.g,
          V3_RENDER_CONFIG.flatGrassColor.b
        )
      });
  }

  private drawFilledContours(
    graphics: Graphics,
    contours: ChunkGeometry["shallowFillContours"],
    color: { r: number; g: number; b: number },
    bleed: number
  ): void {
    graphics.clear();
    const fillColor = this.rgbToHex(color.r, color.g, color.b);
    for (const contour of contours) {
      if (!contour.closed || contour.points.length < 4) {
        continue;
      }
      graphics.moveTo(contour.points[0].x + bleed, contour.points[0].y + bleed);
      for (let i = 1; i < contour.points.length; i += 1) {
        graphics.lineTo(contour.points[i].x + bleed, contour.points[i].y + bleed);
      }
      graphics.closePath();
      graphics.fill({ color: fillColor });
    }
  }

  private rgbToHex(r: number, g: number, b: number): number {
    return (r << 16) | (g << 8) | b;
  }

  private drawChunkDebug(graphics: Graphics, geometry: ChunkGeometry, chunkSize: number, bleed: number): void {
    const totalSize = chunkSize + bleed * 2;
    graphics.clear();
    // Inner chunk bounds (where this chunk is authoritative).
    graphics
      .rect(bleed, bleed, chunkSize, chunkSize)
      .stroke({ color: 0xff2d55, width: 1, alignment: 0.5 });
    // Full baked texture bounds, including bleed/overlap.
    graphics
      .rect(0.5, 0.5, totalSize - 1, totalSize - 1)
      .stroke({ color: 0xffcc00, width: 1, alignment: 0.5 });

    const bounds = this.contourBounds(geometry.shallowFillContours);
    if (bounds) {
      graphics
        .rect(bounds.minX + bleed, bounds.minY + bleed, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
        .stroke({ color: 0x00d8ff, width: 1, alignment: 0.5 });
    }
  }

  private contourBounds(contours: ChunkGeometry["shallowFillContours"]):
    { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let seen = false;
    for (const contour of contours) {
      for (const point of contour.points) {
        seen = true;
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }
    if (!seen) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  }
}

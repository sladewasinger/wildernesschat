import { Container, Graphics, Rectangle, Renderer, Sprite } from "pixi.js";
import { clamp } from "../lib/math";
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
    const shoreline = new Graphics();

    temp.addChild(land, shallow, shoreline);

    this.drawLandBase(land, chunkSize, bleed);
    this.drawFilledContours(shallow, geometry.shallowFillContours, V3_RENDER_CONFIG.waterShallowColor, bleed);
    this.drawShoreline(shoreline, geometry.shallowContours, bleed, zoomHint);

    const textureSize = chunkSize + bleed * 2;
    const textureResolution = this.renderer.resolution; // Math.max(1, this.renderer.resolution || 1);
    const texture = this.renderer.textureGenerator.generateTexture({
      target: temp,
      frame: new Rectangle(0, 0, textureSize, textureSize),
      antialias: true,
      resolution: textureResolution,
      clearColor: [0, 0, 0, 0]
    });
    texture.source.wrapMode = "clamp-to-edge";
    const sprite = new Sprite(texture);
    
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

  private drawShoreline(
    graphics: Graphics,
    contours: ChunkGeometry["shallowContours"],
    bleed: number,
    zoomHint: number
  ): void {
    graphics.clear();
    const zoomScale = Math.log2(zoomHint + 1);
    const outerWidth = clamp(V3_RENDER_CONFIG.shorelineOuterWidthPx + zoomScale * 0.9, 2, 5);
    graphics.setStrokeStyle({
      color: V3_RENDER_CONFIG.shorelineOuterColor,
      width: outerWidth,
      cap: "round",
      join: "round",
      alignment: 0.5
    });

    for (const contour of contours) {
      if (contour.points.length < 2) {
        continue;
      }
      graphics.moveTo(contour.points[0].x + bleed, contour.points[0].y + bleed);
      for (let i = 1; i < contour.points.length; i += 1) {
        graphics.lineTo(contour.points[i].x + bleed, contour.points[i].y + bleed);
      }
      if (contour.closed) {
        graphics.closePath();
      }
    }
    graphics.stroke();
  }

  private rgbToHex(r: number, g: number, b: number): number {
    return (r << 16) | (g << 8) | b;
  }
}

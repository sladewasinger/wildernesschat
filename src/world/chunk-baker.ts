import { Container, Graphics, Rectangle, Renderer, SCALE_MODE, Sprite } from "pixi.js";
import { clamp } from "../lib/math";
import { V3_LOD_CONFIG, V3_RENDER_CONFIG } from "../config";
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
    const mid = new Graphics();
    const deep = new Graphics();
    const outer = new Graphics();
    const inset = new Graphics();
    const insetMask = new Graphics();

    temp.addChild(land, shallow, mid, deep, outer, insetMask, inset);
    inset.mask = insetMask;
    insetMask.renderable = false;

    this.drawLandBase(land, chunkSize, bleed);
    this.drawFilledContours(shallow, geometry.shallowFillContours, V3_RENDER_CONFIG.waterShallowColor, bleed);
    this.drawFilledContours(mid, geometry.midFillContours, V3_RENDER_CONFIG.waterMidColor, bleed);
    this.drawFilledContours(deep, geometry.deepFillContours, V3_RENDER_CONFIG.waterDeepColor, bleed);
    this.drawShoreline(outer, inset, geometry.shallowContours, bleed, lod, zoomHint);
    this.drawMask(insetMask, geometry.shallowFillContours, bleed);

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

  private drawMask(graphics: Graphics, contours: ChunkGeometry["shallowFillContours"], bleed: number): void {
    graphics.clear();
    for (const contour of contours) {
      if (!contour.closed || contour.points.length < 4) {
        continue;
      }
      graphics.moveTo(contour.points[0].x + bleed, contour.points[0].y + bleed);
      for (let i = 1; i < contour.points.length; i += 1) {
        graphics.lineTo(contour.points[i].x + bleed, contour.points[i].y + bleed);
      }
      graphics.closePath();
      graphics.fill({ color: 0xffffff });
    }
  }

  private drawShoreline(
    outer: Graphics,
    inset: Graphics,
    contours: ChunkGeometry["shallowContours"],
    bleed: number,
    lod: V3LodLevel,
    zoomHint: number
  ): void {
    outer.clear();
    inset.clear();

    const zoomScale = Math.log2(zoomHint + 1);
    const outerWidth = clamp(V3_RENDER_CONFIG.shorelineOuterWidthPx + zoomScale * 0.9, 2, 5);
    const insetWidth = clamp(V3_RENDER_CONFIG.shorelineInsetWidthPx + zoomScale * 0.45, 2, 4);

    outer.setStrokeStyle({
      color: V3_RENDER_CONFIG.shorelineOuterColor,
      width: outerWidth,
      cap: "round",
      join: "round",
      alignment: 1
    });
    if (this.shouldDrawInset(lod)) {
      inset.setStrokeStyle({
        color: V3_RENDER_CONFIG.shorelineInsetColor,
        width: insetWidth,
        cap: "round",
        join: "round",
        alignment: 0.5
      });
    }

    for (const contour of contours) {
      if (contour.points.length < 2) {
        continue;
      }
      outer.moveTo(contour.points[0].x + bleed, contour.points[0].y + bleed);
      if (this.shouldDrawInset(lod)) {
        inset.moveTo(contour.points[0].x + bleed, contour.points[0].y + bleed);
      }
      for (let i = 1; i < contour.points.length; i += 1) {
        const px = contour.points[i].x + bleed;
        const py = contour.points[i].y + bleed;
        outer.lineTo(px, py);
        if (this.shouldDrawInset(lod)) {
          inset.lineTo(px, py);
        }
      }
      if (contour.closed) {
        outer.closePath();
        if (this.shouldDrawInset(lod)) {
          inset.closePath();
        }
      }
    }

    outer.stroke();
    if (this.shouldDrawInset(lod)) {
      inset.stroke();
    }
  }

  private shouldDrawInset(lod: V3LodLevel): boolean {
    if (lod === "high") {
      return V3_LOD_CONFIG.high.drawInsetShore;
    }
    if (lod === "medium") {
      return V3_LOD_CONFIG.medium.drawInsetShore;
    }
    return V3_LOD_CONFIG.low.drawInsetShore;
  }

  private rgbToHex(r: number, g: number, b: number): number {
    return (r << 16) | (g << 8) | b;
  }
}

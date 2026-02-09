import { lerp } from "../../util/math";
import { Road } from "./types";

export const regionKey = (x: number, y: number): string => `${x},${y}`;

export const pointInRect = (
  x: number,
  y: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean => {
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
};

export const roadIntersectsBounds = (
  road: Road,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean => {
  for (const point of road.points) {
    if (pointInRect(point.x, point.y, minX, maxX, minY, maxY)) {
      return true;
    }
  }
  return false;
};

export const roadMidpoint = (road: Road): { x: number; y: number } => {
  let totalLength = 0;
  for (let i = 1; i < road.points.length; i += 1) {
    const dx = road.points[i].x - road.points[i - 1].x;
    const dy = road.points[i].y - road.points[i - 1].y;
    totalLength += Math.hypot(dx, dy);
  }

  if (totalLength < 1) {
    return road.points[0];
  }

  let remaining = totalLength * 0.5;
  for (let i = 1; i < road.points.length; i += 1) {
    const a = road.points[i - 1];
    const b = road.points[i];
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= segmentLength) {
      const t = remaining / segmentLength;
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t)
      };
    }
    remaining -= segmentLength;
  }

  return road.points[road.points.length - 1];
};


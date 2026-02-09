import { clamp, lerp } from "../../util/math";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { Point, RoadSegment } from "../types";

export type RoadSample = {
  x: number;
  y: number;
  tangentX: number;
  tangentY: number;
};

export type RoadUsageOptions = {
  allowLastPointTouch?: boolean;
};

export type ClosestRoadMatch = {
  roadId: string;
  point: Point;
  distance: number;
  tangentX: number;
  tangentY: number;
};

export const sampleRoad = (points: Point[], t: number): RoadSample => {
  if (points.length < 2) {
    return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, tangentX: 1, tangentY: 0 };
  }

  const length = polylineLength(points);
  if (length <= 1e-6) {
    const p = points[0];
    return { x: p.x, y: p.y, tangentX: 1, tangentY: 0 };
  }

  let remaining = clamp(t, 0, 1) * length;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const seg = Math.hypot(dx, dy);
    if (seg <= 1e-6) {
      continue;
    }
    if (remaining <= seg) {
      const s = remaining / seg;
      return {
        x: lerp(a.x, b.x, s),
        y: lerp(a.y, b.y, s),
        tangentX: dx / seg,
        tangentY: dy / seg
      };
    }
    remaining -= seg;
  }

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const seg = Math.hypot(dx, dy) || 1;
  return {
    x: last.x,
    y: last.y,
    tangentX: dx / seg,
    tangentY: dy / seg
  };
};

export const polylineLength = (points: Point[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
};

export const closestPointOnSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { x: number; y: number; distance: number } => {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-6) {
    const distance = Math.hypot(px - ax, py - ay);
    return { x: ax, y: ay, distance };
  }
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / lenSq, 0, 1);
  const qx = ax + vx * t;
  const qy = ay + vy * t;
  return { x: qx, y: qy, distance: Math.hypot(px - qx, py - qy) };
};

export const distanceToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => closestPointOnSegment(px, py, ax, ay, bx, by).distance;

export const distanceToRoads = (x: number, y: number, roads: RoadSegment[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const d = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
      if (d < best) {
        best = d;
      }
    }
  }
  return best;
};

export const distanceToRoadsExcludingRoad = (x: number, y: number, roads: RoadSegment[], roadId: string): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const road of roads) {
    if (road.id === roadId) {
      continue;
    }
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const d = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
      if (d < best) {
        best = d;
      }
    }
  }
  return best;
};

export const closestPointOnRoad = (road: RoadSegment, x: number, y: number): { point: Point; tangentX: number; tangentY: number } => {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPoint = road.points[0] ?? { x, y };
  let bestTangentX = 1;
  let bestTangentY = 0;

  for (let i = 1; i < road.points.length; i += 1) {
    const a = road.points[i - 1];
    const b = road.points[i];
    const seg = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
    if (seg.distance < bestDistance) {
      bestDistance = seg.distance;
      bestPoint = { x: seg.x, y: seg.y };
      const segLength = Math.hypot(b.x - a.x, b.y - a.y);
      bestTangentX = segLength <= 1e-6 ? 1 : (b.x - a.x) / segLength;
      bestTangentY = segLength <= 1e-6 ? 0 : (b.y - a.y) / segLength;
    }
  }

  return {
    point: bestPoint,
    tangentX: bestTangentX,
    tangentY: bestTangentY
  };
};

export const angularDistance = (a: number, b: number): number => {
  const twoPi = Math.PI * 2;
  let delta = Math.abs(a - b) % twoPi;
  if (delta > Math.PI) {
    delta = twoPi - delta;
  }
  return delta;
};

export const findClosestAlignedRoad = (
  x: number,
  y: number,
  tangentX: number,
  tangentY: number,
  roads: RoadSegment[],
  minDistance: number,
  maxDistance: number,
  maxAngleDeg: number
): ClosestRoadMatch | null => {
  const angleCos = Math.cos((maxAngleDeg * Math.PI) / 180);
  let best: ClosestRoadMatch | null = null;

  for (const road of roads) {
    if (road.className === "drive") {
      continue;
    }
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const seg = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
      if (seg.distance < minDistance || seg.distance > maxDistance) {
        continue;
      }
      const segLength = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLength <= 1e-6) {
        continue;
      }
      const segTangentX = (b.x - a.x) / segLength;
      const segTangentY = (b.y - a.y) / segLength;
      const alignment = Math.abs(tangentX * segTangentX + tangentY * segTangentY);
      if (alignment < angleCos) {
        continue;
      }

      if (!best || seg.distance < best.distance) {
        best = {
          roadId: road.id,
          point: { x: seg.x, y: seg.y },
          distance: seg.distance,
          tangentX: segTangentX,
          tangentY: segTangentY
        };
      }
    }
  }
  return best;
};

export const isRoadUsable = (
  points: Point[],
  existingRoads: RoadSegment[],
  minDistance: number,
  terrain: V2TerrainSampler,
  options?: RoadUsageOptions
): boolean => {
  for (const point of points) {
    if (terrain.slopeAt(point.x, point.y) > 0.11) {
      return false;
    }
  }

  for (let i = 0; i < points.length; i += 1) {
    if (i === 0) {
      continue;
    }
    if (options?.allowLastPointTouch && i === points.length - 1) {
      continue;
    }
    const p = points[i];
    const distance = distanceToRoads(p.x, p.y, existingRoads);
    if (distance < minDistance) {
      return false;
    }
  }

  return true;
};

export const hasParallelRoadConflict = (candidate: RoadSegment, roads: RoadSegment[]): boolean => {
  const branchRoads = V2_SETTLEMENT_CONFIG.roads.branch;
  let alignedNearSamples = 0;
  let distanceSum = 0;
  for (const t of [0.35, 0.5, 0.65, 0.8, 0.92]) {
    const sample = sampleRoad(candidate.points, t);
    const match = findClosestAlignedRoad(
      sample.x,
      sample.y,
      sample.tangentX,
      sample.tangentY,
      roads,
      V2_SETTLEMENT_CONFIG.roads.width * 1.1,
      branchRoads.parallelDistance,
      branchRoads.parallelMaxAngleDeg
    );
    if (match) {
      alignedNearSamples += 1;
      distanceSum += match.distance;
    }
  }
  if (alignedNearSamples < 3) {
    return false;
  }
  return distanceSum / alignedNearSamples < branchRoads.parallelDistance * 0.8;
};

export const hasRoadReuseOpportunity = (candidate: RoadSegment, roads: RoadSegment[]): boolean => {
  const branchRoads = V2_SETTLEMENT_CONFIG.roads.branch;
  const sample = sampleRoad(candidate.points, 0.72);
  return (
    findClosestAlignedRoad(
      sample.x,
      sample.y,
      sample.tangentX,
      sample.tangentY,
      roads,
      branchRoads.reuseSnapMinDistance,
      branchRoads.reuseSnapMaxDistance,
      branchRoads.reuseMaxAngleDeg
    ) !== null
  );
};

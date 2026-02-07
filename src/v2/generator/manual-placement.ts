import { clamp, lerp } from "../../util/math";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, Point, RoadSegment } from "../types";

type SideNode = {
  point: Point;
  tangentX: number;
  tangentY: number;
};

export type RoadAttachment = {
  roadId: string;
  point: Point;
  tangentX: number;
  tangentY: number;
  distance: number;
};

export const createManualHouseAt = (id: string, x: number, y: number, terrain: V2TerrainSampler): House => {
  const facing = closestContourFacingDirectionAt(terrain, x, y, 18);
  return {
    id,
    x,
    y,
    width: 13.8 * V2_SETTLEMENT_CONFIG.housing.houseScale,
    depth: 9.4 * V2_SETTLEMENT_CONFIG.housing.houseScale,
    angle: Math.atan2(facing.y, facing.x),
    tone: 0.58
  };
};

export const findClosestRoadAttachmentForHouse = (
  house: House,
  roads: RoadSegment[],
  maxDistance: number
): RoadAttachment | null => {
  if (roads.length === 0 || maxDistance <= 0) {
    return null;
  }
  const start = frontRoadNode(house);
  let best: RoadAttachment | null = null;
  const maxDistanceSq = maxDistance * maxDistance;

  for (const road of roads) {
    if (road.points.length < 2) {
      continue;
    }
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const segX = b.x - a.x;
      const segY = b.y - a.y;
      const segLenSq = segX * segX + segY * segY;
      if (segLenSq <= 1e-6) {
        continue;
      }

      const t = clamp(((start.point.x - a.x) * segX + (start.point.y - a.y) * segY) / segLenSq, 0, 1);
      const qx = a.x + segX * t;
      const qy = a.y + segY * t;
      const dx = qx - start.point.x;
      const dy = qy - start.point.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistanceSq) {
        continue;
      }

      const segLen = Math.sqrt(segLenSq);
      const baseTanX = segX / segLen;
      const baseTanY = segY / segLen;
      const towardAttachX = qx - start.point.x;
      const towardAttachY = qy - start.point.y;
      const dot = baseTanX * towardAttachX + baseTanY * towardAttachY;
      const tangentX = dot > 0 ? -baseTanX : baseTanX;
      const tangentY = dot > 0 ? -baseTanY : baseTanY;
      const distance = Math.sqrt(distSq);

      if (!best || distance < best.distance) {
        best = {
          roadId: road.id,
          point: { x: qx, y: qy },
          tangentX,
          tangentY,
          distance
        };
      }
    }
  }

  return best;
};

export const createManualRoadBetweenHouses = (
  id: string,
  fromHouse: House,
  toHouse: House,
  terrain: V2TerrainSampler
): RoadSegment | null => {
  const start = frontRoadNode(fromHouse);
  const end = frontRoadNode(toHouse);
  return createManualRoadBetweenNodes(id, start, end, terrain);
};

export const createManualRoadToAttachment = (
  id: string,
  house: House,
  attachment: RoadAttachment,
  terrain: V2TerrainSampler
): RoadSegment | null => {
  const start = frontRoadNode(house);
  const end: SideNode = {
    point: attachment.point,
    tangentX: attachment.tangentX,
    tangentY: attachment.tangentY
  };
  return createManualRoadBetweenNodes(id, start, end, terrain);
};

const createManualRoadBetweenNodes = (id: string, start: SideNode, end: SideNode, terrain: V2TerrainSampler): RoadSegment | null => {
  const span = Math.hypot(end.point.x - start.point.x, end.point.y - start.point.y);
  if (span < 18) {
    return null;
  }

  const leadLen = clamp(span * 0.11, 8, 24);
  const startLead = {
    x: start.point.x + start.tangentX * leadLen,
    y: start.point.y + start.tangentY * leadLen
  };
  const endLead = {
    x: end.point.x + end.tangentX * leadLen,
    y: end.point.y + end.tangentY * leadLen
  };
  const corridor = buildContourSpline(startLead, endLead, terrain);
  if (!corridor) {
    return null;
  }

  return {
    id,
    className: "trunk",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points: dedupeRoadPoints([start.point, startLead, ...corridor, endLead, end.point])
  };
};

const frontRoadNode = (house: House): SideNode => {
  const forwardX = Math.cos(house.angle);
  const forwardY = Math.sin(house.angle);
  const frontOffset = house.width * 0.56 + 9;

  return {
    point: {
      x: house.x + forwardX * frontOffset,
      y: house.y + forwardY * frontOffset
    },
    tangentX: forwardX,
    tangentY: forwardY
  };
};

const buildContourSpline = (start: Point, end: Point, terrain: V2TerrainSampler): Point[] | null => {
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span <= 1e-6) {
    return null;
  }
  if (span < 26) {
    return [start, end];
  }

  const dirX = (end.x - start.x) / span;
  const dirY = (end.y - start.y) / span;
  const normalX = -dirY;
  const normalY = dirX;
  const interiorCount = Math.max(2, Math.min(6, Math.round(span / 92)));
  const lateralMax = clamp(span * 0.24, 16, 128);
  const targetElevation = (terrain.elevationAt(start.x, start.y) + terrain.elevationAt(end.x, end.y)) * 0.5;

  const controls: Point[] = [start];
  let prevPoint = start;
  let prevElevation = terrain.elevationAt(start.x, start.y);
  let previousOffset = 0;

  for (let i = 1; i <= interiorCount; i += 1) {
    const t = i / (interiorCount + 1);
    const baseX = lerp(start.x, end.x, t);
    const baseY = lerp(start.y, end.y, t);

    let best: Point | null = null;
    let bestOffset = 0;
    let bestElevation = prevElevation;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let sample = 0; sample <= 14; sample += 1) {
      const u = sample / 14;
      const offset = (u * 2 - 1) * lateralMax;
      const x = baseX + normalX * offset;
      const y = baseY + normalY * offset;
      const slope = terrain.slopeAt(x, y);
      if (slope > 0.125) {
        continue;
      }

      const elevation = terrain.elevationAt(x, y);
      const segLen = Math.hypot(x - prevPoint.x, y - prevPoint.y);
      if (segLen < 6) {
        continue;
      }
      const segX = (x - prevPoint.x) / segLen;
      const segY = (y - prevPoint.y) / segLen;
      const grade = Math.abs(elevation - prevElevation) / segLen;
      const toEndLen = Math.hypot(end.x - x, end.y - y);
      const toEndX = toEndLen <= 1e-6 ? dirX : (end.x - x) / toEndLen;
      const toEndY = toEndLen <= 1e-6 ? dirY : (end.y - y) / toEndLen;
      const towardEnd = clamp(segX * toEndX + segY * toEndY, -1, 1);
      const contour = contourDirectionAt(terrain, x, y, 52);
      const contourAlong = Math.abs(contour.x * segX + contour.y * segY);
      const smoothOffsetDelta = Math.abs(offset - previousOffset) / Math.max(1, lateralMax);
      const tieBreak = Math.abs(Math.sin(x * 0.0127 + y * 0.0141 + i * 1.71 + sample * 0.29)) * 0.008;

      const cost =
        slope * 9 +
        grade * 1800 +
        Math.abs(elevation - targetElevation) * 4.6 +
        (1 - contourAlong) * 3.4 +
        smoothOffsetDelta * 0.9 +
        Math.abs(offset) / Math.max(1, lateralMax) * 0.4 +
        (1 - towardEnd) * 0.55 +
        tieBreak;
      if (cost < bestCost) {
        bestCost = cost;
        best = { x, y };
        bestOffset = offset;
        bestElevation = elevation;
      }
    }

    if (!best) {
      best = { x: baseX, y: baseY };
      bestOffset = 0;
      bestElevation = terrain.elevationAt(baseX, baseY);
    }

    controls.push(best);
    prevPoint = best;
    prevElevation = bestElevation;
    previousOffset = bestOffset;
  }

  controls.push(end);
  const smooth = chaikinSmooth(controls, 2);
  if (smooth.length < 2) {
    return null;
  }

  const smoothLength = polylineLength(smooth);
  if (smoothLength > span * 2.25) {
    return [start, end];
  }
  return smooth;
};

const closestContourFacingDirectionAt = (terrain: V2TerrainSampler, x: number, y: number, step: number): Point => {
  const gx = terrain.elevationAt(x + step, y) - terrain.elevationAt(x - step, y);
  const gy = terrain.elevationAt(x, y + step) - terrain.elevationAt(x, y - step);
  const len = Math.hypot(gx, gy);
  if (len <= 1e-6) {
    return { x: 1, y: 0 };
  }
  const uphillX = gx / len;
  const uphillY = gy / len;
  const downhillX = -uphillX;
  const downhillY = -uphillY;

  const contourLevels = 22;
  const eScaled = terrain.elevationAt(x, y) * contourLevels;
  const above = Math.ceil(eScaled - 0.5) + 0.5;
  const below = Math.floor(eScaled - 0.5) + 0.5;
  const deltaUp = Math.max(0, above - eScaled);
  const deltaDown = Math.max(0, eScaled - below);
  if (deltaUp + 1e-6 < deltaDown) {
    return { x: uphillX, y: uphillY };
  }
  if (deltaDown + 1e-6 < deltaUp) {
    return { x: downhillX, y: downhillY };
  }

  const tie = Math.sin(x * 0.013 + y * 0.017);
  return tie >= 0 ? { x: downhillX, y: downhillY } : { x: uphillX, y: uphillY };
};

const contourDirectionAt = (terrain: V2TerrainSampler, x: number, y: number, step: number): Point => {
  const gx = terrain.elevationAt(x + step, y) - terrain.elevationAt(x - step, y);
  const gy = terrain.elevationAt(x, y + step) - terrain.elevationAt(x, y - step);
  const contourX = -gy;
  const contourY = gx;
  const len = Math.hypot(contourX, contourY);
  if (len <= 1e-6) {
    return { x: 1, y: 0 };
  }
  return { x: contourX / len, y: contourY / len };
};

const chaikinSmooth = (points: Point[], passes: number): Point[] => {
  let current = points;
  for (let pass = 0; pass < passes; pass += 1) {
    if (current.length < 3) {
      return current;
    }
    const next: Point[] = [current[0]];
    for (let i = 0; i < current.length - 1; i += 1) {
      const a = current[i];
      const b = current[i + 1];
      next.push(
        { x: lerp(a.x, b.x, 0.25), y: lerp(a.y, b.y, 0.25) },
        { x: lerp(a.x, b.x, 0.75), y: lerp(a.y, b.y, 0.75) }
      );
    }
    next.push(current[current.length - 1]);
    current = dedupeRoadPoints(next);
  }
  return current;
};

const polylineLength = (points: Point[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
};

const dedupeRoadPoints = (points: Point[]): Point[] => {
  if (points.length <= 1) {
    return points;
  }
  const deduped: Point[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = deduped[deduped.length - 1];
    const next = points[i];
    if (Math.hypot(next.x - prev.x, next.y - prev.y) <= 1e-4) {
      continue;
    }
    deduped.push(next);
  }
  return deduped;
};

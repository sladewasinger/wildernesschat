import { clamp, lerp } from "../../util/math";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, Point, RoadSegment } from "../types";

type SideNode = {
  point: Point;
  tangentX: number;
  tangentY: number;
  houseFrontPoint?: Point;
};

type RoadBuildOptions = {
  allowShortSpan?: boolean;
};

type DrivewayNodeOptions = {
  preferShort?: boolean;
};

export type RoadAttachment = {
  roadId: string;
  point: Point;
  tangentX: number;
  tangentY: number;
  distance: number;
};

export const createManualHouseAt = (id: string, x: number, y: number, terrain: V2TerrainSampler, roads: RoadSegment[] = []): House => {
  const contourFacing = closestContourFacingDirectionAt(terrain, x, y, 18);
  const roadFacing = closestRoadFacingDirectionAt(x, y, roads, 108);
  const facing = roadFacing ?? contourFacing;
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
  const candidates = findRoadAttachmentCandidatesForHouse(house, roads, maxDistance, 1);
  return candidates[0] ?? null;
};

export const findRoadAttachmentCandidatesForHouse = (
  house: House,
  roads: RoadSegment[],
  maxDistance: number,
  maxCount = 12
): RoadAttachment[] => {
  if (roads.length === 0 || maxDistance <= 0) {
    return [];
  }
  const start = houseFrontPoint(house);
  const candidates: RoadAttachment[] = [];
  const maxDistanceSq = maxDistance * maxDistance;

  for (const road of roads) {
    if (road.points.length < 2) {
      continue;
    }
    const hasDriveStems = road.points.length >= 6;
    for (let i = 1; i < road.points.length; i += 1) {
      if (hasDriveStems && (i <= 2 || i >= road.points.length - 2)) {
        continue;
      }
      const a = road.points[i - 1];
      const b = road.points[i];
      const segX = b.x - a.x;
      const segY = b.y - a.y;
      const segLenSq = segX * segX + segY * segY;
      if (segLenSq <= 1e-6) {
        continue;
      }

      const t = clamp(((start.x - a.x) * segX + (start.y - a.y) * segY) / segLenSq, 0, 1);
      const qx = a.x + segX * t;
      const qy = a.y + segY * t;
      const dx = qx - start.x;
      const dy = qy - start.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistanceSq) {
        continue;
      }

      const segLen = Math.sqrt(segLenSq);
      const baseTanX = segX / segLen;
      const baseTanY = segY / segLen;
      const towardAttachX = qx - start.x;
      const towardAttachY = qy - start.y;
      const dot = baseTanX * towardAttachX + baseTanY * towardAttachY;
      const tangentX = dot > 0 ? -baseTanX : baseTanX;
      const tangentY = dot > 0 ? -baseTanY : baseTanY;
      const distance = Math.sqrt(distSq);
      candidates.push({
        roadId: road.id,
        point: { x: qx, y: qy },
        tangentX,
        tangentY,
        distance
      });
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const chosen: RoadAttachment[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= maxCount) {
      break;
    }
    const tooClose = chosen.some((existing) => Math.hypot(existing.point.x - candidate.point.x, existing.point.y - candidate.point.y) < 2.5);
    if (tooClose) {
      continue;
    }
    chosen.push(candidate);
  }
  return chosen;
};

export const createManualRoadBetweenHouses = (
  id: string,
  fromHouse: House,
  toHouse: House,
  terrain: V2TerrainSampler
): RoadSegment | null => {
  const startBase = drivewayEndNode(fromHouse, houseFrontPoint(toHouse), { preferShort: true });
  const endBase = drivewayEndNode(toHouse, houseFrontPoint(fromHouse), { preferShort: true });
  const spanDir = normalizeDirection(endBase.point.x - startBase.point.x, endBase.point.y - startBase.point.y);
  if (!spanDir) {
    return createManualRoadBetweenNodes(id, startBase, endBase, terrain);
  }
  const startTangent = blendDirections(startBase.tangentX, startBase.tangentY, spanDir.x, spanDir.y, 0.38);
  const endTangent = blendDirections(endBase.tangentX, endBase.tangentY, -spanDir.x, -spanDir.y, 0.38);
  const start: SideNode = {
    ...startBase,
    tangentX: startTangent.x,
    tangentY: startTangent.y
  };
  const end: SideNode = {
    ...endBase,
    tangentX: endTangent.x,
    tangentY: endTangent.y
  };
  return createManualRoadBetweenNodes(id, start, end, terrain);
};

export const createManualRoadToAttachment = (
  id: string,
  house: House,
  attachment: RoadAttachment,
  terrain: V2TerrainSampler
): RoadSegment | null => {
  const front = houseFrontPoint(house);
  const directDistance = Math.hypot(attachment.point.x - front.x, attachment.point.y - front.y);
  const directThreshold = Math.max(12, house.depth * 1.25 + V2_SETTLEMENT_CONFIG.roads.width * 1.2);
  if (directDistance <= directThreshold) {
    const points = dedupeRoadPoints([front, attachment.point]);
    if (points.length >= 2) {
      return {
        id,
        className: "trunk",
        width: V2_SETTLEMENT_CONFIG.roads.width,
        points
      };
    }
    return null;
  }

  const start = drivewayEndNode(house, attachment.point);
  const towardAttach = normalizeDirection(attachment.point.x - start.point.x, attachment.point.y - start.point.y);
  const startTangent = towardAttach
    ? blendDirections(start.tangentX, start.tangentY, towardAttach.x, towardAttach.y, 0.68)
    : { x: start.tangentX, y: start.tangentY };
  const end: SideNode = {
    point: attachment.point,
    tangentX: attachment.tangentX,
    tangentY: attachment.tangentY
  };
  return createManualRoadBetweenNodes(
    id,
    {
      ...start,
      tangentX: startTangent.x,
      tangentY: startTangent.y
    },
    end,
    terrain,
    { allowShortSpan: true }
  );
};

export const findBridgeAttachmentForHouse = (
  house: House,
  roads: RoadSegment[],
  primary: RoadAttachment,
  maxDistance: number
): RoadAttachment | null => {
  if (roads.length === 0 || maxDistance <= 0) {
    return null;
  }
  const start = houseFrontPoint(house);
  const primaryDir = normalizeDirection(primary.point.x - start.x, primary.point.y - start.y);
  if (!primaryDir) {
    return null;
  }

  let best: RoadAttachment | null = null;
  const maxDistanceSq = maxDistance * maxDistance;

  for (const road of roads) {
    if (road.points.length < 2) {
      continue;
    }
    const hasDriveStems = road.points.length >= 6;
    for (let i = 1; i < road.points.length; i += 1) {
      if (hasDriveStems && (i <= 2 || i >= road.points.length - 2)) {
        continue;
      }

      const a = road.points[i - 1];
      const b = road.points[i];
      const segX = b.x - a.x;
      const segY = b.y - a.y;
      const segLenSq = segX * segX + segY * segY;
      if (segLenSq <= 1e-6) {
        continue;
      }

      const t = clamp(((start.x - a.x) * segX + (start.y - a.y) * segY) / segLenSq, 0, 1);
      const qx = a.x + segX * t;
      const qy = a.y + segY * t;
      const dx = qx - start.x;
      const dy = qy - start.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistanceSq) {
        continue;
      }
      if (Math.hypot(qx - primary.point.x, qy - primary.point.y) < 9) {
        continue;
      }

      const candidateDir = normalizeDirection(dx, dy);
      if (!candidateDir) {
        continue;
      }
      const opposite = primaryDir.x * candidateDir.x + primaryDir.y * candidateDir.y;
      if (opposite > -0.18) {
        continue;
      }

      const segLen = Math.sqrt(segLenSq);
      const baseTanX = segX / segLen;
      const baseTanY = segY / segLen;
      const dot = baseTanX * dx + baseTanY * dy;
      const tangentX = dot > 0 ? -baseTanX : baseTanX;
      const tangentY = dot > 0 ? -baseTanY : baseTanY;
      const distance = Math.sqrt(distSq);
      const sameRoadPenalty = road.id === primary.roadId ? 0 : 18;
      const score = distance + (opposite + 1) * 24 + sameRoadPenalty;

      if (!best || score < best.distance) {
        best = {
          roadId: road.id,
          point: { x: qx, y: qy },
          tangentX,
          tangentY,
          distance: score
        };
      }
    }
  }

  if (!best) {
    return null;
  }

  return {
    ...best,
    distance: Math.hypot(best.point.x - start.x, best.point.y - start.y)
  };
};

export const createManualBridgeRoadBetweenAttachments = (
  id: string,
  a: RoadAttachment,
  b: RoadAttachment,
  terrain: V2TerrainSampler
): RoadSegment | null => {
  const ab = normalizeDirection(b.point.x - a.point.x, b.point.y - a.point.y);
  if (!ab) {
    return null;
  }
  const fromTangent = blendDirections(a.tangentX, a.tangentY, ab.x, ab.y, 0.65);
  const toTangent = blendDirections(b.tangentX, b.tangentY, -ab.x, -ab.y, 0.65);

  const fromNode: SideNode = {
    point: a.point,
    tangentX: fromTangent.x,
    tangentY: fromTangent.y
  };
  const toNode: SideNode = {
    point: b.point,
    tangentX: toTangent.x,
    tangentY: toTangent.y
  };

  return createManualRoadBetweenNodes(id, fromNode, toNode, terrain);
};

const createManualRoadBetweenNodes = (
  id: string,
  start: SideNode,
  end: SideNode,
  terrain: V2TerrainSampler,
  options: RoadBuildOptions = {}
): RoadSegment | null => {
  return buildRoadBetweenNodes(id, start, end, terrain, options);
};

const buildRoadBetweenNodes = (
  id: string,
  start: SideNode,
  end: SideNode,
  terrain: V2TerrainSampler,
  options: RoadBuildOptions = {}
): RoadSegment | null => {
  const span = Math.hypot(end.point.x - start.point.x, end.point.y - start.point.y);
  const minSpan = options.allowShortSpan ? 1.6 : 18;
  if (span < minSpan) {
    return null;
  }

  const startAnchor = start.houseFrontPoint ?? start.point;
  const endAnchor = end.houseFrontPoint ?? end.point;
  if (options.allowShortSpan && span < 16) {
    return {
      id,
      className: "trunk",
      width: V2_SETTLEMENT_CONFIG.roads.width,
      points: smoothRoadPath([startAnchor, start.point, end.point, endAnchor])
    };
  }

  if (span < 58) {
    const shortCurve = buildTangentBezierCurve(start, end, span);
    if (shortCurve.length >= 2) {
      return {
        id,
        className: "trunk",
        width: V2_SETTLEMENT_CONFIG.roads.width,
        points: smoothRoadPath([startAnchor, ...shortCurve, endAnchor])
      };
    }
  }

  const leadLen = clamp(span * 0.11, 8, 24);
  const spanDir = normalizeDirection(end.point.x - start.point.x, end.point.y - start.point.y);
  const startToward = spanDir
    ? clamp(start.tangentX * spanDir.x + start.tangentY * spanDir.y, -1, 1)
    : 1;
  const endToward = spanDir
    ? clamp(end.tangentX * -spanDir.x + end.tangentY * -spanDir.y, -1, 1)
    : 1;
  const startTurn = (1 - startToward) * 0.5;
  const endTurn = (1 - endToward) * 0.5;
  const startLeadLen = clamp(leadLen * lerp(0.82, 1.38, startTurn), 6, 34);
  const endLeadLen = clamp(leadLen * lerp(0.82, 1.38, endTurn), 6, 34);
  const startLead = {
    x: start.point.x + start.tangentX * startLeadLen,
    y: start.point.y + start.tangentY * startLeadLen
  };
  const endLead = {
    x: end.point.x + end.tangentX * endLeadLen,
    y: end.point.y + end.tangentY * endLeadLen
  };
  const corridor = buildContourSpline(startLead, endLead, terrain);
  if (!corridor) {
    return null;
  }

  return {
    id,
    className: "trunk",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points: smoothRoadPath([startAnchor, start.point, startLead, ...corridor, endLead, end.point, endAnchor])
  };
};

const buildTangentBezierCurve = (start: SideNode, end: SideNode, span: number): Point[] => {
  const controlLen = clamp(span * 0.44, 5, 24);
  const p0 = start.point;
  const p1 = {
    x: p0.x + start.tangentX * controlLen,
    y: p0.y + start.tangentY * controlLen
  };
  const p3 = end.point;
  const p2 = {
    x: p3.x + end.tangentX * controlLen,
    y: p3.y + end.tangentY * controlLen
  };
  const stepCount = clamp(Math.round(span / 2.6), 7, 18);
  const points: Point[] = [];
  for (let i = 0; i <= stepCount; i += 1) {
    const t = i / stepCount;
    const omt = 1 - t;
    const x = omt * omt * omt * p0.x + 3 * omt * omt * t * p1.x + 3 * omt * t * t * p2.x + t * t * t * p3.x;
    const y = omt * omt * omt * p0.y + 3 * omt * omt * t * p1.y + 3 * omt * t * t * p2.y + t * t * t * p3.y;
    points.push({ x, y });
  }
  return dedupeRoadPoints(points);
};

const closestRoadFacingDirectionAt = (x: number, y: number, roads: RoadSegment[], maxDistance: number): Point | null => {
  if (roads.length === 0 || maxDistance <= 0) {
    return null;
  }

  const maxDistanceSq = maxDistance * maxDistance;
  let bestDirection: Point | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const road of roads) {
    if (road.points.length < 2) {
      continue;
    }
    const hasDriveStems = road.points.length >= 6;
    for (let i = 1; i < road.points.length; i += 1) {
      if (hasDriveStems && (i <= 2 || i >= road.points.length - 2)) {
        continue;
      }
      const a = road.points[i - 1];
      const b = road.points[i];
      const segX = b.x - a.x;
      const segY = b.y - a.y;
      const segLenSq = segX * segX + segY * segY;
      if (segLenSq <= 1e-6) {
        continue;
      }
      const t = clamp(((x - a.x) * segX + (y - a.y) * segY) / segLenSq, 0, 1);
      const qx = a.x + segX * t;
      const qy = a.y + segY * t;
      const dx = qx - x;
      const dy = qy - y;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistanceSq || distSq >= bestDistSq) {
        continue;
      }
      const towardsRoad = normalizeDirection(dx, dy);
      if (!towardsRoad) {
        continue;
      }
      bestDirection = towardsRoad;
      bestDistSq = distSq;
    }
  }

  return bestDirection;
};

const houseFrontPoint = (house: House): Point => {
  const forwardX = Math.cos(house.angle);
  const forwardY = Math.sin(house.angle);
  const frontOffset = house.width * 0.5 - V2_SETTLEMENT_CONFIG.roads.width * 0.24;
  return {
    x: house.x + forwardX * frontOffset,
    y: house.y + forwardY * frontOffset
  };
};

const drivewayEndNode = (house: House, targetPoint?: Point, options: DrivewayNodeOptions = {}): SideNode => {
  const forwardX = Math.cos(house.angle);
  const forwardY = Math.sin(house.angle);
  const defaultDrivewayLength = Math.max(8, house.depth * 0.88 + V2_SETTLEMENT_CONFIG.roads.width * 1.4);
  const minDrivewayLength = Math.max(1.5, V2_SETTLEMENT_CONFIG.roads.width * 0.44);
  const front = houseFrontPoint(house);
  let drivewayLength = defaultDrivewayLength;
  if (targetPoint) {
    const toTargetX = targetPoint.x - front.x;
    const toTargetY = targetPoint.y - front.y;
    const forwardDistance = toTargetX * forwardX + toTargetY * forwardY;
    const desired = forwardDistance - V2_SETTLEMENT_CONFIG.roads.width * 0.38;
    const maxLength = options.preferShort ? Math.max(3.8, defaultDrivewayLength * 0.66) : defaultDrivewayLength;
    drivewayLength = clamp(desired, minDrivewayLength, maxLength);
  }

  return {
    point: {
      x: front.x + forwardX * drivewayLength,
      y: front.y + forwardY * drivewayLength
    },
    tangentX: forwardX,
    tangentY: forwardY,
    houseFrontPoint: front
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

const normalizeDirection = (x: number, y: number): Point | null => {
  const len = Math.hypot(x, y);
  if (len <= 1e-6) {
    return null;
  }
  return { x: x / len, y: y / len };
};

const blendDirections = (ax: number, ay: number, bx: number, by: number, bWeight: number): Point => {
  const aWeight = 1 - bWeight;
  const mixed = normalizeDirection(ax * aWeight + bx * bWeight, ay * aWeight + by * bWeight);
  if (mixed) {
    return mixed;
  }
  return normalizeDirection(ax, ay) ?? { x: 1, y: 0 };
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

const smoothRoadPath = (points: Point[]): Point[] => {
  const deduped = dedupeRoadPoints(points);
  if (deduped.length < 3) {
    return deduped;
  }
  const passes = deduped.length >= 6 ? 2 : 1;
  return dedupeRoadPoints(chaikinSmooth(deduped, passes));
};

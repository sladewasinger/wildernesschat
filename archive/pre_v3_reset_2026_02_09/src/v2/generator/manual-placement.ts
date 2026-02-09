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
  minOutwardLength?: number;
};

type AttachmentRoadOptions = {
  joinMode?: "t" | "merge";
};

export type RoadAttachment = {
  roadId: string;
  point: Point;
  tangentX: number;
  tangentY: number;
  distance: number;
};

export const createManualHouseAt = (id: string, x: number, y: number, terrain: V2TerrainSampler, roads: RoadSegment[] = []): House => {
  const width = 13.8 * V2_SETTLEMENT_CONFIG.housing.houseScale;
  const depth = 9.4 * V2_SETTLEMENT_CONFIG.housing.houseScale;
  const frontAnchor = snapHouseFrontToContour(terrain, x, y);
  const contourFacing = contourNormalFacingTowardMainContour(terrain, frontAnchor);
  const roadFacing = closestRoadFacingDirectionAt(frontAnchor.x, frontAnchor.y, roads, 108);
  const facing = roadFacing ?? contourFacing;
  const frontOffset = width * 0.5 - V2_SETTLEMENT_CONFIG.roads.width * 0.24;
  const centerX = frontAnchor.x - facing.x * frontOffset;
  const centerY = frontAnchor.y - facing.y * frontOffset;
  return {
    id,
    x: centerX,
    y: centerY,
    width,
    depth,
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
  const fromFront = houseFrontPoint(fromHouse);
  const toFront = houseFrontPoint(toHouse);
  const fromRoadEnd = projectPointToNearestContour(terrain, fromFront);
  const toRoadEnd = projectPointToNearestContour(terrain, toFront);
  const span = Math.hypot(toRoadEnd.x - fromRoadEnd.x, toRoadEnd.y - fromRoadEnd.y);
  if (span < 10) {
    return null;
  }

  const corridor = traceContourBestFitPath(fromRoadEnd, toRoadEnd, terrain);
  if (!corridor || corridor.length < 2) {
    return null;
  }
  const corridorStart = corridor[0];
  const corridorEnd = corridor[corridor.length - 1];
  const points = dedupeRoadPoints([fromFront, ...corridor, toFront]);
  if (points.length < 2) {
    return null;
  }
  const cornerBIndex = points.length - 2;
  const renderPoints = filletPolylineCorners(
    points,
    [1, cornerBIndex],
    V2_SETTLEMENT_CONFIG.manualPlacement.seedDrivewayFilletRadius,
    7
  );
  return {
    id,
    className: "trunk",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points,
    renderPoints
    ,
    nodes: [
      { x: corridorStart.x, y: corridorStart.y, type: "elbow" },
      { x: corridorEnd.x, y: corridorEnd.y, type: "elbow" }
    ]
  };
};

export const createManualRoadToAttachment = (
  id: string,
  house: House,
  attachment: RoadAttachment,
  terrain: V2TerrainSampler,
  options: AttachmentRoadOptions = {}
): RoadSegment | null => {
  const joinMode = options.joinMode ?? "t";
  const front = houseFrontPoint(house);
  const forwardX = Math.cos(house.angle);
  const forwardY = Math.sin(house.angle);
  const toAttachX = attachment.point.x - front.x;
  const toAttachY = attachment.point.y - front.y;
  const toAttachLen = Math.hypot(toAttachX, toAttachY);
  const alignment = toAttachLen <= 1e-6 ? 1 : (toAttachX * forwardX + toAttachY * forwardY) / toAttachLen;
  const roadTan = normalizeDirection(attachment.tangentX, attachment.tangentY);
  if (!roadTan) {
    return null;
  }
  const roadNormalA = { x: -roadTan.y, y: roadTan.x };
  const roadNormalB = { x: roadTan.y, y: -roadTan.x };
  const forwardError = Math.acos(clamp(alignment, -1, 1));
  const straightAttachAngle = Math.PI * 0.2; // ~36deg: house already faces the target road
  const attachDir = toAttachLen <= 1e-6 ? null : normalizeDirection(toAttachX, toAttachY);
  const isNearPerpendicularToRoad = !attachDir ? false : Math.abs(attachDir.x * roadTan.x + attachDir.y * roadTan.y) <= 0.2;
  if (joinMode === "t" && toAttachLen > 1e-6 && forwardError <= straightAttachAngle && isNearPerpendicularToRoad) {
    const points = dedupeRoadPoints([front, attachment.point]);
    if (points.length < 2) {
      return null;
    }
    return {
      id,
      className: "trunk",
      width: V2_SETTLEMENT_CONFIG.roads.width,
      points
    };
  }

  const minCurveRadius = V2_SETTLEMENT_CONFIG.manualPlacement.attachmentBendRadius;
  const stub = V2_SETTLEMENT_CONFIG.manualPlacement.drivewayStubLength;
  const attachmentStraightLead = Math.max(stub, Math.min(46, minCurveRadius * 0.42));
  const startPoint: Point = {
    x: front.x + forwardX * attachmentStraightLead,
    y: front.y + forwardY * attachmentStraightLead
  };
  const startTangent: SideNode = {
    point: startPoint,
    tangentX: forwardX,
    tangentY: forwardY,
    houseFrontPoint: front
  };
  const towardStart = normalizeDirection(startPoint.x - attachment.point.x, startPoint.y - attachment.point.y);
  const endJoinTangent =
    joinMode === "merge"
      ? {
          x: roadTan.x,
          y: roadTan.y
        }
      : towardStart && roadNormalA.x * towardStart.x + roadNormalA.y * towardStart.y >= roadNormalB.x * towardStart.x + roadNormalB.y * towardStart.y
        ? roadNormalA
        : roadNormalB;
  const end: SideNode = {
    point: attachment.point,
    tangentX: endJoinTangent.x,
    tangentY: endJoinTangent.y
  };
  const fixedRadiusRoad = createFixedRadiusConnectorRoad(
    id,
    startTangent,
    end,
    minCurveRadius,
    0,
    joinMode === "merge" ? "tangent" : "perpendicular"
  );
  if (!fixedRadiusRoad) {
    return null;
  }
  if (!roadClearsSourceHouse(fixedRadiusRoad, house)) {
    return null;
  }
  return fixedRadiusRoad;
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

export const roadDetourAlphaBetweenAttachments = (
  roads: RoadSegment[],
  a: RoadAttachment,
  b: RoadAttachment
): number | null => {
  if (a.roadId !== b.roadId) {
    return null;
  }
  const road = roads.find((candidate) => candidate.id === a.roadId);
  if (!road || road.points.length < 2) {
    return null;
  }
  const arcA = arcLengthAtRoadPoint(road, a.point);
  const arcB = arcLengthAtRoadPoint(road, b.point);
  if (arcA === null || arcB === null) {
    return null;
  }

  const straight = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
  if (straight <= 1e-6) {
    return null;
  }
  const alongRoad = Math.abs(arcA - arcB);
  return alongRoad / straight;
};

export const roadNetworkDetourAlphaBetweenAttachments = (
  roads: RoadSegment[],
  a: RoadAttachment,
  b: RoadAttachment
): number | null => {
  if (roads.length === 0) {
    return null;
  }
  const straight = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
  if (straight <= 1e-6) {
    return null;
  }

  type Node = { x: number; y: number; edges: Map<number, number> };
  const nodes: Node[] = [];
  const mergeRadius = 2.8;
  const mergeRadiusSq = mergeRadius * mergeRadius;
  const cellSize = mergeRadius * 1.6;
  const cells = new Map<string, number[]>();

  const keyFor = (x: number, y: number): string => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  const addToCell = (idx: number, x: number, y: number): void => {
    const key = keyFor(x, y);
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(idx);
    } else {
      cells.set(key, [idx]);
    }
  };
  const candidateIndices = (x: number, y: number): number[] => {
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    const results: number[] = [];
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = cells.get(`${cx + ox},${cy + oy}`);
        if (!bucket) {
          continue;
        }
        results.push(...bucket);
      }
    }
    return results;
  };

  const getOrCreateNode = (x: number, y: number): number => {
    const candidates = candidateIndices(x, y);
    for (const idx of candidates) {
      const n = nodes[idx];
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy <= mergeRadiusSq) {
        return idx;
      }
    }
    const idx = nodes.length;
    nodes.push({ x, y, edges: new Map<number, number>() });
    addToCell(idx, x, y);
    return idx;
  };

  const addEdge = (i: number, j: number): void => {
    if (i === j) {
      return;
    }
    const w = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
    const prevIJ = nodes[i].edges.get(j);
    if (prevIJ === undefined || w < prevIJ) {
      nodes[i].edges.set(j, w);
    }
    const prevJI = nodes[j].edges.get(i);
    if (prevJI === undefined || w < prevJI) {
      nodes[j].edges.set(i, w);
    }
  };

  const sampleStep = 9.5;
  for (const road of roads) {
    if (road.points.length < 2) {
      continue;
    }
    let prev = getOrCreateNode(road.points[0].x, road.points[0].y);
    for (let i = 1; i < road.points.length; i += 1) {
      const pa = road.points[i - 1];
      const pb = road.points[i];
      const segLen = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (segLen <= 1e-6) {
        continue;
      }
      const steps = Math.max(1, Math.ceil(segLen / sampleStep));
      for (let s = 1; s <= steps; s += 1) {
        const t = s / steps;
        const x = lerp(pa.x, pb.x, t);
        const y = lerp(pa.y, pb.y, t);
        const cur = getOrCreateNode(x, y);
        addEdge(prev, cur);
        prev = cur;
      }
    }
  }
  if (nodes.length < 2) {
    return null;
  }

  const nearestCandidates = (point: Point, maxCount: number, maxDist: number): { node: number; cost: number }[] => {
    const maxDistSq = maxDist * maxDist;
    const found: { node: number; cost: number }[] = [];
    const candidates = candidateIndices(point.x, point.y);
    for (const idx of candidates) {
      const n = nodes[idx];
      const dx = point.x - n.x;
      const dy = point.y - n.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxDistSq) {
        continue;
      }
      found.push({ node: idx, cost: Math.sqrt(d2) });
    }
    found.sort((lhs, rhs) => lhs.cost - rhs.cost);
    return found.slice(0, maxCount);
  };

  const sourceStarts = nearestCandidates(a.point, 4, 18);
  const targetEnds = nearestCandidates(b.point, 4, 18);
  if (sourceStarts.length === 0 || targetEnds.length === 0) {
    return null;
  }

  const dist = new Array<number>(nodes.length).fill(Number.POSITIVE_INFINITY);
  const visited = new Uint8Array(nodes.length);
  for (const start of sourceStarts) {
    dist[start.node] = Math.min(dist[start.node], start.cost);
  }

  for (;;) {
    let u = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < dist.length; i += 1) {
      if (visited[i] === 0 && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u < 0 || !Number.isFinite(best)) {
      break;
    }
    visited[u] = 1;
    for (const [v, w] of nodes[u].edges.entries()) {
      if (visited[v] !== 0) {
        continue;
      }
      const nd = best + w;
      if (nd < dist[v]) {
        dist[v] = nd;
      }
    }
  }

  let bestPath = Number.POSITIVE_INFINITY;
  for (const target of targetEnds) {
    const candidate = dist[target.node] + target.cost;
    if (candidate < bestPath) {
      bestPath = candidate;
    }
  }
  if (!Number.isFinite(bestPath)) {
    return null;
  }
  return bestPath / straight;
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

const createFixedRadiusConnectorRoad = (
  id: string,
  start: SideNode,
  end: SideNode,
  bendRadius: number,
  smoothPasses: number,
  startHandleMode: "tangent" | "perpendicular" = "tangent"
): RoadSegment | null => {
  const p0 = start.point;
  const p3 = end.point;
  const span = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (span <= 1e-6) {
    return null;
  }

  const sTan = normalizeDirection(start.tangentX, start.tangentY);
  const eTan = normalizeDirection(end.tangentX, end.tangentY);
  if (!sTan || !eTan) {
    return null;
  }

  const dot = clamp(sTan.x * eTan.x + sTan.y * eTan.y, -1, 1);
  const theta = Math.acos(dot); // angle between tangents
  if (theta < 1e-3) {
    const linePoints = dedupeRoadPoints([start.houseFrontPoint ?? p0, p0, p3, end.houseFrontPoint ?? p3]);
    return linePoints.length >= 2
      ? { id, className: "trunk", width: V2_SETTLEMENT_CONFIG.roads.width, points: linePoints }
      : null;
  }

  const toEnd = normalizeDirection(p3.x - p0.x, p3.y - p0.y);
  const startNormalA = { x: -sTan.y, y: sTan.x };
  const startNormalB = { x: sTan.y, y: -sTan.x };
  const turnDir =
    startHandleMode === "perpendicular" && toEnd
      ? (() => {
          const dotA = startNormalA.x * toEnd.x + startNormalA.y * toEnd.y;
          const dotB = startNormalB.x * toEnd.x + startNormalB.y * toEnd.y;
          return dotA >= dotB ? startNormalA : startNormalB;
        })()
      : startNormalA;

  const startAnchor = start.houseFrontPoint ?? start.point;
  const endAnchor = end.houseFrontPoint ?? end.point;
  const sampled: Point[] = [];
  const beziers: { p0: Point; p1: Point; p2: Point; p3: Point }[] = [];

  if (startHandleMode === "perpendicular") {
    // Straight driveway is already startAnchor -> p0. Add an explicit quarter-turn fillet from p0 before main road.
    const filletRadius = clamp(Math.min(bendRadius, span * 0.32), 8, 36);
    const arcK = 0.5522847498;
    const filletHandle = filletRadius * arcK;
    const f0 = p0;
    const f3 = {
      x: f0.x + sTan.x * filletRadius + turnDir.x * filletRadius,
      y: f0.y + sTan.y * filletRadius + turnDir.y * filletRadius
    };
    const f1 = {
      x: f0.x + sTan.x * filletHandle,
      y: f0.y + sTan.y * filletHandle
    };
    const f2 = {
      x: f3.x - turnDir.x * filletHandle,
      y: f3.y - turnDir.y * filletHandle
    };
    const filletSpan = Math.hypot(f3.x - f0.x, f3.y - f0.y);
    const filletSamples = clamp(Math.round(filletSpan / 1.15), 6, 18);
    for (let i = 0; i <= filletSamples; i += 1) {
      sampled.push(sampleCubicBezier(f0, f1, f2, f3, i / filletSamples));
    }
    beziers.push({ p0: f0, p1: f1, p2: f2, p3: f3 });

    const m0 = f3;
    const mainSpan = Math.hypot(p3.x - m0.x, p3.y - m0.y);
    if (mainSpan > 1e-4) {
      const mainDot = clamp(turnDir.x * eTan.x + turnDir.y * eTan.y, -1, 1);
      const mainTheta = Math.acos(mainDot);
      const mainIdeal = bendRadius * (4 / 3) * Math.tan(mainTheta / 4);
      const mainHandleLen = clamp(mainIdeal, 6, Math.max(8, mainSpan * 0.48));
      const m1 = {
        x: m0.x + turnDir.x * mainHandleLen,
        y: m0.y + turnDir.y * mainHandleLen
      };
      const m3 = p3;
      const m2 = {
        x: m3.x + eTan.x * mainHandleLen,
        y: m3.y + eTan.y * mainHandleLen
      };
      const mainSamples = clamp(Math.round(mainSpan / 2.1), 10, 52);
      for (let i = 0; i <= mainSamples; i += 1) {
        sampled.push(sampleCubicBezier(m0, m1, m2, m3, i / mainSamples));
      }
      beziers.push({ p0: m0, p1: m1, p2: m2, p3: m3 });
    }
  } else {
    // Circular arc approximation with cubic Bezier: handle = R * 4/3 * tan(theta/4)
    const idealHandle = bendRadius * (4 / 3) * Math.tan(theta / 4);
    const maxHandle = Math.max(8, span * 0.48);
    const handleLen = clamp(idealHandle, 6, maxHandle);
    const p1 = {
      x: p0.x + sTan.x * handleLen,
      y: p0.y + sTan.y * handleLen
    };
    const p2 = {
      x: p3.x + eTan.x * handleLen,
      y: p3.y + eTan.y * handleLen
    };
    const sampleCount = clamp(Math.round(span / 2.1), 14, 54);
    for (let i = 0; i <= sampleCount; i += 1) {
      sampled.push(sampleCubicBezier(p0, p1, p2, p3, i / sampleCount));
    }
    beziers.push({ p0, p1, p2, p3 });
  }

  const basePoints = dedupeRoadPoints([startAnchor, ...sampled, endAnchor]);
  const smoothed = smoothPasses <= 0 ? basePoints : dedupeRoadPoints(chaikinSmooth(basePoints, smoothPasses));
  if (smoothed.length < 2) {
    return null;
  }
  return {
    id,
    className: "trunk",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points: smoothed,
    bezierDebug: beziers
  };
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
      const towardRoad = normalizeDirection(dx, dy);
      if (!towardRoad) {
        continue;
      }
      const segLen = Math.sqrt(segLenSq);
      const tanX = segX / segLen;
      const tanY = segY / segLen;
      const normalA = { x: -tanY, y: tanX };
      const normalB = { x: tanY, y: -tanX };
      const scoreA = normalA.x * towardRoad.x + normalA.y * towardRoad.y;
      const scoreB = normalB.x * towardRoad.x + normalB.y * towardRoad.y;
      bestDirection = scoreA >= scoreB ? normalA : normalB;
      bestDistSq = distSq;
    }
  }

  return bestDirection;
};

const contourNormalFacingTowardMainContour = (terrain: V2TerrainSampler, setbackPoint: Point): Point => {
  const contourPoint = projectPointToNearestContour(terrain, setbackPoint);
  const tangent = contourDirectionAt(terrain, contourPoint.x, contourPoint.y, 16);
  const normalA = { x: -tangent.y, y: tangent.x };
  const normalB = { x: tangent.y, y: -tangent.x };
  const towardContour = normalizeDirection(contourPoint.x - setbackPoint.x, contourPoint.y - setbackPoint.y);
  if (!towardContour) {
    return closestContourFacingDirectionAt(terrain, contourPoint.x, contourPoint.y, 18);
  }
  const scoreA = normalA.x * towardContour.x + normalA.y * towardContour.y;
  const scoreB = normalB.x * towardContour.x + normalB.y * towardContour.y;
  return scoreA >= scoreB ? normalA : normalB;
};

const snapHouseFrontToContour = (terrain: V2TerrainSampler, x: number, y: number): Point => {
  return projectPointToNearestContour(terrain, x, y);
};

const signedContourDistance = (
  terrain: V2TerrainSampler,
  x: number,
  y: number,
  sampleStep: number,
  contourLevels: number
): { distance: number; grad: number; normal: Point } => {
  const gx = terrain.elevationAtRender(x + sampleStep, y) - terrain.elevationAtRender(x - sampleStep, y);
  const gy = terrain.elevationAtRender(x, y + sampleStep) - terrain.elevationAtRender(x, y - sampleStep);
  const gradNorm = Math.hypot(gx, gy);
  if (gradNorm <= 1e-8) {
    return {
      distance: 0,
      grad: 0,
      normal: { x: 1, y: 0 }
    };
  }
  const grad = gradNorm / (2 * sampleStep);
  const eScaled = terrain.elevationAtRender(x, y) * contourLevels;
  const nearestScaled = Math.round(eScaled - 0.5) + 0.5;
  const nearestElev = nearestScaled / contourLevels;
  return {
    distance: (terrain.elevationAtRender(x, y) - nearestElev) / grad,
    grad,
    normal: { x: gx / gradNorm, y: gy / gradNorm }
  };
};

const projectPointToNearestContour = (terrain: V2TerrainSampler, x: number | Point, y?: number): Point => {
  const px = typeof x === "number" ? x : x.x;
  const py = typeof x === "number" ? (y ?? 0) : x.y;
  const contourLevels = V2_SETTLEMENT_CONFIG.manualPlacement.contourLevels;
  const sampleStep = V2_SETTLEMENT_CONFIG.manualPlacement.contourSetbackSampleStep;
  const sample = signedContourDistance(terrain, px, py, sampleStep, contourLevels);
  if (Math.abs(sample.grad) <= 1e-6) {
    return { x: px, y: py };
  }
  return {
    x: px - sample.normal.x * sample.distance,
    y: py - sample.normal.y * sample.distance
  };
};

const traceContourBestFitPath = (start: Point, end: Point, terrain: V2TerrainSampler): Point[] | null => {
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span <= 1e-6) {
    return null;
  }
  const contourLevels = V2_SETTLEMENT_CONFIG.manualPlacement.contourLevels;
  const targetContourElevation = chooseSharedContourElevation(terrain, start, end, contourLevels);
  const snappedStart = projectPointToContourElevation(terrain, start, targetContourElevation);
  const snappedEnd = projectPointToContourElevation(terrain, end, targetContourElevation);
  const stepLen = clamp(span / 20, 4, 10);
  const maxSteps = Math.ceil(span / stepLen) * 10;
  const points: Point[] = [{ x: snappedStart.x, y: snappedStart.y }];
  let cur = { x: snappedStart.x, y: snappedStart.y };

  for (let i = 0; i < maxSteps; i += 1) {
    const toEnd = normalizeDirection(snappedEnd.x - cur.x, snappedEnd.y - cur.y);
    if (!toEnd) {
      break;
    }
    const remaining = Math.hypot(snappedEnd.x - cur.x, snappedEnd.y - cur.y);
    if (remaining <= stepLen * 1.35) {
      points.push({ x: snappedEnd.x, y: snappedEnd.y });
      return dedupeRoadPoints(points);
    }

    let contourDir = contourDirectionAt(terrain, cur.x, cur.y, 16);
    const contourFlip = { x: -contourDir.x, y: -contourDir.y };
    const aheadA = Math.hypot(snappedEnd.x - (cur.x + contourDir.x * stepLen), snappedEnd.y - (cur.y + contourDir.y * stepLen));
    const aheadB = Math.hypot(snappedEnd.x - (cur.x + contourFlip.x * stepLen), snappedEnd.y - (cur.y + contourFlip.y * stepLen));
    if (aheadB < aheadA) {
      contourDir = contourFlip;
    }
    const move = normalizeDirection(contourDir.x * 0.9 + toEnd.x * 0.1, contourDir.y * 0.9 + toEnd.y * 0.1);
    if (!move) {
      break;
    }

    const next = {
      x: cur.x + move.x * stepLen,
      y: cur.y + move.y * stepLen
    };
    const grad = terrainGradientAt(terrain, next.x, next.y, 16);
    if (grad) {
      const elevError = terrain.elevationAtRender(next.x, next.y) - targetContourElevation;
      const correction = clamp(elevError / grad.magnitude, -stepLen * 0.9, stepLen * 0.9);
      next.x -= grad.normal.x * correction;
      next.y -= grad.normal.y * correction;
    }
    const tooCloseToHistory = points.length > 8 && points.slice(0, -6).some((p) => Math.hypot(next.x - p.x, next.y - p.y) < stepLen * 0.7);
    if (tooCloseToHistory) {
      const nudged = normalizeDirection(next.x - cur.x + toEnd.x * stepLen * 0.2, next.y - cur.y + toEnd.y * stepLen * 0.2);
      if (!nudged) {
        break;
      }
      const n2 = {
        x: cur.x + nudged.x * stepLen,
        y: cur.y + nudged.y * stepLen
      };
      const n2Grad = terrainGradientAt(terrain, n2.x, n2.y, 16);
      if (n2Grad) {
        const elevError = terrain.elevationAtRender(n2.x, n2.y) - targetContourElevation;
        const correction = clamp(elevError / n2Grad.magnitude, -stepLen * 0.9, stepLen * 0.9);
        n2.x -= n2Grad.normal.x * correction;
        n2.y -= n2Grad.normal.y * correction;
      }
      points.push(n2);
      cur = n2;
      continue;
    }
    points.push(next);
    cur = next;
  }

  return buildProjectedContourFallback(snappedStart, snappedEnd, targetContourElevation, terrain);
};

const chooseSharedContourElevation = (terrain: V2TerrainSampler, start: Point, end: Point, contourLevels: number): number => {
  const startScaled = terrain.elevationAtRender(start.x, start.y) * contourLevels;
  const endScaled = terrain.elevationAtRender(end.x, end.y) * contourLevels;
  const startBand = Math.round(startScaled - 0.5) + 0.5;
  const endBand = Math.round(endScaled - 0.5) + 0.5;
  if (Math.abs(startBand - endBand) <= 1e-6) {
    return startBand / contourLevels;
  }
  const avgBand = Math.round(((startScaled + endScaled) * 0.5) - 0.5) + 0.5;
  return avgBand / contourLevels;
};

const projectPointToContourElevation = (
  terrain: V2TerrainSampler,
  point: Point,
  targetElevation: number,
  maxIterations = 4
): Point => {
  const sampleStep = V2_SETTLEMENT_CONFIG.manualPlacement.contourSetbackSampleStep;
  let px = point.x;
  let py = point.y;
  for (let i = 0; i < maxIterations; i += 1) {
    const grad = terrainGradientAt(terrain, px, py, sampleStep);
    if (!grad) {
      break;
    }
    const elevError = terrain.elevationAtRender(px, py) - targetElevation;
    const shift = clamp(elevError / grad.magnitude, -18, 18);
    px -= grad.normal.x * shift;
    py -= grad.normal.y * shift;
    if (Math.abs(shift) <= 0.01) {
      break;
    }
  }
  return { x: px, y: py };
};

const buildProjectedContourFallback = (
  start: Point,
  end: Point,
  targetElevation: number,
  terrain: V2TerrainSampler
): Point[] | null => {
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span <= 1e-6) {
    return null;
  }
  const steps = clamp(Math.round(span / 5), 8, 72);
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const base = {
      x: lerp(start.x, end.x, t),
      y: lerp(start.y, end.y, t)
    };
    points.push(projectPointToContourElevation(terrain, base, targetElevation, 3));
  }
  return dedupeRoadPoints(points);
};

const terrainGradientAt = (
  terrain: V2TerrainSampler,
  x: number,
  y: number,
  step: number
): { normal: Point; magnitude: number } | null => {
  const gx = terrain.elevationAtRender(x + step, y) - terrain.elevationAtRender(x - step, y);
  const gy = terrain.elevationAtRender(x, y + step) - terrain.elevationAtRender(x, y - step);
  const gradNorm = Math.hypot(gx, gy);
  if (gradNorm <= 1e-8) {
    return null;
  }
  const magnitude = gradNorm / (2 * step);
  if (magnitude <= 1e-8) {
    return null;
  }
  return {
    normal: { x: gx / gradNorm, y: gy / gradNorm },
    magnitude
  };
};

const filletPolylineCorners = (points: Point[], cornerIndices: number[], radius: number, arcSteps: number): Point[] => {
  let out = points.map((p) => ({ x: p.x, y: p.y }));
  const sorted = [...cornerIndices].sort((a, b) => b - a);
  for (const cornerIndex of sorted) {
    out = filletSingleCorner(out, cornerIndex, radius, arcSteps);
  }
  return dedupeRoadPoints(out);
};

const filletSingleCorner = (points: Point[], cornerIndex: number, radius: number, arcSteps: number): Point[] => {
  if (cornerIndex <= 0 || cornerIndex >= points.length - 1) {
    return points;
  }
  const prev = points[cornerIndex - 1];
  const corner = points[cornerIndex];
  const next = points[cornerIndex + 1];
  const fromPrev = normalizeDirection(corner.x - prev.x, corner.y - prev.y);
  const toNext = normalizeDirection(next.x - corner.x, next.y - corner.y);
  if (!fromPrev || !toNext) {
    return points;
  }
  const u = { x: -fromPrev.x, y: -fromPrev.y };
  const v = { x: toNext.x, y: toNext.y };
  const phi = Math.acos(clamp(u.x * v.x + u.y * v.y, -1, 1));
  if (!Number.isFinite(phi) || phi <= 0.08 || phi >= Math.PI - 0.08) {
    return points;
  }

  const lenIn = Math.hypot(corner.x - prev.x, corner.y - prev.y);
  const lenOut = Math.hypot(next.x - corner.x, next.y - corner.y);
  const tangentDist = Math.min(
    lenIn * 0.42,
    lenOut * 0.42,
    Math.max(1.2, radius / Math.tan(phi * 0.5))
  );
  if (!Number.isFinite(tangentDist) || tangentDist <= 0.8) {
    return points;
  }

  const pStart = {
    x: corner.x + u.x * tangentDist,
    y: corner.y + u.y * tangentDist
  };
  const pEnd = {
    x: corner.x + v.x * tangentDist,
    y: corner.y + v.y * tangentDist
  };

  const bisector = normalizeDirection(u.x + v.x, u.y + v.y);
  if (!bisector) {
    return points;
  }
  const arcRadius = tangentDist * Math.tan(phi * 0.5);
  const centerDist = arcRadius / Math.sin(phi * 0.5);
  const center = {
    x: corner.x + bisector.x * centerDist,
    y: corner.y + bisector.y * centerDist
  };

  let a0 = Math.atan2(pStart.y - center.y, pStart.x - center.x);
  let a1 = Math.atan2(pEnd.y - center.y, pEnd.x - center.x);
  const turn = fromPrev.x * toNext.y - fromPrev.y * toNext.x;
  if (turn > 0) {
    while (a1 <= a0) {
      a1 += Math.PI * 2;
    }
  } else {
    while (a1 >= a0) {
      a1 -= Math.PI * 2;
    }
  }
  const steps = Math.max(2, arcSteps);
  const arc: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = a0 + (a1 - a0) * t;
    arc.push({
      x: center.x + Math.cos(a) * arcRadius,
      y: center.y + Math.sin(a) * arcRadius
    });
  }

  const before = points.slice(0, cornerIndex);
  const after = points.slice(cornerIndex + 1);
  return dedupeRoadPoints([...before, ...arc, ...after]);
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
    const minLength = Math.max(minDrivewayLength, options.minOutwardLength ?? minDrivewayLength);
    drivewayLength = clamp(desired, minLength, maxLength);
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
  const targetElevation = (terrain.elevationAtRender(start.x, start.y) + terrain.elevationAtRender(end.x, end.y)) * 0.5;

  const controls: Point[] = [start];
  let prevPoint = start;
  let prevElevation = terrain.elevationAtRender(start.x, start.y);
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

      const elevation = terrain.elevationAtRender(x, y);
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
      bestElevation = terrain.elevationAtRender(baseX, baseY);
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
  const gx = terrain.elevationAtRender(x + step, y) - terrain.elevationAtRender(x - step, y);
  const gy = terrain.elevationAtRender(x, y + step) - terrain.elevationAtRender(x, y - step);
  const len = Math.hypot(gx, gy);
  if (len <= 1e-6) {
    return { x: 1, y: 0 };
  }
  const uphillX = gx / len;
  const uphillY = gy / len;
  const downhillX = -uphillX;
  const downhillY = -uphillY;

  const contourLevels = V2_SETTLEMENT_CONFIG.manualPlacement.contourLevels;
  const eScaled = terrain.elevationAtRender(x, y) * contourLevels;
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
  const gx = terrain.elevationAtRender(x + step, y) - terrain.elevationAtRender(x - step, y);
  const gy = terrain.elevationAtRender(x, y + step) - terrain.elevationAtRender(x, y - step);
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

const sampleCubicBezier = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const omt = 1 - t;
  return {
    x: omt * omt * omt * p0.x + 3 * omt * omt * t * p1.x + 3 * omt * t * t * p2.x + t * t * t * p3.x,
    y: omt * omt * omt * p0.y + 3 * omt * omt * t * p1.y + 3 * omt * t * t * p2.y + t * t * t * p3.y
  };
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

const arcLengthAtRoadPoint = (road: RoadSegment, point: Point): number | null => {
  let total = 0;
  let bestArc = 0;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let i = 1; i < road.points.length; i += 1) {
    const a = road.points[i - 1];
    const b = road.points[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lenSq = vx * vx + vy * vy;
    if (lenSq <= 1e-8) {
      continue;
    }
    const t = clamp(((point.x - a.x) * vx + (point.y - a.y) * vy) / lenSq, 0, 1);
    const qx = a.x + vx * t;
    const qy = a.y + vy * t;
    const dx = point.x - qx;
    const dy = point.y - qy;
    const distSq = dx * dx + dy * dy;
    const segLen = Math.sqrt(lenSq);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestArc = total + segLen * t;
    }
    total += segLen;
  }
  if (!Number.isFinite(bestDistSq)) {
    return null;
  }
  return bestArc;
};

const roadClearsSourceHouse = (road: RoadSegment, house: House): boolean => {
  if (road.points.length < 3) {
    return true;
  }
  const centerClearance = Math.min(house.width, house.depth) * 0.44;
  for (let i = 2; i < road.points.length; i += 1) {
    const a = road.points[i - 1];
    const b = road.points[i];
    if (distancePointToSegment(house.x, house.y, a.x, a.y, b.x, b.y) < centerClearance) {
      return false;
    }
  }
  return true;
};

const distancePointToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-6) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / lenSq, 0, 1);
  const qx = ax + vx * t;
  const qy = ay + vy * t;
  return Math.hypot(px - qx, py - qy);
};

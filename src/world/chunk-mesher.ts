import { clamp } from "../lib/math";
import { V3_LOD_CONFIG, V3_RENDER_CONFIG } from "../config";
import { V3LodLevel } from "../types";
import { ChunkGeneratedData, ChunkGeometry, ContourPath } from "./types";

type Point = { x: number; y: number };

type Segment = {
  a: Point;
  b: Point;
};

type BoundaryPoint = {
  point: Point;
  s: number;
};

type DomainRect = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  perimeter: number;
};

export class V3ChunkMesher {
  mesh(generatedData: ChunkGeneratedData): ChunkGeometry {
    const smoothingPasses = this.smoothingPassesForLod(generatedData.lod);
    const shallowContours = this.extractContours(generatedData, V3_RENDER_CONFIG.waterOutlineThreshold, smoothingPasses);
    const midContours = this.extractContours(generatedData, V3_RENDER_CONFIG.waterMidThreshold, smoothingPasses);
    const deepContours = this.shouldDrawDeepWater(generatedData.lod)
      ? this.extractContours(generatedData, V3_RENDER_CONFIG.waterDeepThreshold, smoothingPasses)
      : [];

    return {
      shallowContours,
      midContours,
      deepContours,
      shallowFillContours: this.buildFillContours(shallowContours, generatedData, V3_RENDER_CONFIG.waterOutlineThreshold),
      midFillContours: this.buildFillContours(midContours, generatedData, V3_RENDER_CONFIG.waterMidThreshold),
      deepFillContours: this.buildFillContours(deepContours, generatedData, V3_RENDER_CONFIG.waterDeepThreshold)
    };
  }

  private extractContours(
    generatedData: ChunkGeneratedData,
    threshold: number,
    smoothingPasses: number
  ): ContourPath[] {
    const segments: Segment[] = [];
    for (let gy = 0; gy < generatedData.rows - 1; gy += 1) {
      for (let gx = 0; gx < generatedData.cols - 1; gx += 1) {
        const v00 = generatedData.waterMask[this.index(gx, gy, generatedData.cols)];
        const v10 = generatedData.waterMask[this.index(gx + 1, gy, generatedData.cols)];
        const v11 = generatedData.waterMask[this.index(gx + 1, gy + 1, generatedData.cols)];
        const v01 = generatedData.waterMask[this.index(gx, gy + 1, generatedData.cols)];
        const p00 = { x: generatedData.xCoords[gx], y: generatedData.yCoords[gy] };
        const p10 = { x: generatedData.xCoords[gx + 1], y: generatedData.yCoords[gy] };
        const p11 = { x: generatedData.xCoords[gx + 1], y: generatedData.yCoords[gy + 1] };
        const p01 = { x: generatedData.xCoords[gx], y: generatedData.yCoords[gy + 1] };

        const hits: Array<{ edge: "top" | "right" | "bottom" | "left"; point: Point }> = [];
        const top = this.edgeIsoPoint(p00, p10, v00, v10, threshold);
        const right = this.edgeIsoPoint(p10, p11, v10, v11, threshold);
        const bottom = this.edgeIsoPoint(p11, p01, v11, v01, threshold);
        const left = this.edgeIsoPoint(p01, p00, v01, v00, threshold);
        if (top) hits.push({ edge: "top", point: top });
        if (right) hits.push({ edge: "right", point: right });
        if (bottom) hits.push({ edge: "bottom", point: bottom });
        if (left) hits.push({ edge: "left", point: left });

        if (hits.length === 2) {
          segments.push({ a: hits[0].point, b: hits[1].point });
          continue;
        }
        if (hits.length !== 4) {
          continue;
        }

        const center = (v00 + v10 + v11 + v01) * 0.25;
        const get = (edge: "top" | "right" | "bottom" | "left"): Point => {
          const hit = hits.find((entry) => entry.edge === edge);
          if (!hit) {
            throw new Error(`Missing edge ${edge} in marching squares.`);
          }
          return hit.point;
        };

        if (center >= threshold) {
          segments.push({ a: get("top"), b: get("right") });
          segments.push({ a: get("bottom"), b: get("left") });
        } else {
          segments.push({ a: get("top"), b: get("left") });
          segments.push({ a: get("right"), b: get("bottom") });
        }
      }
    }

    const simplifyTolerance = generatedData.sampleStep * 0.42;
    return this.stitchSegments(segments, generatedData.sampleStep).map((contour) => {
      const simplified = this.simplifyContour(contour, simplifyTolerance);
      return this.smoothContour(simplified, smoothingPasses);
    });
  }

  private buildFillContours(
    contours: ContourPath[],
    generatedData: ChunkGeneratedData,
    threshold: number
  ): ContourPath[] {
    const fills: ContourPath[] = [];
    for (const contour of contours) {
      if (contour.points.length < 3) {
        continue;
      }
      if (contour.closed) {
        const points = this.ensureClosed(contour.points);
        if (points.length >= 4) {
          fills.push({ closed: true, points });
        }
        continue;
      }

      const closedPoints = this.closeOpenContourAgainstDomain(contour.points, generatedData, threshold);
      if (closedPoints && closedPoints.length >= 4) {
        fills.push({ closed: true, points: closedPoints });
      }
    }
    return fills;
  }

  private closeOpenContourAgainstDomain(points: Point[], generatedData: ChunkGeneratedData, threshold: number): Point[] | null {
    if (points.length < 2) {
      return null;
    }
    const domain = this.domainRectFor(generatedData);
    const boundarySnapEps = generatedData.sampleStep * 0.55;
    const startBoundary = this.snapToBoundary(points[0], domain, boundarySnapEps);
    const endBoundary = this.snapToBoundary(points[points.length - 1], domain, boundarySnapEps);
    if (!startBoundary || !endBoundary) {
      return null;
    }

    const normalizedOpen = points.slice();
    normalizedOpen[0] = startBoundary.point;
    normalizedOpen[normalizedOpen.length - 1] = endBoundary.point;

    const cwClosure = this.boundaryPathClockwise(endBoundary, startBoundary, domain);
    const ccwClosure = this.boundaryPathCounterClockwise(endBoundary, startBoundary, domain);
    const cwPoly = this.ensureClosed([...normalizedOpen, ...cwClosure.slice(1)]);
    const ccwPoly = this.ensureClosed([...normalizedOpen, ...ccwClosure.slice(1)]);
    if (cwPoly.length < 4 && ccwPoly.length < 4) {
      return null;
    }
    if (cwPoly.length < 4) {
      return ccwPoly;
    }
    if (ccwPoly.length < 4) {
      return cwPoly;
    }

    const preferredBySide = this.pickPolygonByWaterSide(normalizedOpen, cwPoly, ccwPoly, generatedData, threshold);
    if (preferredBySide) {
      return preferredBySide;
    }

    const cwScore = this.polygonWaterScore(cwPoly, generatedData);
    const ccwScore = this.polygonWaterScore(ccwPoly, generatedData);
    if (Math.abs(cwScore - ccwScore) > 1e-6) {
      return cwScore >= ccwScore ? cwPoly : ccwPoly;
    }
    const cwArea = Math.abs(this.polygonArea(cwPoly));
    const ccwArea = Math.abs(this.polygonArea(ccwPoly));
    return cwArea <= ccwArea ? cwPoly : ccwPoly;
  }

  private pickPolygonByWaterSide(
    openPath: Point[],
    optionA: Point[],
    optionB: Point[],
    generatedData: ChunkGeneratedData,
    threshold: number
  ): Point[] | null {
    const side = this.estimateWaterSide(openPath, generatedData, threshold);
    if (!side) {
      return null;
    }

    const aLeft = this.pointInPolygon(side.leftPoint, optionA);
    const aRight = this.pointInPolygon(side.rightPoint, optionA);
    const bLeft = this.pointInPolygon(side.leftPoint, optionB);
    const bRight = this.pointInPolygon(side.rightPoint, optionB);
    const aMatches = side.waterIsLeft ? aLeft && !aRight : aRight && !aLeft;
    const bMatches = side.waterIsLeft ? bLeft && !bRight : bRight && !bLeft;
    if (aMatches !== bMatches) {
      return aMatches ? optionA : optionB;
    }
    return null;
  }

  private estimateWaterSide(
    openPath: Point[],
    generatedData: ChunkGeneratedData,
    threshold: number
  ): { leftPoint: Point; rightPoint: Point; waterIsLeft: boolean } | null {
    if (openPath.length < 2) {
      return null;
    }
    const sampleOffset = generatedData.sampleStep * 0.45;
    const midSegmentIndex = Math.floor((openPath.length - 1) * 0.5);
    for (let step = 0; step < openPath.length - 1; step += 1) {
      const index = (midSegmentIndex + step) % (openPath.length - 1);
      const a = openPath[index];
      const b = openPath[index + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length <= 1e-6) {
        continue;
      }
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const nx = -dy / length;
      const ny = dx / length;
      const leftPoint = { x: mx + nx * sampleOffset, y: my + ny * sampleOffset };
      const rightPoint = { x: mx - nx * sampleOffset, y: my - ny * sampleOffset };
      const left = this.sampleMask(generatedData, leftPoint.x, leftPoint.y);
      const right = this.sampleMask(generatedData, rightPoint.x, rightPoint.y);
      if (Math.abs(left - right) <= 1e-5) {
        continue;
      }
      return { leftPoint, rightPoint, waterIsLeft: left >= right && left >= threshold };
    }
    return null;
  }

  private boundaryPathClockwise(from: BoundaryPoint, to: BoundaryPoint, domain: DomainRect): Point[] {
    const out: Point[] = [{ ...from.point }];
    const corners: Array<{ s: number; point: Point }> = [
      { s: domain.width, point: { x: domain.maxX, y: domain.minY } },
      { s: domain.width + domain.height, point: { x: domain.maxX, y: domain.maxY } },
      { s: domain.width * 2 + domain.height, point: { x: domain.minX, y: domain.maxY } },
      { s: domain.perimeter, point: { x: domain.minX, y: domain.minY } }
    ];

    let cursor = from.s;
    for (let guard = 0; guard < 8; guard += 1) {
      const toDist = this.cwDistance(cursor, to.s, domain.perimeter);
      if (toDist <= 1e-9) {
        break;
      }
      const corner = this.nextCorner(cursor, corners);
      if (!corner) {
        break;
      }
      const cornerDist = this.cwDistance(cursor, corner.s, domain.perimeter);
      if (cornerDist + 1e-9 >= toDist) {
        break;
      }
      this.pushUniquePoint(out, corner.point);
      cursor = corner.s >= domain.perimeter ? 0 : corner.s;
    }
    this.pushUniquePoint(out, to.point);
    return out;
  }

  private boundaryPathCounterClockwise(from: BoundaryPoint, to: BoundaryPoint, domain: DomainRect): Point[] {
    const reverse = this.boundaryPathClockwise(to, from, domain);
    return reverse.reverse();
  }

  private nextCorner(cursorS: number, corners: Array<{ s: number; point: Point }>): { s: number; point: Point } | null {
    for (const corner of corners) {
      if (corner.s > cursorS + 1e-9) {
        return corner;
      }
    }
    return corners[0] ?? null;
  }

  private cwDistance(fromS: number, toS: number, perimeter: number): number {
    return toS >= fromS ? toS - fromS : perimeter - (fromS - toS);
  }

  private domainRectFor(generatedData: ChunkGeneratedData): DomainRect {
    const minX = generatedData.xCoords[0];
    const maxX = generatedData.xCoords[generatedData.xCoords.length - 1];
    const minY = generatedData.yCoords[0];
    const maxY = generatedData.yCoords[generatedData.yCoords.length - 1];
    const width = maxX - minX;
    const height = maxY - minY;
    return {
      minX,
      maxX,
      minY,
      maxY,
      width,
      height,
      perimeter: 2 * (width + height)
    };
  }

  private snapToBoundary(point: Point, domain: DomainRect, eps: number): BoundaryPoint | null {
    const dTop = Math.abs(point.y - domain.minY);
    const dRight = Math.abs(point.x - domain.maxX);
    const dBottom = Math.abs(point.y - domain.maxY);
    const dLeft = Math.abs(point.x - domain.minX);
    const distances = [dTop, dRight, dBottom, dLeft];
    let bestEdge = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let edge = 0; edge < distances.length; edge += 1) {
      if (distances[edge] <= eps && distances[edge] < bestDistance) {
        bestDistance = distances[edge];
        bestEdge = edge;
      }
    }
    if (bestEdge === -1) {
      return null;
    }

    const x = clamp(point.x, domain.minX, domain.maxX);
    const y = clamp(point.y, domain.minY, domain.maxY);
    if (bestEdge === 0) {
      return { point: { x, y: domain.minY }, s: x - domain.minX };
    }
    if (bestEdge === 1) {
      return { point: { x: domain.maxX, y }, s: domain.width + (y - domain.minY) };
    }
    if (bestEdge === 2) {
      return { point: { x, y: domain.maxY }, s: domain.width + domain.height + (domain.maxX - x) };
    }
    return { point: { x: domain.minX, y }, s: domain.width * 2 + domain.height + (domain.maxY - y) };
  }

  private polygonWaterScore(polygon: Point[], generatedData: ChunkGeneratedData): number {
    const center = this.polygonCentroid(polygon);
    const offset = generatedData.sampleStep * 0.5;
    const points = [
      center,
      { x: center.x + offset, y: center.y },
      { x: center.x - offset, y: center.y },
      { x: center.x, y: center.y + offset },
      { x: center.x, y: center.y - offset }
    ];
    let sum = 0;
    for (const point of points) {
      sum += this.sampleMask(generatedData, point.x, point.y);
    }
    return sum / points.length;
  }

  private polygonCentroid(polygon: Point[]): Point {
    const area2 = this.polygonArea(polygon);
    if (Math.abs(area2) <= 1e-9) {
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (const point of polygon) {
        sx += point.x;
        sy += point.y;
        count += 1;
      }
      const inv = count > 0 ? 1 / count : 0;
      return { x: sx * inv, y: sy * inv };
    }
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < polygon.length - 1; i += 1) {
      const a = polygon[i];
      const b = polygon[i + 1];
      const cross = a.x * b.y - b.x * a.y;
      cx += (a.x + b.x) * cross;
      cy += (a.y + b.y) * cross;
    }
    const scale = 1 / (3 * area2);
    return { x: cx * scale, y: cy * scale };
  }

  private polygonArea(polygon: Point[]): number {
    if (polygon.length < 3) {
      return 0;
    }
    let area = 0;
    for (let i = 0; i < polygon.length - 1; i += 1) {
      const a = polygon[i];
      const b = polygon[i + 1];
      area += a.x * b.y - b.x * a.y;
    }
    return area * 0.5;
  }

  private pointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    let j = polygon.length - 1;
    for (let i = 0; i < polygon.length; i += 1) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;
      if (intersects) {
        inside = !inside;
      }
      j = i;
    }
    return inside;
  }

  private sampleMask(generatedData: ChunkGeneratedData, x: number, y: number): number {
    const sampleStep = generatedData.sampleStep;
    const x0 = generatedData.xCoords[0];
    const y0 = generatedData.yCoords[0];
    const fx = clamp((x - x0) / sampleStep, 0, generatedData.cols - 1);
    const fy = clamp((y - y0) / sampleStep, 0, generatedData.rows - 1);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const jx = Math.min(ix + 1, generatedData.cols - 1);
    const jy = Math.min(iy + 1, generatedData.rows - 1);
    const tx = clamp(fx - ix, 0, 1);
    const ty = clamp(fy - iy, 0, 1);

    const v00 = generatedData.waterMask[this.index(ix, iy, generatedData.cols)];
    const v10 = generatedData.waterMask[this.index(jx, iy, generatedData.cols)];
    const v01 = generatedData.waterMask[this.index(ix, jy, generatedData.cols)];
    const v11 = generatedData.waterMask[this.index(jx, jy, generatedData.cols)];
    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
  }

  private ensureClosed(points: Point[]): Point[] {
    const deduped: Point[] = [];
    for (const point of points) {
      this.pushUniquePoint(deduped, point);
    }
    if (deduped.length < 3) {
      return deduped;
    }
    if (this.distanceSq(deduped[0], deduped[deduped.length - 1]) > 1e-9) {
      deduped.push({ ...deduped[0] });
    }
    return deduped;
  }

  private pushUniquePoint(points: Point[], point: Point): void {
    const last = points[points.length - 1];
    if (!last || this.distanceSq(last, point) > 1e-9) {
      points.push({ x: point.x, y: point.y });
    }
  }

  private edgeIsoPoint(a: Point, b: Point, va: number, vb: number, threshold: number): Point | null {
    const aInside = va >= threshold;
    const bInside = vb >= threshold;
    if (aInside === bInside) {
      return null;
    }
    const denom = vb - va;
    const t = Math.abs(denom) <= 1e-9 ? 0.5 : clamp((threshold - va) / denom, 0, 1);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    };
  }

  private stitchSegments(segments: Segment[], sampleStep: number): ContourPath[] {
    const epsilon = Math.max(sampleStep * 1e-3, 1e-5);
    const keyOf = (point: Point): string => `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}`;
    const pointSums = new Map<string, { x: number; y: number; count: number }>();
    const neighbors = new Map<string, Set<string>>();
    const edgeId = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

    const addNeighbor = (from: string, to: string): void => {
      const set = neighbors.get(from);
      if (set) {
        set.add(to);
      } else {
        neighbors.set(from, new Set<string>([to]));
      }
    };
    const addPoint = (key: string, point: Point): void => {
      const sum = pointSums.get(key);
      if (sum) {
        sum.x += point.x;
        sum.y += point.y;
        sum.count += 1;
      } else {
        pointSums.set(key, { x: point.x, y: point.y, count: 1 });
      }
    };

    for (const segment of segments) {
      const aKey = keyOf(segment.a);
      const bKey = keyOf(segment.b);
      if (aKey === bKey) {
        continue;
      }
      addPoint(aKey, segment.a);
      addPoint(bKey, segment.b);
      addNeighbor(aKey, bKey);
      addNeighbor(bKey, aKey);
    }

    const pointByKey = new Map<string, Point>();
    for (const [key, sum] of pointSums.entries()) {
      pointByKey.set(key, { x: sum.x / sum.count, y: sum.y / sum.count });
    }

    const neighborList = new Map<string, string[]>();
    for (const [key, set] of neighbors.entries()) {
      neighborList.set(key, [...set].sort());
    }

    const visited = new Set<string>();
    const startEdges: Array<{ start: string; next: string }> = [];
    const allKeys = [...neighborList.keys()].sort();
    for (const key of allKeys) {
      const list = neighborList.get(key) ?? [];
      if (list.length !== 2) {
        for (const next of list) {
          startEdges.push({ start: key, next });
        }
      }
    }
    for (const key of allKeys) {
      const list = neighborList.get(key) ?? [];
      for (const next of list) {
        startEdges.push({ start: key, next });
      }
    }

    const contours: ContourPath[] = [];
    for (const { start, next } of startEdges) {
      const firstEdge = edgeId(start, next);
      if (visited.has(firstEdge)) {
        continue;
      }
      const keys: string[] = [start, next];
      visited.add(firstEdge);
      let prev = start;
      let current = next;

      while (true) {
        const candidates = (neighborList.get(current) ?? [])
          .filter((candidate) => candidate !== prev)
          .filter((candidate) => !visited.has(edgeId(current, candidate)));
        if (candidates.length === 0) {
          break;
        }
        const chosen = this.chooseNextBySmallestTurn(prev, current, candidates, pointByKey);
        visited.add(edgeId(current, chosen));
        keys.push(chosen);
        prev = current;
        current = chosen;
        if (current === start) {
          break;
        }
      }

      const closed = keys.length > 2 && keys[keys.length - 1] === keys[0];
      const points = keys
        .map((key) => pointByKey.get(key))
        .filter((point): point is Point => Boolean(point));
      if ((closed && points.length >= 4) || (!closed && points.length >= 2)) {
        contours.push({ points, closed });
      }
    }

    return contours;
  }

  private chooseNextBySmallestTurn(prev: string, current: string, candidates: string[], pointByKey: Map<string, Point>): string {
    const prevPoint = pointByKey.get(prev);
    const currentPoint = pointByKey.get(current);
    if (!prevPoint || !currentPoint) {
      return candidates.slice().sort()[0];
    }

    let bestKey = candidates[0];
    let bestAngle = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const candidatePoint = pointByKey.get(candidate);
      if (!candidatePoint) {
        continue;
      }
      const angle = this.turnAngle(prevPoint, currentPoint, candidatePoint);
      if (angle + 1e-9 < bestAngle) {
        bestAngle = angle;
        bestKey = candidate;
        continue;
      }
      if (Math.abs(angle - bestAngle) <= 1e-9 && candidate < bestKey) {
        bestKey = candidate;
      }
    }
    return bestKey;
  }

  private turnAngle(a: Point, b: Point, c: Point): number {
    const inX = b.x - a.x;
    const inY = b.y - a.y;
    const outX = c.x - b.x;
    const outY = c.y - b.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    if (inLen <= 1e-9 || outLen <= 1e-9) {
      return Number.POSITIVE_INFINITY;
    }
    const dot = clamp((inX * outX + inY * outY) / (inLen * outLen), -1, 1);
    return Math.acos(dot);
  }

  private smoothContour(contour: ContourPath, iterations: number): ContourPath {
    if (!contour.closed) {
      return contour;
    }
    let points = contour.points;
    for (let i = 0; i < iterations; i += 1) {
      points = this.chaikinClosed(points);
      if (points.length < 3) {
        break;
      }
    }
    return { points, closed: contour.closed };
  }

  private simplifyContour(contour: ContourPath, tolerance: number): ContourPath {
    if (contour.points.length < 3) {
      return contour;
    }
    if (!contour.closed) {
      return {
        closed: false,
        points: this.simplifyOpenRdp(contour.points, tolerance)
      };
    }

    const ring =
      contour.points.length >= 2 && this.distanceSq(contour.points[0], contour.points[contour.points.length - 1]) <= 1e-6
        ? contour.points.slice(0, -1)
        : contour.points.slice();
    if (ring.length < 3) {
      return contour;
    }

    const simplifiedRing = this.simplifyOpenRdp([...ring, ring[0]], tolerance).slice(0, -1);
    if (simplifiedRing.length < 3) {
      return contour;
    }
    return {
      closed: true,
      points: [...simplifiedRing, { ...simplifiedRing[0] }]
    };
  }

  private simplifyOpenRdp(points: Point[], tolerance: number): Point[] {
    if (points.length <= 2) {
      return points.slice();
    }
    const toleranceSq = tolerance * tolerance;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack: Array<[number, number]> = [[0, points.length - 1]];

    while (stack.length > 0) {
      const [start, end] = stack.pop() as [number, number];
      let maxDistSq = -1;
      let maxIndex = -1;
      for (let i = start + 1; i < end; i += 1) {
        const distSq = this.pointSegmentDistanceSq(points[i], points[start], points[end]);
        if (distSq > maxDistSq) {
          maxDistSq = distSq;
          maxIndex = i;
        }
      }
      if (maxIndex !== -1 && maxDistSq > toleranceSq) {
        keep[maxIndex] = 1;
        stack.push([start, maxIndex], [maxIndex, end]);
      }
    }

    const out: Point[] = [];
    for (let i = 0; i < points.length; i += 1) {
      if (keep[i]) {
        out.push(points[i]);
      }
    }
    return out.length >= 2 ? out : [points[0], points[points.length - 1]];
  }

  private chaikinClosed(points: Point[]): Point[] {
    if (points.length < 3) {
      return points;
    }
    const ring =
      points.length >= 2 && this.distanceSq(points[0], points[points.length - 1]) <= 1e-6
        ? points.slice(0, -1)
        : points.slice();
    const out: Point[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      out.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 }
      );
    }
    out.push({ ...out[0] });
    return out;
  }

  private distanceSq(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  private pointSegmentDistanceSq(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 1e-9) {
      return this.distanceSq(p, a);
    }
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1);
    const sx = a.x + dx * t;
    const sy = a.y + dy * t;
    const ddx = p.x - sx;
    const ddy = p.y - sy;
    return ddx * ddx + ddy * ddy;
  }

  private shouldDrawDeepWater(lod: V3LodLevel): boolean {
    if (lod === "high") {
      return V3_LOD_CONFIG.high.drawDeepWater;
    }
    if (lod === "medium") {
      return V3_LOD_CONFIG.medium.drawDeepWater;
    }
    return V3_LOD_CONFIG.low.drawDeepWater;
  }

  private smoothingPassesForLod(lod: V3LodLevel): number {
    if (lod === "high") {
      return V3_LOD_CONFIG.high.smoothingPasses;
    }
    if (lod === "medium") {
      return V3_LOD_CONFIG.medium.smoothingPasses;
    }
    return V3_LOD_CONFIG.low.smoothingPasses;
  }

  private index(x: number, y: number, cols: number): number {
    return y * cols + x;
  }
}

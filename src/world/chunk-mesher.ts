import { clamp } from "../lib/math";
import { V3_LOD_CONFIG, V3_RENDER_CONFIG } from "../config";
import { V3LodLevel } from "../types";
import { ChunkGeneratedData, ChunkGeometry, ContourPath } from "./types";

type Point = { x: number; y: number };

type Segment = {
  a: Point;
  b: Point;
};

type Rect = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export class V3ChunkMesher {
  mesh(generatedData: ChunkGeneratedData): ChunkGeometry {
    const bleed = generatedData.paddingCells * generatedData.sampleStep;
    const seamPad = generatedData.sampleStep * 0.25; // ~ quarter cell
    const overdrawRect: Rect = {
      minX: -bleed - seamPad,
      maxX: generatedData.chunkSize + bleed + seamPad,
      minY: -bleed - seamPad,
      maxY: generatedData.chunkSize + bleed + seamPad
    };


    // Single-layer water fill pass for seam-debug baseline.
    const shallowFillContours = this.extractWaterFillPolys(generatedData, V3_RENDER_CONFIG.waterOutlineThreshold, overdrawRect);

    return {
      shallowContours: [],
      midContours: [],
      deepContours: [],
      shallowFillContours,
      midFillContours: [],
      deepFillContours: []
    };
  }

  private extractWaterFillPolys(
    generatedData: ChunkGeneratedData,
    iso: number,
    rect: Rect
  ): ContourPath[] {
    const cols = generatedData.cols;
    const rows = generatedData.rows;
    const out: ContourPath[] = [];

    const valueAt = (gx: number, gy: number): number => generatedData.waterMask[this.index(gx, gy, cols)];

    const inside = (v: number) => v >= iso;

    for (let gy = 0; gy < rows - 1; gy += 1) {
      for (let gx = 0; gx < cols - 1; gx += 1) {
        const v00 = valueAt(gx, gy);
        const v10 = valueAt(gx + 1, gy);
        const v11 = valueAt(gx + 1, gy + 1);
        const v01 = valueAt(gx, gy + 1);

        const p00 = { x: generatedData.xCoords[gx], y: generatedData.yCoords[gy] };
        const p10 = { x: generatedData.xCoords[gx + 1], y: generatedData.yCoords[gy] };
        const p11 = { x: generatedData.xCoords[gx + 1], y: generatedData.yCoords[gy + 1] };
        const p01 = { x: generatedData.xCoords[gx], y: generatedData.yCoords[gy + 1] };

        const i00 = inside(v00);
        const i10 = inside(v10);
        const i11 = inside(v11);
        const i01 = inside(v01);

        const mask =
          (i00 ? 1 : 0) |
          (i10 ? 2 : 0) |
          (i11 ? 4 : 0) |
          (i01 ? 8 : 0);

        if (mask === 0) continue;
        if (mask === 15) {
          // full cell inside
          this.pushClippedPoly(out, [p00, p10, p11, p01], rect);
          continue;
        }

        // edge intersection points
        const top = this.edgeIsoPoint(p00, p10, v00, v10, iso);
        const right = this.edgeIsoPoint(p10, p11, v10, v11, iso);
        const bottom = this.edgeIsoPoint(p11, p01, v11, v01, iso);
        const left = this.edgeIsoPoint(p01, p00, v01, v00, iso);

        // Helper: pick point, fallback to corner if null (rare degeneracy)
        const T = top ?? p00;
        const R = right ?? p10;
        const B = bottom ?? p11;
        const L = left ?? p01;

        // Emit one polygon per case. (Ambiguous 5/10 handled by same det you already have.)
        switch (mask) {
          case 1: this.pushClippedPoly(out, [p00, T, L], rect); break;
          case 2: this.pushClippedPoly(out, [p10, R, T], rect); break;
          case 4: this.pushClippedPoly(out, [p11, B, R], rect); break;
          case 8: this.pushClippedPoly(out, [p01, L, B], rect); break;

          case 3: this.pushClippedPoly(out, [p00, p10, R, L], rect); break;
          case 6: this.pushClippedPoly(out, [p10, p11, B, T], rect); break;
          case 12: this.pushClippedPoly(out, [p11, p01, L, R], rect); break;
          case 9: this.pushClippedPoly(out, [p01, p00, T, B], rect); break;

          case 7: this.pushClippedPoly(out, [p00, p10, p11, B, L], rect); break;
          case 11: this.pushClippedPoly(out, [p10, p11, p01, L, T], rect); break;
          case 13: this.pushClippedPoly(out, [p11, p01, p00, T, R], rect); break;
          case 14: this.pushClippedPoly(out, [p01, p00, p10, R, B], rect); break;

          case 5:
          case 10: {
            const det = (v00 - iso) * (v11 - iso) - (v10 - iso) * (v01 - iso);
            const connectA = det > 0; // same rule as your contour code
            if (mask === 5) {
              // corners inside: 00 and 11
              if (connectA) {
                this.pushClippedPoly(out, [p00, T, R, p11, B, L], rect);
              } else {
                this.pushClippedPoly(out, [p00, T, L], rect);
                this.pushClippedPoly(out, [p11, B, R], rect);
              }
            } else {
              // corners inside: 10 and 01
              if (connectA) {
                this.pushClippedPoly(out, [p10, R, B, p01, L, T], rect);
              } else {
                this.pushClippedPoly(out, [p10, R, T], rect);
                this.pushClippedPoly(out, [p01, L, B], rect);
              }
            }
            break;
          }
          default:
            break;
        }
      }
    }

    return out;
  }

  private pushClippedPoly(out: ContourPath[], poly: Point[], rect: Rect): void {
    // close ring for clipper
    const ring = poly.slice();
    // clipper expects open ring; we’ll close after
    const clipped = this.clipPolygonToRect(ring, rect);
    if (clipped.length >= 3) {
      const closed = this.ensureClosed(clipped);
      if (closed.length >= 4) out.push({ closed: true, points: closed });
    }
  }


  private extractWaterContours(
    generatedData: ChunkGeneratedData,
    iso: number,
    smoothingPasses: number
  ): ContourPath[] {
    const cols = generatedData.cols;
    const rows = generatedData.rows;

    const segments: Segment[] = [];
    const valueAt = (gx: number, gy: number): number =>
      generatedData.waterMask[this.index(gx, gy, cols)];

    for (let gy = 0; gy < rows - 1; gy += 1) {
      for (let gx = 0; gx < cols - 1; gx += 1) {

        const v00 = valueAt(gx, gy);
        const v10 = valueAt(gx + 1, gy);
        const v11 = valueAt(gx + 1, gy + 1);
        const v01 = valueAt(gx, gy + 1);

        const p00 = { x: generatedData.xCoords[gx], y: generatedData.yCoords[gy] };
        const p10 = { x: generatedData.xCoords[gx + 1], y: generatedData.yCoords[gy] };
        const p11 = { x: generatedData.xCoords[gx + 1], y: generatedData.yCoords[gy + 1] };
        const p01 = { x: generatedData.xCoords[gx], y: generatedData.yCoords[gy + 1] };

        const inside00 = v00 >= iso;
        const inside10 = v10 >= iso;
        const inside11 = v11 >= iso;
        const inside01 = v01 >= iso;
        const mask =
          (inside00 ? 1 : 0) |
          (inside10 ? 2 : 0) |
          (inside11 ? 4 : 0) |
          (inside01 ? 8 : 0);

        if (mask === 0 || mask === 15) {
          continue;
        }

        const edges: Partial<Record<"top" | "right" | "bottom" | "left", Point>> = {};
        const getEdge = (edge: "top" | "right" | "bottom" | "left"): Point | null => {
          const cached = edges[edge];
          if (cached) {
            return cached;
          }
          let point: Point | null = null;
          if (edge === "top") point = this.edgeIsoPoint(p00, p10, v00, v10, iso);
          else if (edge === "right") point = this.edgeIsoPoint(p10, p11, v10, v11, iso);
          else if (edge === "bottom") point = this.edgeIsoPoint(p11, p01, v11, v01, iso);
          else point = this.edgeIsoPoint(p01, p00, v01, v00, iso);
          if (point) {
            edges[edge] = point;
          }
          return point;
        };
        const addSegment = (a: "top" | "right" | "bottom" | "left", b: "top" | "right" | "bottom" | "left"): void => {
          const pa = getEdge(a);
          const pb = getEdge(b);
          if (!pa || !pb) {
            return;
          }
          segments.push({ a: pa, b: pb });
        };

        switch (mask) {
          case 1:
          case 14:
            addSegment("left", "top");
            break;
          case 2:
          case 13:
            addSegment("top", "right");
            break;
          case 3:
          case 12:
            addSegment("left", "right");
            break;
          case 4:
          case 11:
            addSegment("right", "bottom");
            break;
          case 6:
          case 9:
            addSegment("top", "bottom");
            break;
          case 7:
          case 8:
            addSegment("bottom", "left");
            break;
          case 5:
          case 10: {
            const det = (v00 - iso) * (v11 - iso) - (v10 - iso) * (v01 - iso);
            let connectA = det > 1e-12;
            if (Math.abs(det) <= 1e-12) {
              // Rare degeneracy: make the tie-break deterministic in world space so chunk overlaps agree.
              const worldX0 = generatedData.chunkX * generatedData.chunkSize + p00.x;
              const worldY0 = generatedData.chunkY * generatedData.chunkSize + p00.y;
              const parity =
                (Math.round(worldX0 / generatedData.sampleStep) + Math.round(worldY0 / generatedData.sampleStep)) % 2 === 0;
              connectA = parity;
            }
            if (connectA) {
              addSegment("top", "right");
              addSegment("bottom", "left");
            } else {
              addSegment("top", "left");
              addSegment("right", "bottom");
            }
            break;
          }
          default:
            break;
        }
      }
    }

    const simplifyTolerance = generatedData.sampleStep * 0.42;
    return this.stitchSegments(segments, generatedData.sampleStep)
      .filter((contour) => contour.points.length >= 2)
      .map((contour) => {
        if (contour.closed && contour.points.length >= 4) {
          const simplified = this.simplifyContour(contour, simplifyTolerance);
          return this.smoothContour(simplified, smoothingPasses);
        }
        return this.simplifyOpenContour(contour, simplifyTolerance);
      })
      .filter((contour) => (contour.closed ? contour.points.length >= 4 : contour.points.length >= 2));
  }

  private edgeIsoPoint(a: Point, b: Point, va: number, vb: number, iso: number): Point | null {
    const da = va - iso;
    const db = vb - iso;
    if (Math.abs(da) <= 1e-12 && Math.abs(db) <= 1e-12) {
      return null;
    }
    if (Math.abs(da) <= 1e-12) {
      return { x: a.x, y: a.y };
    }
    if (Math.abs(db) <= 1e-12) {
      return { x: b.x, y: b.y };
    }
    if ((da > 0 && db > 0) || (da < 0 && db < 0)) {
      return null;
    }
    const t = clamp((iso - va) / (vb - va), 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  private simplifyOpenContour(contour: ContourPath, tolerance: number): ContourPath {
    if (contour.closed || contour.points.length < 3) {
      return contour;
    }
    return { closed: false, points: this.simplifyOpenRdp(contour.points, tolerance) };
  }

  private clipClosedContoursToRect(contours: ContourPath[], rect: Rect): ContourPath[] {
    const out: ContourPath[] = [];
    for (const contour of contours) {
      if (!contour.closed || contour.points.length < 4) {
        continue;
      }
      const ring = this.unwrapClosed(contour.points);
      const clipped = this.clipPolygonToRect(ring, rect);
      if (clipped.length < 3) {
        continue;
      }
      const closed = this.ensureClosed(clipped);
      if (closed.length >= 4) {
        out.push({ points: closed, closed: true });
      }
    }
    return out;
  }

  private clipPolygonToRect(points: Point[], rect: Rect): Point[] {
    let clipped = points.slice();
    clipped = this.clipAgainstBoundary(clipped, (p) => p.x >= rect.minX, (a, b) => this.intersectVertical(a, b, rect.minX));
    clipped = this.clipAgainstBoundary(clipped, (p) => p.x <= rect.maxX, (a, b) => this.intersectVertical(a, b, rect.maxX));
    clipped = this.clipAgainstBoundary(clipped, (p) => p.y >= rect.minY, (a, b) => this.intersectHorizontal(a, b, rect.minY));
    clipped = this.clipAgainstBoundary(clipped, (p) => p.y <= rect.maxY, (a, b) => this.intersectHorizontal(a, b, rect.maxY));
    return this.dedupeSequential(clipped);
  }

  private clipAgainstBoundary(points: Point[], inside: (p: Point) => boolean, intersect: (a: Point, b: Point) => Point): Point[] {
    if (points.length === 0) {
      return [];
    }
    const output: Point[] = [];
    let prev = points[points.length - 1];
    let prevInside = inside(prev);

    for (const curr of points) {
      const currInside = inside(curr);
      if (currInside) {
        if (!prevInside) {
          output.push(intersect(prev, curr));
        }
        output.push({ x: curr.x, y: curr.y });
      } else if (prevInside) {
        output.push(intersect(prev, curr));
      }
      prev = curr;
      prevInside = currInside;
    }
    return output;
  }

  private intersectVertical(a: Point, b: Point, x: number): Point {
    const dx = b.x - a.x;
    if (Math.abs(dx) <= 1e-9) {
      return { x, y: a.y };
    }
    const t = clamp((x - a.x) / dx, 0, 1);
    return { x, y: a.y + (b.y - a.y) * t };
  }

  private intersectHorizontal(a: Point, b: Point, y: number): Point {
    const dy = b.y - a.y;
    if (Math.abs(dy) <= 1e-9) {
      return { x: a.x, y };
    }
    const t = clamp((y - a.y) / dy, 0, 1);
    return { x: a.x + (b.x - a.x) * t, y };
  }

  private stitchSegments(segments: Segment[], sampleStep: number): ContourPath[] {
    const epsilon = Math.max(sampleStep / 64, 1e-4);
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
    const starts: Array<{ start: string; next: string }> = [];
    const allKeys = [...neighborList.keys()].sort();
    for (const key of allKeys) {
      const list = neighborList.get(key) ?? [];
      if (list.length !== 2) {
        for (const next of list) {
          starts.push({ start: key, next });
        }
      }
    }
    for (const key of allKeys) {
      const list = neighborList.get(key) ?? [];
      for (const next of list) {
        starts.push({ start: key, next });
      }
    }

    const out: ContourPath[] = [];
    for (const { start, next } of starts) {
      const first = edgeId(start, next);
      if (visited.has(first)) {
        continue;
      }
      visited.add(first);
      const keys: string[] = [start, next];
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

      const points = this.dedupeSequential(
        keys.map((key) => pointByKey.get(key)).filter((point): point is Point => Boolean(point))
      );
      let closed = points.length >= 4 && keys[keys.length - 1] === keys[0];
      if ((closed && points.length >= 4) || (!closed && points.length >= 2)) {
        out.push({ points, closed });
      }
    }

    return out;
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
      if (points.length < 4) {
        break;
      }
    }
    return { points, closed: true };
  }

  private simplifyContour(contour: ContourPath, tolerance: number): ContourPath {
    if (!contour.closed || contour.points.length < 4) {
      return contour;
    }
    const ring = this.unwrapClosed(contour.points);
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
    const ring = this.unwrapClosed(points);
    if (ring.length < 3) {
      return points;
    }

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

  private unwrapClosed(points: Point[]): Point[] {
    if (points.length >= 2 && this.distanceSq(points[0], points[points.length - 1]) <= 1e-9) {
      return points.slice(0, -1);
    }
    return points.slice();
  }

  private ensureClosed(points: Point[]): Point[] {
    const deduped = this.dedupeSequential(points);
    if (deduped.length < 3) {
      return deduped;
    }
    if (this.distanceSq(deduped[0], deduped[deduped.length - 1]) > 1e-9) {
      deduped.push({ ...deduped[0] });
    }
    return deduped;
  }

  private dedupeSequential(points: Point[]): Point[] {
    const out: Point[] = [];
    for (const point of points) {
      const last = out[out.length - 1];
      if (!last || this.distanceSq(last, point) > 1e-9) {
        out.push({ x: point.x, y: point.y });
      }
    }
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

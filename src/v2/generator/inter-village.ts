import { clamp, lerp } from "../../util/math";
import { hashCoords, hashString, hashToUnit } from "../../gen/hash";
import { fbm2D } from "../../gen/noise";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, Point, RoadSegment, VillageSite } from "../types";
import { polylineLength, sampleRoad } from "./geometry";
import { SiteSelectionContext, collectSitesInBounds } from "./site-selection";
import { buildTrunkRoad } from "./trunk";

export type Stage4ContinuityContext = {
  continuitySeed: number;
  fieldSeed: number;
  terrain: V2TerrainSampler;
  roadCache: Map<string, RoadSegment[]>;
  mergedRoadCache: Map<string, RoadSegment[]>;
};

type AddInterVillageConnectorsParams = {
  site: VillageSite;
  trunk: RoadSegment;
  roads: RoadSegment[];
  houses: House[];
  planSeed: number;
  terrain: V2TerrainSampler;
  continuityRoads: RoadSegment[];
};

type StepCandidate = {
  point: Point;
  dirX: number;
  dirY: number;
};

type RawSegment = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ts: number[];
};

type EdgePiece = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

type GraphNode = {
  x: number;
  y: number;
};

type GraphEdge = {
  a: number;
  b: number;
  length: number;
  active: boolean;
};

const SPLIT_EPS = 1e-4;

export const createStage4ContinuityContext = (planSeed: number, terrain: V2TerrainSampler): Stage4ContinuityContext => ({
  continuitySeed: hashString(`${planSeed}:v2:stage4:continuity`),
  fieldSeed: hashString(`${planSeed}:v2:stage4:continuity-field`),
  terrain,
  roadCache: new Map<string, RoadSegment[]>(),
  mergedRoadCache: new Map<string, RoadSegment[]>()
});

export const collectContinuityRoadsNearSite = (
  context: Stage4ContinuityContext,
  siteContext: SiteSelectionContext,
  planSeed: number,
  site: VillageSite,
  radius: number
): RoadSegment[] => collectRawContinuityRoadsInBounds(context, siteContext, planSeed, site.x - radius, site.x + radius, site.y - radius, site.y + radius);

export const collectContinuityRoadsInBounds = (
  context: Stage4ContinuityContext,
  siteContext: SiteSelectionContext,
  planSeed: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): RoadSegment[] => {
  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const q = continuity.mergeCacheQuantize;
  const cacheKey = `${Math.floor(minX / q)}:${Math.floor(maxX / q)}:${Math.floor(minY / q)}:${Math.floor(maxY / q)}`;
  const cached = context.mergedRoadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const raw = collectRawContinuityRoadsInBounds(context, siteContext, planSeed, minX, maxX, minY, maxY);
  const merged = buildUnifiedContinuityRoads(raw);

  context.mergedRoadCache.set(cacheKey, merged);
  if (context.mergedRoadCache.size > 40) {
    const oldest = context.mergedRoadCache.keys().next().value;
    if (oldest) {
      context.mergedRoadCache.delete(oldest);
    }
  }

  return merged;
};

const collectRawContinuityRoadsInBounds = (
  context: Stage4ContinuityContext,
  siteContext: SiteSelectionContext,
  planSeed: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): RoadSegment[] => {
  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const sourcePadding = continuity.sourceSitePadding;
  const drawPadding = continuity.boundsPadding;

  const sourceSites = collectSitesInBounds(
    siteContext,
    minX - sourcePadding,
    maxX + sourcePadding,
    minY - sourcePadding,
    maxY + sourcePadding
  );

  const roads: RoadSegment[] = [];
  const seen = new Set<string>();

  for (const site of sourceSites) {
    const siteRoads = continuityRoadsForSite(context, site, planSeed);
    for (const road of siteRoads) {
      if (seen.has(road.id)) {
        continue;
      }
      if (!roadIntersectsBounds(road, minX - drawPadding, maxX + drawPadding, minY - drawPadding, maxY + drawPadding)) {
        continue;
      }
      seen.add(road.id);
      roads.push(road);
    }
  }

  roads.sort((a, b) => a.id.localeCompare(b.id));
  return roads;
};

export const addInterVillageConnectors = ({ site, roads, continuityRoads }: AddInterVillageConnectorsParams): number => {
  const prefix = `rvc-${site.id}-`;
  let connected = 0;
  for (const road of continuityRoads) {
    if (!road.id.startsWith(prefix)) {
      continue;
    }
    if (polylineLength(road.points) < V2_SETTLEMENT_CONFIG.stage4.continuity.minRoadLength * 0.55) {
      continue;
    }
    if (roads.some((existing) => existing.id === road.id)) {
      continue;
    }
    connected += 1;
  }
  return connected;
};

const continuityRoadsForSite = (
  context: Stage4ContinuityContext,
  site: VillageSite,
  planSeed: number
): RoadSegment[] => {
  const cached = context.roadCache.get(site.id);
  if (cached) {
    return cached;
  }

  const trunk = buildTrunkRoad(site, planSeed);
  const roads: RoadSegment[] = [];

  const sideA = buildContinuityRoadFromTrunkEndpoint(context, site, trunk, planSeed, 0);
  if (sideA) {
    roads.push(sideA);
  }

  const sideB = buildContinuityRoadFromTrunkEndpoint(context, site, trunk, planSeed, 1);
  if (sideB) {
    roads.push(sideB);
  }

  context.roadCache.set(site.id, roads);
  return roads;
};

const buildContinuityRoadFromTrunkEndpoint = (
  context: Stage4ContinuityContext,
  site: VillageSite,
  trunk: RoadSegment,
  planSeed: number,
  side: 0 | 1
): RoadSegment | null => {
  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const sideHash = hashString(`${site.id}:stage4:continuity:${side}:${planSeed}`);
  const sampleT = side === 0 ? continuity.endpointSampleT : 1 - continuity.endpointSampleT;
  const sample = sampleRoad(trunk.points, sampleT);
  const start = side === 0 ? trunk.points[0] : trunk.points[trunk.points.length - 1];

  let dirX = side === 0 ? -sample.tangentX : sample.tangentX;
  let dirY = side === 0 ? -sample.tangentY : sample.tangentY;
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen <= 1e-6) {
    dirX = 1;
    dirY = 0;
  } else {
    dirX /= dirLen;
    dirY /= dirLen;
  }

  const segmentCountRoll = hashToUnit(hashCoords(sideHash, 11, 13, 1601));
  const segmentCount =
    continuity.segmentCountMin +
    Math.floor(segmentCountRoll * (continuity.segmentCountMax - continuity.segmentCountMin + 1));

  const points: Point[] = [start];
  let current = start;

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const preferred = preferredDirection(context, sideHash, current.x, current.y, dirX, dirY, segment);
    const next = pickFeasibleStep(context, sideHash, current, preferred.x, preferred.y, segment);
    if (!next) {
      break;
    }
    points.push(next.point);
    current = next.point;
    dirX = next.dirX;
    dirY = next.dirY;
  }

  if (points.length < 4 || polylineLength(points) < continuity.minRoadLength) {
    return null;
  }

  return {
    id: `rvc-${site.id}-${side}`,
    className: "branch",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points
  };
};

const preferredDirection = (
  context: Stage4ContinuityContext,
  sideHash: number,
  x: number,
  y: number,
  prevDirX: number,
  prevDirY: number,
  segment: number
): { x: number; y: number } => {
  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const g = continuity.gradientStep;
  const gx = context.terrain.elevationAt(x + g, y) - context.terrain.elevationAt(x - g, y);
  const gy = context.terrain.elevationAt(x, y + g) - context.terrain.elevationAt(x, y - g);

  let contourX = -gy;
  let contourY = gx;
  const contourLen = Math.hypot(contourX, contourY);
  if (contourLen > 1e-6) {
    contourX /= contourLen;
    contourY /= contourLen;
  } else {
    contourX = prevDirX;
    contourY = prevDirY;
  }

  if (contourX * prevDirX + contourY * prevDirY < 0) {
    contourX = -contourX;
    contourY = -contourY;
  }

  const noiseValue = fbm2D(context.fieldSeed, x * continuity.noiseFrequency, y * continuity.noiseFrequency, {
    octaves: 3,
    persistence: 0.56,
    lacunarity: 2.1
  });
  const extraTurn = (hashToUnit(hashCoords(sideHash, segment * 31 + 17, segment * 37 + 23, 1613)) - 0.5) * 0.5;
  const noiseTurn = (noiseValue - 0.5) * Math.PI * 1.35 + extraTurn;
  const prevAngle = Math.atan2(prevDirY, prevDirX);
  const noiseAngle = prevAngle + noiseTurn;
  const noiseX = Math.cos(noiseAngle);
  const noiseY = Math.sin(noiseAngle);

  const desiredX =
    prevDirX * continuity.previousDirectionInfluence +
    contourX * continuity.contourInfluence +
    noiseX * continuity.noiseInfluence;
  const desiredY =
    prevDirY * continuity.previousDirectionInfluence +
    contourY * continuity.contourInfluence +
    noiseY * continuity.noiseInfluence;

  const normalized = normalizeWithFallback(desiredX, desiredY, prevDirX, prevDirY);
  return limitTurn(prevDirX, prevDirY, normalized.x, normalized.y, continuity.maxTurnRadPerStep);
};

const pickFeasibleStep = (
  context: Stage4ContinuityContext,
  sideHash: number,
  current: Point,
  preferredDirX: number,
  preferredDirY: number,
  segment: number
): StepCandidate | null => {
  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const lengthRoll = hashToUnit(hashCoords(sideHash, segment * 41 + 7, segment * 43 + 11, 1627));
  const length = lerp(continuity.segmentLengthMin, continuity.segmentLengthMax, lengthRoll);
  const tryCount = Math.max(1, continuity.candidateTurnTries);

  const offsetAngles: number[] = [0];
  for (let i = 1; i <= tryCount; i += 1) {
    offsetAngles.push(i * continuity.candidateTurnStepRad);
    offsetAngles.push(-i * continuity.candidateTurnStepRad);
  }

  for (const offsetAngle of offsetAngles) {
    const turned = rotateUnit(preferredDirX, preferredDirY, offsetAngle);
    const next = {
      x: current.x + turned.x * length,
      y: current.y + turned.y * length
    };
    if (context.terrain.slopeAt(next.x, next.y) > continuity.maxSlope) {
      continue;
    }
    return {
      point: next,
      dirX: turned.x,
      dirY: turned.y
    };
  }

  return null;
};

const buildUnifiedContinuityRoads = (roads: RoadSegment[]): RoadSegment[] => {
  if (roads.length === 0) {
    return roads;
  }

  const continuity = V2_SETTLEMENT_CONFIG.stage4.continuity;
  const segments = buildRawSegments(roads);
  splitSegmentsAtIntersections(segments, continuity.graphEndpointSnapRadius);
  const pieces = buildEdgePieces(segments, continuity.graphMinEdgeLength);
  if (pieces.length === 0) {
    return [];
  }

  let graph = buildWeldedGraph(pieces, continuity.graphNodeSnapRadius);
  graph = collapseShortJunctionLinks(graph.nodes, graph.edges, continuity.graphJunctionMergeLength);
  pruneShortLeafEdges(graph.nodes.length, graph.edges, continuity.graphStubPruneLength);
  const chains = extractGraphChains(graph.nodes, graph.edges);

  const merged: RoadSegment[] = [];
  for (let i = 0; i < chains.length; i += 1) {
    const points = chains[i].map((nodeIndex) => ({ x: graph.nodes[nodeIndex].x, y: graph.nodes[nodeIndex].y }));
    if (points.length < 2 || polylineLength(points) < continuity.graphMinEdgeLength) {
      continue;
    }
    merged.push({
      id: `rvcg-${i}`,
      className: "branch",
      width: V2_SETTLEMENT_CONFIG.roads.width,
      points
    });
  }

  return merged;
};

const buildRawSegments = (roads: RoadSegment[]): RawSegment[] => {
  const segments: RawSegment[] = [];
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      if (Math.hypot(b.x - a.x, b.y - a.y) <= SPLIT_EPS) {
        continue;
      }
      segments.push({
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        ts: [0, 1]
      });
    }
  }
  return segments;
};

const splitSegmentsAtIntersections = (segments: RawSegment[], endpointSnapRadius: number): void => {
  for (let i = 0; i < segments.length; i += 1) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length; j += 1) {
      const b = segments[j];

      const cross = strictSegmentIntersection(a, b);
      if (cross) {
        addSplitT(a, cross.t);
        addSplitT(b, cross.u);
      }

      snapSegmentEndpointIntoOther(a.ax, a.ay, b, endpointSnapRadius);
      snapSegmentEndpointIntoOther(a.bx, a.by, b, endpointSnapRadius);
      snapSegmentEndpointIntoOther(b.ax, b.ay, a, endpointSnapRadius);
      snapSegmentEndpointIntoOther(b.bx, b.by, a, endpointSnapRadius);
    }
  }
};

const strictSegmentIntersection = (a: RawSegment, b: RawSegment): { t: number; u: number } | null => {
  const rX = a.bx - a.ax;
  const rY = a.by - a.ay;
  const sX = b.bx - b.ax;
  const sY = b.by - b.ay;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) <= 1e-9) {
    return null;
  }

  const qmpX = b.ax - a.ax;
  const qmpY = b.ay - a.ay;
  const t = (qmpX * sY - qmpY * sX) / denom;
  const u = (qmpX * rY - qmpY * rX) / denom;

  if (t <= SPLIT_EPS || t >= 1 - SPLIT_EPS || u <= SPLIT_EPS || u >= 1 - SPLIT_EPS) {
    return null;
  }

  return { t, u };
};

const snapSegmentEndpointIntoOther = (px: number, py: number, target: RawSegment, radius: number): void => {
  const projection = projectParamToSegment(px, py, target.ax, target.ay, target.bx, target.by);
  if (!projection) {
    return;
  }
  if (projection.distance > radius) {
    return;
  }
  if (projection.t <= SPLIT_EPS || projection.t >= 1 - SPLIT_EPS) {
    return;
  }
  addSplitT(target, projection.t);
};

const projectParamToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { t: number; distance: number } | null => {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-9) {
    return null;
  }
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / lenSq, 0, 1);
  const qx = ax + vx * t;
  const qy = ay + vy * t;
  return {
    t,
    distance: Math.hypot(px - qx, py - qy)
  };
};

const addSplitT = (segment: RawSegment, t: number): void => {
  if (t <= SPLIT_EPS || t >= 1 - SPLIT_EPS) {
    return;
  }
  for (const existing of segment.ts) {
    if (Math.abs(existing - t) <= 1e-4) {
      return;
    }
  }
  segment.ts.push(t);
};

const buildEdgePieces = (segments: RawSegment[], minLength: number): EdgePiece[] => {
  const pieces: EdgePiece[] = [];

  for (const segment of segments) {
    const ts = Array.from(segment.ts).sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i += 1) {
      const t0 = ts[i - 1];
      const t1 = ts[i];
      const a = pointAlong(segment, t0);
      const b = pointAlong(segment, t1);
      if (Math.hypot(b.x - a.x, b.y - a.y) < minLength) {
        continue;
      }
      pieces.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }

  return pieces;
};

const pointAlong = (segment: RawSegment, t: number): Point => ({
  x: lerp(segment.ax, segment.bx, t),
  y: lerp(segment.ay, segment.by, t)
});

const buildWeldedGraph = (pieces: EdgePiece[], nodeSnapRadius: number): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();
  const grid = new Map<string, number[]>();

  const getNode = (x: number, y: number): number => {
    const gx = Math.floor(x / nodeSnapRadius);
    const gy = Math.floor(y / nodeSnapRadius);
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const key = `${gx + ox},${gy + oy}`;
        const list = grid.get(key);
        if (!list) {
          continue;
        }
        for (const nodeIndex of list) {
          const node = nodes[nodeIndex];
          if (Math.hypot(node.x - x, node.y - y) <= nodeSnapRadius) {
            return nodeIndex;
          }
        }
      }
    }

    const nodeIndex = nodes.length;
    nodes.push({ x, y });
    const homeKey = `${gx},${gy}`;
    const home = grid.get(homeKey);
    if (home) {
      home.push(nodeIndex);
    } else {
      grid.set(homeKey, [nodeIndex]);
    }
    return nodeIndex;
  };

  for (const piece of pieces) {
    const a = getNode(piece.ax, piece.ay);
    const b = getNode(piece.bx, piece.by);
    if (a === b) {
      continue;
    }
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    const key = `${low}|${high}`;
    if (edgeSeen.has(key)) {
      continue;
    }
    edgeSeen.add(key);
    edges.push({
      a: low,
      b: high,
      length: Math.hypot(nodes[high].x - nodes[low].x, nodes[high].y - nodes[low].y),
      active: true
    });
  }

  return { nodes, edges };
};

const collapseShortJunctionLinks = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxLinkLength: number
): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  if (maxLinkLength <= 0) {
    return { nodes, edges };
  }

  const degree = new Array<number>(nodes.length).fill(0);
  for (const edge of edges) {
    if (!edge.active) {
      continue;
    }
    degree[edge.a] += 1;
    degree[edge.b] += 1;
  }

  const parent = new Array<number>(nodes.length);
  for (let i = 0; i < nodes.length; i += 1) {
    parent[i] = i;
  }

  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) {
      root = parent[root];
    }
    let cur = x;
    while (parent[cur] !== cur) {
      const next = parent[cur];
      parent[cur] = root;
      cur = next;
    }
    return root;
  };

  const unite = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) {
      return;
    }
    parent[rb] = ra;
  };

  let mergedAny = false;
  for (const edge of edges) {
    if (!edge.active || edge.length > maxLinkLength) {
      continue;
    }
    if (degree[edge.a] >= 3 || degree[edge.b] >= 3) {
      unite(edge.a, edge.b);
      mergedAny = true;
    }
  }

  if (!mergedAny) {
    return { nodes, edges };
  }

  const rootStats = new Map<number, { sumX: number; sumY: number; count: number }>();
  for (let i = 0; i < nodes.length; i += 1) {
    const root = find(i);
    const stats = rootStats.get(root);
    if (stats) {
      stats.sumX += nodes[i].x;
      stats.sumY += nodes[i].y;
      stats.count += 1;
    } else {
      rootStats.set(root, { sumX: nodes[i].x, sumY: nodes[i].y, count: 1 });
    }
  }

  const rootToNodeIndex = new Map<number, number>();
  const mergedNodes: GraphNode[] = [];
  for (const [root, stats] of rootStats) {
    rootToNodeIndex.set(root, mergedNodes.length);
    mergedNodes.push({
      x: stats.sumX / stats.count,
      y: stats.sumY / stats.count
    });
  }

  const edgeSeen = new Set<string>();
  const mergedEdges: GraphEdge[] = [];
  for (const edge of edges) {
    if (!edge.active) {
      continue;
    }
    const aRoot = find(edge.a);
    const bRoot = find(edge.b);
    const a = rootToNodeIndex.get(aRoot);
    const b = rootToNodeIndex.get(bRoot);
    if (a === undefined || b === undefined || a === b) {
      continue;
    }
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    const key = `${low}|${high}`;
    if (edgeSeen.has(key)) {
      continue;
    }
    edgeSeen.add(key);
    mergedEdges.push({
      a: low,
      b: high,
      length: Math.hypot(mergedNodes[high].x - mergedNodes[low].x, mergedNodes[high].y - mergedNodes[low].y),
      active: true
    });
  }

  return {
    nodes: mergedNodes,
    edges: mergedEdges
  };
};

const pruneShortLeafEdges = (nodeCount: number, edges: GraphEdge[], stubLength: number): void => {
  for (;;) {
    const degree = new Array<number>(nodeCount).fill(0);
    for (const edge of edges) {
      if (!edge.active) {
        continue;
      }
      degree[edge.a] += 1;
      degree[edge.b] += 1;
    }

    let removedAny = false;
    for (const edge of edges) {
      if (!edge.active || edge.length > stubLength) {
        continue;
      }
      const aLeaf = degree[edge.a] === 1 && degree[edge.b] >= 2;
      const bLeaf = degree[edge.b] === 1 && degree[edge.a] >= 2;
      if (!aLeaf && !bLeaf) {
        continue;
      }
      edge.active = false;
      removedAny = true;
    }

    if (!removedAny) {
      break;
    }
  }
};

const extractGraphChains = (nodes: GraphNode[], edges: GraphEdge[]): number[][] => {
  const adjacency = new Map<number, number[]>();
  const activeEdgeIndices: number[] = [];
  const degree = new Array<number>(nodes.length).fill(0);

  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i];
    if (!edge.active) {
      continue;
    }
    activeEdgeIndices.push(i);
    degree[edge.a] += 1;
    degree[edge.b] += 1;
    addAdjacency(adjacency, edge.a, i);
    addAdjacency(adjacency, edge.b, i);
  }

  const visited = new Set<number>();
  const chains: number[][] = [];

  for (let node = 0; node < nodes.length; node += 1) {
    if (degree[node] === 0 || degree[node] === 2) {
      continue;
    }
    const incident = adjacency.get(node) ?? [];
    for (const edgeIndex of incident) {
      if (visited.has(edgeIndex)) {
        continue;
      }
      const chain = walkChain(node, edgeIndex, edges, adjacency, degree, visited);
      if (chain.length >= 2) {
        chains.push(chain);
      }
    }
  }

  for (const edgeIndex of activeEdgeIndices) {
    if (visited.has(edgeIndex)) {
      continue;
    }
    const edge = edges[edgeIndex];
    const loop = walkLoop(edge.a, edgeIndex, edges, adjacency, visited);
    if (loop.length >= 2) {
      chains.push(loop);
    }
  }

  return chains;
};

const addAdjacency = (map: Map<number, number[]>, node: number, edgeIndex: number): void => {
  const list = map.get(node);
  if (list) {
    list.push(edgeIndex);
  } else {
    map.set(node, [edgeIndex]);
  }
};

const walkChain = (
  startNode: number,
  startEdgeIndex: number,
  edges: GraphEdge[],
  adjacency: Map<number, number[]>,
  degree: number[],
  visited: Set<number>
): number[] => {
  const path: number[] = [startNode];
  let currentNode = startNode;
  let edgeIndex = startEdgeIndex;

  for (;;) {
    if (visited.has(edgeIndex)) {
      break;
    }
    visited.add(edgeIndex);
    const edge = edges[edgeIndex];
    const nextNode = edge.a === currentNode ? edge.b : edge.a;
    path.push(nextNode);

    if (degree[nextNode] !== 2) {
      break;
    }

    const incident = adjacency.get(nextNode) ?? [];
    let nextEdgeIndex = -1;
    for (const candidate of incident) {
      if (!visited.has(candidate)) {
        nextEdgeIndex = candidate;
        break;
      }
    }
    if (nextEdgeIndex < 0) {
      break;
    }

    currentNode = nextNode;
    edgeIndex = nextEdgeIndex;
  }

  return path;
};

const walkLoop = (
  startNode: number,
  startEdgeIndex: number,
  edges: GraphEdge[],
  adjacency: Map<number, number[]>,
  visited: Set<number>
): number[] => {
  const path: number[] = [startNode];
  let currentNode = startNode;
  let edgeIndex = startEdgeIndex;

  for (;;) {
    if (visited.has(edgeIndex)) {
      break;
    }
    visited.add(edgeIndex);
    const edge = edges[edgeIndex];
    const nextNode = edge.a === currentNode ? edge.b : edge.a;
    path.push(nextNode);

    const incident = adjacency.get(nextNode) ?? [];
    let nextEdgeIndex = -1;
    for (const candidate of incident) {
      if (!visited.has(candidate)) {
        nextEdgeIndex = candidate;
        break;
      }
    }

    if (nextEdgeIndex < 0 || nextNode === startNode) {
      break;
    }

    currentNode = nextNode;
    edgeIndex = nextEdgeIndex;
  }

  return path;
};

const normalizeWithFallback = (x: number, y: number, fallbackX: number, fallbackY: number): { x: number; y: number } => {
  const len = Math.hypot(x, y);
  if (len <= 1e-6) {
    const fallbackLen = Math.hypot(fallbackX, fallbackY);
    if (fallbackLen <= 1e-6) {
      return { x: 1, y: 0 };
    }
    return { x: fallbackX / fallbackLen, y: fallbackY / fallbackLen };
  }
  return { x: x / len, y: y / len };
};

const rotateUnit = (x: number, y: number, angle: number): { x: number; y: number } => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos
  };
};

const limitTurn = (
  prevX: number,
  prevY: number,
  desiredX: number,
  desiredY: number,
  maxTurnRad: number
): { x: number; y: number } => {
  const prevAngle = Math.atan2(prevY, prevX);
  const desiredAngle = Math.atan2(desiredY, desiredX);
  const delta = shortestAngleDelta(prevAngle, desiredAngle);
  const clamped = clamp(delta, -maxTurnRad, maxTurnRad);
  return {
    x: Math.cos(prevAngle + clamped),
    y: Math.sin(prevAngle + clamped)
  };
};

const shortestAngleDelta = (from: number, to: number): number => {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) {
    delta -= twoPi;
  }
  if (delta < -Math.PI) {
    delta += twoPi;
  }
  return delta;
};

const roadIntersectsBounds = (
  road: RoadSegment,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean => {
  let roadMinX = Number.POSITIVE_INFINITY;
  let roadMaxX = Number.NEGATIVE_INFINITY;
  let roadMinY = Number.POSITIVE_INFINITY;
  let roadMaxY = Number.NEGATIVE_INFINITY;

  for (const point of road.points) {
    if (point.x < roadMinX) roadMinX = point.x;
    if (point.x > roadMaxX) roadMaxX = point.x;
    if (point.y < roadMinY) roadMinY = point.y;
    if (point.y > roadMaxY) roadMaxY = point.y;
  }

  return !(roadMaxX < minX || roadMinX > maxX || roadMaxY < minY || roadMinY > maxY);
};

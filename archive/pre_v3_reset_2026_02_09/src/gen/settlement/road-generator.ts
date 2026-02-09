import { clamp, lerp } from "../../util/math";
import { WorldConfig } from "../config";
import { hashCoords, hashString, hashToUnit } from "../hash";
import { TerrainSampler } from "../terrain";
import { localBranchRoadId, localSpokeRoadId, regionalRoadId, roadEdgeKey } from "./stable-ids";
import { Road, RoadHierarchy, RoadType, Village } from "./types";

type EdgeCandidate = {
  a: Village;
  b: Village;
  id: string;
  weight: number;
  distance: number;
};

type TrunkAxisMode = "axis" | "perp";

type LocalTemplatePattern = {
  trunkAxes: TrunkAxisMode[];
  trunkLengthMin: number;
  trunkLengthMax: number;
  trunkHierarchy: RoadHierarchy;
  connectorCount: number;
  connectorHierarchy: RoadHierarchy;
  maxConnectorDistanceFactor: number;
  branchChance: number;
  branchLengthMin: number;
  branchLengthMax: number;
  branchHierarchy: RoadHierarchy;
  minBranchSpacing: number;
};

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = new Array(size);
    this.rank = new Array(size);
    for (let i = 0; i < size; i += 1) {
      this.parent[i] = i;
      this.rank[i] = 0;
    }
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  union(a: number, b: number): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return false;
    }

    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] += 1;
    }

    return true;
  }
}

export class RoadGenerator {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly roadSeed: number;

  constructor(config: WorldConfig, terrain: TerrainSampler, roadSeed: number) {
    this.config = config;
    this.terrain = terrain;
    this.roadSeed = roadSeed;
  }

  buildRegionalRoadNetwork(villages: Village[]): Road[] {
    if (villages.length < 2) {
      return [];
    }

    const villageIndex = new Map<string, number>();
    for (let i = 0; i < villages.length; i += 1) {
      villageIndex.set(villages[i].id, i);
    }

    const edgeById = new Map<string, EdgeCandidate>();
    for (let i = 0; i < villages.length; i += 1) {
      const a = villages[i];
      const nearest: { village: Village; distance: number }[] = [];
      for (let j = 0; j < villages.length; j += 1) {
        if (i === j) {
          continue;
        }
        const b = villages[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance > this.config.roads.maxConnectionDistance) {
          continue;
        }
        nearest.push({ village: b, distance });
      }

      nearest.sort((left, right) => left.distance - right.distance);
      const count = Math.min(this.config.roads.nearestNeighbors, nearest.length);
      for (let k = 0; k < count; k += 1) {
        const b = nearest[k].village;
        const id = roadEdgeKey(a.id, b.id);
        if (!edgeById.has(id)) {
          const distance = nearest[k].distance;
          const weight = this.estimateConnectionCost(a, b, distance);
          edgeById.set(id, { a, b, id, weight, distance });
        }
      }
    }

    const candidates = Array.from(edgeById.values()).sort((left, right) => left.weight - right.weight);
    const uf = new UnionFind(villages.length);
    const selected = new Map<string, EdgeCandidate>();
    const leftovers: EdgeCandidate[] = [];

    for (const edge of candidates) {
      const ai = villageIndex.get(edge.a.id);
      const bi = villageIndex.get(edge.b.id);
      if (ai === undefined || bi === undefined) {
        continue;
      }
      if (uf.union(ai, bi)) {
        selected.set(edge.id, edge);
      } else {
        leftovers.push(edge);
      }
    }

    const targetExtra = Math.floor(villages.length * 0.28);
    let added = 0;
    for (const edge of leftovers) {
      if (added >= targetExtra) {
        break;
      }
      const roll = hashToUnit(hashCoords(this.roadSeed, edge.a.cellX + edge.b.cellX, edge.a.cellY + edge.b.cellY, 199));
      const chance = this.config.roads.loopChance * clamp(1 - edge.distance / this.config.roads.maxConnectionDistance, 0.25, 1);
      if (roll < chance) {
        selected.set(edge.id, edge);
        added += 1;
      }
    }

    const roads: Road[] = [];
    for (const edge of selected.values()) {
      const type: RoadType = edge.distance > this.config.roads.maxConnectionDistance * 0.55 ? "major" : "minor";
      const hierarchy: RoadHierarchy = type === "major" ? "arterial" : "collector";
      const width = type === "major" ? this.config.roads.majorWidth : this.config.roads.minorWidth;
      roads.push({
        id: regionalRoadId(edge.id),
        type,
        hierarchy,
        width,
        points: this.routeRoad(edge.a, edge.b, edge.id),
        fromVillageId: edge.a.id,
        toVillageId: edge.b.id
      });
    }

    return roads;
  }

  buildLocalRoadNetwork(villages: Village[], regionalRoads: Road[]): Road[] {
    const roads: Road[] = [];
    const existingRoads: Road[] = [...regionalRoads];

    for (const village of villages) {
      const localSeed = hashString(`${this.config.seed}:local-road:${village.id}`);
      const pattern = this.templatePattern(village, localSeed);
      const baseAngle = this.estimateVillageAxis(village, regionalRoads, localSeed);
      const axisX = Math.cos(baseAngle);
      const axisY = Math.sin(baseAngle);
      const perpX = -axisY;
      const perpY = axisX;
      const duplicateThreshold = Math.max(7, village.radius * 0.2);
      const villageTrunks: Road[] = [];
      let roadIndex = 0;

      for (let trunkIndex = 0; trunkIndex < pattern.trunkAxes.length; trunkIndex += 1) {
        const trunkAxis = pattern.trunkAxes[trunkIndex];
        const alongX = trunkAxis === "axis" ? axisX : perpX;
        const alongY = trunkAxis === "axis" ? axisY : perpY;
        const normalX = -alongY;
        const normalY = alongX;
        const trunkRoll = hashToUnit(hashCoords(localSeed, trunkIndex, 17, 677));
        const offsetRoll = hashToUnit(hashCoords(localSeed, trunkIndex, 19, 701));
        const offset = (offsetRoll * 2 - 1) * Math.min(10, village.radius * 0.12) * (trunkIndex === 0 ? 0.45 : 1);
        const halfLength = village.radius * lerp(pattern.trunkLengthMin, pattern.trunkLengthMax, trunkRoll);
        const trunkLine = this.createStreetLine(
          village.x,
          village.y,
          alongX,
          alongY,
          normalX,
          normalY,
          halfLength,
          offset,
          trunkRoll
        );
        if (!this.isRoadLineValid(trunkLine) || !this.isRoadLineDistinct(trunkLine, existingRoads, duplicateThreshold)) {
          continue;
        }
        const trunkRoad: Road = {
          id: localSpokeRoadId(village.id, roadIndex),
          type: "local",
          hierarchy: pattern.trunkHierarchy,
          width: this.config.roads.localWidth * (trunkIndex === 0 ? 1.12 : 1.04),
          points: trunkLine,
          fromVillageId: village.id,
          toVillageId: village.id
        };
        roads.push(trunkRoad);
        existingRoads.push(trunkRoad);
        villageTrunks.push(trunkRoad);
        roadIndex += 1;
      }

      const nearestRegional = this.nearestRegionalRoadsToVillage(village, regionalRoads, pattern.connectorCount);
      for (const connectorTarget of nearestRegional) {
        if (villageTrunks.length === 0) {
          break;
        }
        if (connectorTarget.distance > village.radius * pattern.maxConnectorDistanceFactor) {
          continue;
        }
        const anchor = this.closestPointOnRoadSet(
          connectorTarget.pointX,
          connectorTarget.pointY,
          villageTrunks
        );
        if (!anchor) {
          continue;
        }
        const connectorRoll = hashToUnit(hashCoords(localSeed, roadIndex, 23, 733));
        const connectorLine = this.createConnectorLine(
          anchor.x,
          anchor.y,
          connectorTarget.pointX,
          connectorTarget.pointY,
          connectorRoll
        );
        if (
          !this.isRoadLineValid(connectorLine) ||
          !this.isRoadLineDistinct(connectorLine, existingRoads, Math.max(6, this.config.roads.localWidth * 2.1))
        ) {
          continue;
        }
        if (this.hasBlockedIntersections(connectorLine, existingRoads, 6.5)) {
          continue;
        }

        const connectorRoad: Road = {
          id: localSpokeRoadId(village.id, roadIndex),
          type: "local",
          hierarchy: pattern.connectorHierarchy,
          width: this.config.roads.localWidth * 1.02,
          points: connectorLine,
          fromVillageId: village.id,
          toVillageId: village.id
        };
        roads.push(connectorRoad);
        existingRoads.push(connectorRoad);
        roadIndex += 1;
      }

      const maxVillageBranches = Math.max(
        4,
        Math.round(village.radius * (village.template === "crossroad" ? 0.18 : village.template === "lakeside" ? 0.14 : 0.12))
      );
      let addedBranches = 0;

      for (let trunkIndex = 0; trunkIndex < villageTrunks.length; trunkIndex += 1) {
        const trunk = villageTrunks[trunkIndex];
        const trunkLength = this.polylineLength(trunk.points);
        const slotCount = Math.max(2, Math.floor(trunkLength / pattern.minBranchSpacing));
        for (let slot = 1; slot < slotCount; slot += 1) {
          if (addedBranches >= maxVillageBranches) {
            break;
          }

          const branchSeed = hashCoords(localSeed, trunkIndex * 211 + slot, 37, 823);
          const spawnRoll = hashToUnit(branchSeed);
          if (spawnRoll > pattern.branchChance) {
            continue;
          }

          const t = (slot + hashToUnit(hashCoords(branchSeed, 2, 1, 827)) * 0.35) / slotCount;
          const anchor = this.samplePolyline(trunk.points, t);
          const side: -1 | 1 = hashToUnit(hashCoords(branchSeed, 3, 1, 829)) < 0.5 ? -1 : 1;
          const branchRoll = hashToUnit(hashCoords(branchSeed, 5, 1, 839));
          const branchLength = village.radius * lerp(pattern.branchLengthMin, pattern.branchLengthMax, branchRoll);
          const branchLine = this.createBranchLine(
            anchor.x,
            anchor.y,
            anchor.tangentX,
            anchor.tangentY,
            side,
            branchLength,
            branchRoll
          );
          if (
            !this.isRoadLineValid(branchLine) ||
            !this.isRoadLineDistinct(branchLine, existingRoads, Math.max(6, duplicateThreshold * 0.85))
          ) {
            continue;
          }
          if (this.hasBlockedIntersections(branchLine, existingRoads, 6.5)) {
            continue;
          }

          const branchEnd = branchLine[branchLine.length - 1];
          if (this.pointNearRoads(branchEnd.x, branchEnd.y, existingRoads, Math.max(8, this.config.roads.localWidth * 2.4))) {
            continue;
          }

          const branchRoad: Road = {
            id: localBranchRoadId(village.id, trunkIndex, slot),
            type: "local",
            hierarchy: pattern.branchHierarchy,
            width: this.config.roads.localWidth * 0.9,
            points: branchLine,
            fromVillageId: village.id,
            toVillageId: village.id
          };
          roads.push(branchRoad);
          existingRoads.push(branchRoad);
          addedBranches += 1;
        }
      }
    }

    return roads;
  }

  private estimateVillageAxis(village: Village, regionalRoads: Road[], localSeed: number): number {
    const nearest = this.nearestRegionalRoadsToVillage(village, regionalRoads, 1)[0];
    if (nearest) {
      return Math.atan2(nearest.tangentY, nearest.tangentX);
    }
    return hashToUnit(hashCoords(localSeed, village.cellX, village.cellY, 83)) * Math.PI * 2;
  }

  private nearestRegionalRoadsToVillage(
    village: Village,
    regionalRoads: Road[],
    count: number
  ): { distance: number; tangentX: number; tangentY: number; pointX: number; pointY: number }[] {
    const candidates: { distance: number; tangentX: number; tangentY: number; pointX: number; pointY: number }[] = [];

    for (const road of regionalRoads) {
      let bestRoadDistance = Number.POSITIVE_INFINITY;
      let bestRoadTangentX = 1;
      let bestRoadTangentY = 0;
      let bestRoadPointX = village.x;
      let bestRoadPointY = village.y;
      if (road.points.length < 2) {
        continue;
      }
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const closest = this.closestPointOnSegment(village.x, village.y, a.x, a.y, b.x, b.y);
        if (closest.distance >= bestRoadDistance) {
          continue;
        }
        bestRoadDistance = closest.distance;
        bestRoadPointX = closest.x;
        bestRoadPointY = closest.y;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length > 1e-6) {
          bestRoadTangentX = dx / length;
          bestRoadTangentY = dy / length;
        }
      }

      if (Number.isFinite(bestRoadDistance)) {
        candidates.push({
          distance: bestRoadDistance,
          tangentX: bestRoadTangentX,
          tangentY: bestRoadTangentY,
          pointX: bestRoadPointX,
          pointY: bestRoadPointY
        });
      }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    return candidates.slice(0, Math.max(1, count));
  }

  private templatePattern(village: Village, localSeed: number): LocalTemplatePattern {
    const largerVillage = village.radius > 94;
    if (village.template === "lakeside") {
      return {
        trunkAxes: ["axis"],
        trunkLengthMin: 1.5,
        trunkLengthMax: 2.2,
        trunkHierarchy: "lane",
        connectorCount: 2,
        connectorHierarchy: "lane",
        maxConnectorDistanceFactor: 2.4,
        branchChance: largerVillage ? 0.72 : 0.62,
        branchLengthMin: 0.56,
        branchLengthMax: 1.04,
        branchHierarchy: "path",
        minBranchSpacing: largerVillage ? 22 : 25
      };
    }

    if (village.template === "crossroad") {
      const denseRoll = hashToUnit(hashCoords(localSeed, village.cellX, village.cellY, 431));
      const dense = largerVillage || denseRoll > 0.56;
      return {
        trunkAxes: ["axis", "perp"],
        trunkLengthMin: dense ? 1.45 : 1.35,
        trunkLengthMax: dense ? 2.15 : 1.95,
        trunkHierarchy: "lane",
        connectorCount: dense ? 3 : 2,
        connectorHierarchy: "lane",
        maxConnectorDistanceFactor: 2.35,
        branchChance: dense ? 0.78 : 0.68,
        branchLengthMin: 0.6,
        branchLengthMax: 1.12,
        branchHierarchy: "path",
        minBranchSpacing: dense ? 20 : 24
      };
    }

    return {
      trunkAxes: ["axis"],
      trunkLengthMin: 1.4,
      trunkLengthMax: 1.85,
      trunkHierarchy: "path",
      connectorCount: 1,
      connectorHierarchy: "path",
      maxConnectorDistanceFactor: 2.3,
      branchChance: largerVillage ? 0.6 : 0.52,
      branchLengthMin: 0.52,
      branchLengthMax: 0.9,
      branchHierarchy: "path",
      minBranchSpacing: largerVillage ? 24 : 27
    };
  }

  private createStreetLine(
    centerX: number,
    centerY: number,
    axisX: number,
    axisY: number,
    normalX: number,
    normalY: number,
    halfLength: number,
    offset: number,
    jitterRoll: number
  ): { x: number; y: number }[] {
    const wobble = (jitterRoll * 2 - 1) * halfLength * 0.12;
    const coreX = centerX + normalX * offset;
    const coreY = centerY + normalY * offset;
    const start = {
      x: coreX - axisX * halfLength + normalX * wobble,
      y: coreY - axisY * halfLength + normalY * wobble
    };
    const end = {
      x: coreX + axisX * halfLength - normalX * wobble,
      y: coreY + axisY * halfLength - normalY * wobble
    };
    const mid = {
      x: coreX + normalX * wobble * 0.4,
      y: coreY + normalY * wobble * 0.4
    };
    return [start, mid, end];
  }

  private createConnectorLine(startX: number, startY: number, endX: number, endY: number, jitterRoll: number): { x: number; y: number }[] {
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-6) {
      return [{ x: startX, y: startY }, { x: endX, y: endY }];
    }
    const tangentX = dx / distance;
    const tangentY = dy / distance;
    const normalX = -tangentY;
    const normalY = tangentX;
    const wobble = (jitterRoll * 2 - 1) * Math.min(18, distance * 0.18);

    return [
      { x: startX, y: startY },
      {
        x: lerp(startX, endX, 0.5) + normalX * wobble,
        y: lerp(startY, endY, 0.5) + normalY * wobble
      },
      { x: endX, y: endY }
    ];
  }

  private closestPointOnSegment(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
  ): { x: number; y: number; distance: number } {
    const vx = bx - ax;
    const vy = by - ay;
    const lenSq = vx * vx + vy * vy;
    if (lenSq <= 1e-6) {
      const dx = px - ax;
      const dy = py - ay;
      return { x: ax, y: ay, distance: Math.hypot(dx, dy) };
    }
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / lenSq, 0, 1);
    const x = ax + vx * t;
    const y = ay + vy * t;
    return { x, y, distance: Math.hypot(px - x, py - y) };
  }

  private isRoadLineDistinct(points: { x: number; y: number }[], existingRoads: Road[], minDistance: number): boolean {
    if (points.length < 2) {
      return false;
    }

    const start = points[0];
    const end = points[points.length - 1];
    const lineDx = end.x - start.x;
    const lineDy = end.y - start.y;
    const lineLength = Math.hypot(lineDx, lineDy);
    if (lineLength <= 1e-6) {
      return false;
    }

    const midPoint = points[Math.floor(points.length * 0.5)];
    for (const road of existingRoads) {
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const segDx = b.x - a.x;
        const segDy = b.y - a.y;
        const segLength = Math.hypot(segDx, segDy);
        if (segLength <= 1e-6) {
          continue;
        }
        const alignment = Math.abs((lineDx * segDx + lineDy * segDy) / (lineLength * segLength));
        if (alignment < 0.86) {
          continue;
        }
        const midpointDistance = this.closestPointOnSegment(midPoint.x, midPoint.y, a.x, a.y, b.x, b.y).distance;
        if (midpointDistance <= minDistance) {
          return false;
        }
      }
    }

    return true;
  }

  private closestPointOnRoadSet(
    x: number,
    y: number,
    roads: Road[]
  ): { x: number; y: number; distance: number } | null {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestX = 0;
    let bestY = 0;

    for (const road of roads) {
      if (road.points.length < 2) {
        continue;
      }
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const closest = this.closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
        if (closest.distance < bestDistance) {
          bestDistance = closest.distance;
          bestX = closest.x;
          bestY = closest.y;
        }
      }
    }

    if (!Number.isFinite(bestDistance)) {
      return null;
    }
    return {
      x: bestX,
      y: bestY,
      distance: bestDistance
    };
  }

  private hasBlockedIntersections(points: { x: number; y: number }[], existingRoads: Road[], endpointTolerance: number): boolean {
    if (points.length < 2) {
      return true;
    }

    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      for (const road of existingRoads) {
        for (let j = 1; j < road.points.length; j += 1) {
          const c = road.points[j - 1];
          const d = road.points[j];
          const intersection = this.segmentIntersection(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
          if (!intersection) {
            continue;
          }
          const nearCandidateEndpoint =
            Math.hypot(intersection.x - start.x, intersection.y - start.y) <= endpointTolerance ||
            Math.hypot(intersection.x - end.x, intersection.y - end.y) <= endpointTolerance;
          const nearExistingEndpoint =
            Math.hypot(intersection.x - c.x, intersection.y - c.y) <= endpointTolerance ||
            Math.hypot(intersection.x - d.x, intersection.y - d.y) <= endpointTolerance;
          if (nearCandidateEndpoint || nearExistingEndpoint) {
            continue;
          }
          return true;
        }
      }
    }

    return false;
  }

  private segmentIntersection(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number
  ): { x: number; y: number } | null {
    const rX = bx - ax;
    const rY = by - ay;
    const sX = dx - cx;
    const sY = dy - cy;
    const denom = rX * sY - rY * sX;
    if (Math.abs(denom) <= 1e-6) {
      return null;
    }

    const qPx = cx - ax;
    const qPy = cy - ay;
    const t = (qPx * sY - qPy * sX) / denom;
    const u = (qPx * rY - qPy * rX) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) {
      return null;
    }

    return {
      x: ax + rX * t,
      y: ay + rY * t
    };
  }

  private pointNearRoads(x: number, y: number, roads: Road[], minDistance: number): boolean {
    const minDistanceSq = minDistance * minDistance;
    for (const road of roads) {
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const closest = this.closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
        if (closest.distance * closest.distance <= minDistanceSq) {
          return true;
        }
      }
    }
    return false;
  }

  private polylineLength(points: { x: number; y: number }[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      length += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return length;
  }

  private samplePolyline(
    points: { x: number; y: number }[],
    t: number
  ): { x: number; y: number; tangentX: number; tangentY: number } {
    if (points.length < 2) {
      return {
        x: points[0]?.x ?? 0,
        y: points[0]?.y ?? 0,
        tangentX: 1,
        tangentY: 0
      };
    }

    const totalLength = this.polylineLength(points);
    if (totalLength <= 1e-6) {
      return {
        x: points[0].x,
        y: points[0].y,
        tangentX: 1,
        tangentY: 0
      };
    }

    let remaining = clamp(t, 0, 1) * totalLength;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segmentLength = Math.hypot(dx, dy);
      if (segmentLength <= 1e-6) {
        continue;
      }
      if (remaining <= segmentLength) {
        const s = remaining / segmentLength;
        return {
          x: lerp(a.x, b.x, s),
          y: lerp(a.y, b.y, s),
          tangentX: dx / segmentLength,
          tangentY: dy / segmentLength
        };
      }
      remaining -= segmentLength;
    }

    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: last.x,
      y: last.y,
      tangentX: dx / length,
      tangentY: dy / length
    };
  }

  private createBranchLine(
    startX: number,
    startY: number,
    tangentX: number,
    tangentY: number,
    side: -1 | 1,
    length: number,
    jitterRoll: number
  ): { x: number; y: number }[] {
    const normalX = -tangentY * side;
    const normalY = tangentX * side;
    const forwardBias = (jitterRoll * 2 - 1) * 0.2;
    let dirX = normalX * (1 - Math.abs(forwardBias) * 0.35) + tangentX * forwardBias;
    let dirY = normalY * (1 - Math.abs(forwardBias) * 0.35) + tangentY * forwardBias;
    const dirLength = Math.hypot(dirX, dirY) || 1;
    dirX /= dirLength;
    dirY /= dirLength;

    const bendX = -dirY;
    const bendY = dirX;
    const bend = (jitterRoll * 2 - 1) * Math.min(14, length * 0.24);

    return [
      { x: startX, y: startY },
      {
        x: startX + dirX * length * 0.56 + bendX * bend * 0.3,
        y: startY + dirY * length * 0.56 + bendY * bend * 0.3
      },
      { x: startX + dirX * length, y: startY + dirY * length }
    ];
  }

  private estimateConnectionCost(a: Village, b: Village, distance: number): number {
    const steps = Math.max(3, Math.round(distance / 110));
    let penalty = 0;

    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const probe = this.terrain.probe(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
      if (probe.waterDepth > 0) {
        penalty += 3 + probe.waterDepth * 12;
      }
      penalty += probe.slope * 0.75;
    }

    return distance * (1 + penalty / steps);
  }

  private routeRoad(a: Village, b: Village, edgeId: string): { x: number; y: number }[] {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const segments = Math.max(3, Math.round(distance / this.config.roads.routeStep));
    const tangentX = distance > 0 ? dx / distance : 1;
    const tangentY = distance > 0 ? dy / distance : 0;
    const normalX = -tangentY;
    const normalY = tangentX;
    const points: { x: number; y: number }[] = [];
    const edgeHash = hashString(`edge:${edgeId}`);

    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const baseX = lerp(a.x, b.x, t);
      const baseY = lerp(a.y, b.y, t);
      const taper = Math.sin(t * Math.PI);
      const offsetNoise = hashToUnit(hashCoords(edgeHash, i, segments, 67)) * 2 - 1;
      const curvature =
        this.config.roads.maxCurvatureOffset * taper * (0.35 + (distance / this.config.roads.maxConnectionDistance) * 0.65);
      points.push({
        x: baseX + normalX * curvature * offsetNoise,
        y: baseY + normalY * curvature * offsetNoise
      });
    }

    points[0] = { x: a.x, y: a.y };
    points[points.length - 1] = { x: b.x, y: b.y };
    this.smoothLine(points, 2);
    const bridgeRun = this.findBridgeableWaterRun(points);

    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 1; i < points.length - 1; i += 1) {
        if (bridgeRun && i >= bridgeRun.start && i <= bridgeRun.end) {
          continue;
        }
        const probe = this.terrain.sample(points[i].x, points[i].y);
        if (probe.waterDepth <= 0.003) {
          continue;
        }
        const gradient = this.terrain.gradientAt(points[i].x, points[i].y, 5);
        const magnitude = Math.hypot(gradient.x, gradient.y);
        if (magnitude < 0.0001) {
          continue;
        }
        const push = 8 + probe.waterDepth * 85;
        points[i].x += (gradient.x / magnitude) * push;
        points[i].y += (gradient.y / magnitude) * push;
      }
    }

    points[0] = { x: a.x, y: a.y };
    points[points.length - 1] = { x: b.x, y: b.y };
    return points;
  }

  private findBridgeableWaterRun(points: { x: number; y: number }[]): { start: number; end: number } | null {
    let runStart = -1;
    let runEnd = -1;
    let runCount = 0;
    let maxDepth = 0;

    for (let i = 1; i < points.length - 1; i += 1) {
      const depth = this.terrain.sample(points[i].x, points[i].y).waterDepth;
      if (depth <= 0.004) {
        continue;
      }
      maxDepth = Math.max(maxDepth, depth);
      if (runStart < 0) {
        runStart = i;
        runEnd = i;
        runCount = 1;
        continue;
      }
      if (i === runEnd + 1) {
        runEnd = i;
        continue;
      }
      runCount += 1;
      if (runCount > 1) {
        return null;
      }
      runStart = i;
      runEnd = i;
    }

    if (runStart < 0 || runEnd < 0 || runEnd - runStart > 4) {
      return null;
    }
    if (runStart < 2 || runEnd > points.length - 3) {
      return null;
    }
    if (maxDepth > 0.05) {
      return null;
    }

    const span = Math.hypot(points[runEnd].x - points[runStart].x, points[runEnd].y - points[runStart].y);
    if (span > 120) {
      return null;
    }

    return { start: runStart, end: runEnd };
  }

  private smoothLine(points: { x: number; y: number }[], passes: number): void {
    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = 1; i < points.length - 1; i += 1) {
        points[i] = {
          x: points[i - 1].x * 0.25 + points[i].x * 0.5 + points[i + 1].x * 0.25,
          y: points[i - 1].y * 0.25 + points[i].y * 0.5 + points[i + 1].y * 0.25
        };
      }
    }
  }

  private isRoadLineValid(points: { x: number; y: number }[]): boolean {
    for (let i = 1; i < points.length; i += 1) {
      if (this.terrain.sample(points[i].x, points[i].y).waterDepth > 0.007) {
        return false;
      }
    }
    return true;
  }
}

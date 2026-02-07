import { clamp, lerp } from "../../util/math";
import { WorldConfig } from "../config";
import { hashCoords, hashString, hashToUnit } from "../hash";
import { TerrainSampler } from "../terrain";
import { localBranchRoadId, localSpokeRoadId, regionalRoadId, roadEdgeKey } from "./stable-ids";
import { Road, RoadType, Village } from "./types";

type EdgeCandidate = {
  a: Village;
  b: Village;
  id: string;
  weight: number;
  distance: number;
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
      const width = type === "major" ? this.config.roads.majorWidth : this.config.roads.minorWidth;
      roads.push({
        id: regionalRoadId(edge.id),
        type,
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
      const baseAngle = this.estimateVillageAxis(village, regionalRoads, localSeed);
      const axisX = Math.cos(baseAngle);
      const axisY = Math.sin(baseAngle);
      const perpX = -axisY;
      const perpY = axisX;
      const spacing = clamp(village.radius * 0.5, 24, 44);
      const duplicateThreshold = Math.max(7, spacing * 0.34);

      const nearestRegional = this.nearestRegionalRoadToVillage(village, regionalRoads);
      if (nearestRegional && nearestRegional.distance < village.radius * 1.8) {
        const connectorPoints = this.createConnectorLine(
          village.x,
          village.y,
          nearestRegional.pointX,
          nearestRegional.pointY,
          hashToUnit(hashCoords(localSeed, 991, 0, 911))
        );
        if (
          this.isRoadLineValid(connectorPoints) &&
          this.isRoadLineDistinct(connectorPoints, existingRoads, Math.max(6, this.config.roads.localWidth * 2.5))
        ) {
          const connectorRoad: Road = {
            id: localSpokeRoadId(village.id, 0),
            type: "local",
            width: this.config.roads.localWidth,
            points: connectorPoints,
            fromVillageId: village.id,
            toVillageId: village.id
          };
          roads.push(connectorRoad);
          existingRoads.push(connectorRoad);
        }
      }

      const laneOffsets = village.radius > 86 ? [-0.85, 0, 0.85] : [-0.55, 0];
      let laneIndex = 1;
      for (const laneOffset of laneOffsets) {
        const laneRoll = hashToUnit(hashCoords(localSeed, laneOffset + 7, 0, 433));
        const line = this.createStreetLine(
          village.x,
          village.y,
          axisX,
          axisY,
          perpX,
          perpY,
          village.radius * lerp(1.35, 1.95, laneRoll),
          laneOffset * spacing,
          laneRoll
        );
        if (!this.isRoadLineValid(line) || !this.isRoadLineDistinct(line, existingRoads, duplicateThreshold)) {
          continue;
        }
        const laneRoad: Road = {
          id: localSpokeRoadId(village.id, laneIndex),
          type: "local",
          width: this.config.roads.localWidth,
          points: line,
          fromVillageId: village.id,
          toVillageId: village.id
        };
        roads.push(laneRoad);
        existingRoads.push(laneRoad);
        laneIndex += 1;
      }

      const crossOffsets = village.radius > 92 ? [-0.45, 0.45] : [0];
      for (let i = 0; i < crossOffsets.length; i += 1) {
        const crossRoll = hashToUnit(hashCoords(localSeed, i, 0, 541));
        if (crossOffsets.length > 1 && crossRoll < 0.22) {
          continue;
        }
        const line = this.createStreetLine(
          village.x,
          village.y,
          perpX,
          perpY,
          axisX,
          axisY,
          village.radius * lerp(0.95, 1.45, crossRoll),
          crossOffsets[i] * spacing * 1.2,
          crossRoll
        );
        if (!this.isRoadLineValid(line) || !this.isRoadLineDistinct(line, existingRoads, duplicateThreshold)) {
          continue;
        }
        const branchRoad: Road = {
          id: localBranchRoadId(village.id, i, 0),
          type: "local",
          width: this.config.roads.localWidth * 0.92,
          points: line,
          fromVillageId: village.id,
          toVillageId: village.id
        };
        roads.push(branchRoad);
        existingRoads.push(branchRoad);
      }
    }

    return roads;
  }

  private estimateVillageAxis(village: Village, regionalRoads: Road[], localSeed: number): number {
    const nearest = this.nearestRegionalRoadToVillage(village, regionalRoads);
    if (nearest) {
      return Math.atan2(nearest.tangentY, nearest.tangentX);
    }
    return hashToUnit(hashCoords(localSeed, village.cellX, village.cellY, 83)) * Math.PI * 2;
  }

  private nearestRegionalRoadToVillage(
    village: Village,
    regionalRoads: Road[]
  ): { distance: number; tangentX: number; tangentY: number; pointX: number; pointY: number } | null {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestTangentX = 1;
    let bestTangentY = 0;
    let bestPointX = village.x;
    let bestPointY = village.y;

    for (const road of regionalRoads) {
      if (road.points.length < 2) {
        continue;
      }
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const closest = this.closestPointOnSegment(village.x, village.y, a.x, a.y, b.x, b.y);
        if (closest.distance >= bestDistance) {
          continue;
        }
        bestDistance = closest.distance;
        bestPointX = closest.x;
        bestPointY = closest.y;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length > 1e-6) {
          bestTangentX = dx / length;
          bestTangentY = dy / length;
        }
      }
    }

    if (!Number.isFinite(bestDistance)) {
      return null;
    }
    return {
      distance: bestDistance,
      tangentX: bestTangentX,
      tangentY: bestTangentY,
      pointX: bestPointX,
      pointY: bestPointY
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

    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 1; i < points.length - 1; i += 1) {
        const probe = this.terrain.sample(points[i].x, points[i].y);
        if (probe.waterDepth <= 0.003) {
          continue;
        }
        const gradient = this.terrain.gradientAt(points[i].x, points[i].y, 5);
        const magnitude = Math.hypot(gradient.x, gradient.y);
        if (magnitude < 0.0001) {
          continue;
        }
        const push = 10 + probe.waterDepth * 95;
        points[i].x += (gradient.x / magnitude) * push;
        points[i].y += (gradient.y / magnitude) * push;
      }
    }

    points[0] = { x: a.x, y: a.y };
    points[points.length - 1] = { x: b.x, y: b.y };
    return points;
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

import { clamp, lerp } from "../../util/math";
import { WorldConfig } from "../config";
import { hashCoords, hashString, hashToUnit } from "../hash";
import { TerrainSampler } from "../terrain";
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
        const id = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
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
        id: `r-${edge.id}`,
        type,
        width,
        points: this.routeRoad(edge.a, edge.b, edge.id),
        fromVillageId: edge.a.id,
        toVillageId: edge.b.id
      });
    }

    return roads;
  }

  buildLocalRoadNetwork(villages: Village[]): Road[] {
    const roads: Road[] = [];

    for (const village of villages) {
      const localSeed = hashString(`${this.config.seed}:local-road:${village.id}`);
      const spokeCount = 4 + Math.floor(hashToUnit(hashCoords(localSeed, village.cellX, village.cellY, 71)) * 3);
      const baseAngle = hashToUnit(hashCoords(localSeed, village.cellX, village.cellY, 83)) * Math.PI * 2;
      const spokeEndpoints: { x: number; y: number; angle: number }[] = [];

      for (let spoke = 0; spoke < spokeCount; spoke += 1) {
        const angleJitter = (hashToUnit(hashCoords(localSeed, spoke, 0, 97)) * 2 - 1) * 0.42;
        const angle = baseAngle + (spoke / spokeCount) * Math.PI * 2 + angleJitter;
        const length = village.radius * lerp(1.45, 2.45, hashToUnit(hashCoords(localSeed, spoke, 0, 101)));
        const segments = 4 + Math.floor(hashToUnit(hashCoords(localSeed, spoke, 0, 109)) * 3);
        const points: { x: number; y: number }[] = [];

        for (let i = 0; i <= segments; i += 1) {
          const t = i / segments;
          const wobble = Math.sin(t * Math.PI) * (hashToUnit(hashCoords(localSeed, spoke, i, 131)) * 2 - 1) * 18;
          points.push({
            x: village.x + Math.cos(angle) * length * t + Math.cos(angle + Math.PI * 0.5) * wobble,
            y: village.y + Math.sin(angle) * length * t + Math.sin(angle + Math.PI * 0.5) * wobble
          });
        }

        points[0] = { x: village.x, y: village.y };
        this.smoothLine(points, 1);
        if (!this.isRoadLineValid(points)) {
          continue;
        }

        roads.push({
          id: `rl-${village.id}-${spoke}`,
          type: "local",
          width: this.config.roads.localWidth,
          points,
          fromVillageId: village.id,
          toVillageId: village.id
        });

        const end = points[points.length - 1];
        spokeEndpoints.push({ x: end.x, y: end.y, angle });

        const sideStreetCount = 1 + Math.floor(hashToUnit(hashCoords(localSeed, spoke, 0, 149)) * 2);
        for (let branchIndex = 0; branchIndex < sideStreetCount; branchIndex += 1) {
          const t = lerp(0.35, 0.88, hashToUnit(hashCoords(localSeed, spoke, branchIndex, 157)));
          const centerX = lerp(village.x, end.x, t);
          const centerY = lerp(village.y, end.y, t);
          const branchLen = village.radius * lerp(0.55, 1.15, hashToUnit(hashCoords(localSeed, spoke, branchIndex, 163)));
          const sideSign = hashToUnit(hashCoords(localSeed, spoke, branchIndex, 167)) > 0.5 ? 1 : -1;
          const perpAngle = angle + sideSign * Math.PI * 0.5;
          const branchSegments = 3 + Math.floor(hashToUnit(hashCoords(localSeed, spoke, branchIndex, 173)) * 2);
          const branchPoints: { x: number; y: number }[] = [{ x: centerX, y: centerY }];

          for (let s = 1; s <= branchSegments; s += 1) {
            const bt = s / branchSegments;
            const drift = (hashToUnit(hashCoords(localSeed, spoke, branchIndex * 13 + s, 179)) * 2 - 1) * 9 * bt;
            branchPoints.push({
              x: centerX + Math.cos(perpAngle) * branchLen * bt + Math.cos(angle) * drift,
              y: centerY + Math.sin(perpAngle) * branchLen * bt + Math.sin(angle) * drift
            });
          }

          if (!this.isRoadLineValid(branchPoints)) {
            continue;
          }

          roads.push({
            id: `rlb-${village.id}-${spoke}-${branchIndex}`,
            type: "local",
            width: this.config.roads.localWidth * 0.9,
            points: branchPoints,
            fromVillageId: village.id,
            toVillageId: village.id
          });
        }
      }

      if (spokeEndpoints.length >= 4) {
        spokeEndpoints.sort((a, b) => a.angle - b.angle);
        const loopPoints: { x: number; y: number }[] = [];
        for (let i = 0; i < spokeEndpoints.length; i += 1) {
          const endpoint = spokeEndpoints[i];
          const t = hashToUnit(hashCoords(localSeed, i, spokeEndpoints.length, 191));
          loopPoints.push({
            x: lerp(village.x, endpoint.x, 0.72 + t * 0.2),
            y: lerp(village.y, endpoint.y, 0.72 + t * 0.2)
          });
        }
        loopPoints.push(loopPoints[0]);
        if (this.isRoadLineValid(loopPoints)) {
          roads.push({
            id: `rlloop-${village.id}`,
            type: "local",
            width: this.config.roads.localWidth,
            points: loopPoints,
            fromVillageId: village.id,
            toVillageId: village.id
          });
        }
      }
    }

    return roads;
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


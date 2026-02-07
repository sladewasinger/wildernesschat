import { WorldConfig } from "../../gen/config";
import { SettlementFeatures, Village } from "../../gen/settlements";
import { TerrainSampler } from "../../gen/terrain";
import { clamp, smoothstep } from "../../util/math";

type NearestVillageInfo = {
  distance: number;
  radius: number;
};

const cacheCellSize = 12;

const blend = {
  field: {
    base: 0.21,
    ringWeight: 0.56,
    roadWeight: 0.24,
    moistureWeight: 0.14,
    forestPenaltyWeight: 0.5,
    shorePenaltyWeight: 0.15,
    slopePenaltyWeight: 0.31,
    roadStart: 16
  },
  forest: {
    villagePenaltyWeight: 0.62,
    roadPenaltyWeight: 0.52,
    fieldPressureWeight: 0.58,
    shorePenaltyWeight: 0.24,
    moistureWeight: 0.05,
    roadStart: 14
  }
} as const;

export class LandUseBlender {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly features: SettlementFeatures;
  private readonly roadDistanceCache = new Map<string, number>();
  private readonly villageDistanceCache = new Map<string, NearestVillageInfo>();

  constructor(config: WorldConfig, terrain: TerrainSampler, features: SettlementFeatures) {
    this.config = config;
    this.terrain = terrain;
    this.features = features;
  }

  fieldSuitabilityForVillage(x: number, y: number, village: Village): number {
    const probe = this.terrain.probe(x, y);
    if (probe.waterDepth > 0.001 || probe.slope > 0.36) {
      return 0;
    }

    const villageDistance = Math.hypot(x - village.x, y - village.y);
    const ringCenter = village.radius * 1.7;
    const ringHalfWidth = Math.max(village.radius * 0.85, 1);
    const ringFactor = clamp(1 - Math.abs(villageDistance - ringCenter) / ringHalfWidth, 0, 1);

    const roadDistance = this.nearestRoadDistance(x, y);
    const roadAffinityMax = Math.max(this.config.settlement.minVillageDistance * 0.5, 92);
    const roadAffinity = Number.isFinite(roadDistance)
      ? 1 - smoothstep(blend.field.roadStart, roadAffinityMax, roadDistance)
      : 0;

    const forestPenalty = smoothstep(0.55, 0.84, probe.forestDensity);
    const shorePenalty = smoothstep(0.6, 0.96, probe.shore);
    const moistureBonus = smoothstep(0.28, 0.76, probe.moisture);

    return clamp(
      blend.field.base +
        ringFactor * blend.field.ringWeight +
        roadAffinity * blend.field.roadWeight +
        moistureBonus * blend.field.moistureWeight -
        forestPenalty * blend.field.forestPenaltyWeight -
        shorePenalty * blend.field.shorePenaltyWeight -
        probe.slope * blend.field.slopePenaltyWeight,
      0,
      1
    );
  }

  forestSuitability(x: number, y: number, baseDensity: number): number {
    if (baseDensity <= 0) {
      return 0;
    }

    const probe = this.terrain.probe(x, y);
    if (probe.waterDepth > 0.012) {
      return 0;
    }

    const nearestVillage = this.nearestVillageInfo(x, y);
    const roadDistance = this.nearestRoadDistance(x, y);

    const villagePenaltyStart = Math.max(this.config.settlement.minVillageDistance * 0.22, 55);
    const villagePenaltyEnd = Math.max(this.config.settlement.minVillageDistance * 1.05, villagePenaltyStart + 80);
    const villagePenalty =
      Number.isFinite(nearestVillage.distance) ? 1 - smoothstep(villagePenaltyStart, villagePenaltyEnd, nearestVillage.distance) : 0;

    const roadPenaltyEnd = Math.max(this.config.settlement.minVillageDistance * 0.34, 96);
    const roadPenalty = Number.isFinite(roadDistance)
      ? 1 - smoothstep(blend.forest.roadStart, roadPenaltyEnd, roadDistance)
      : 0;
    const shorePenalty = smoothstep(0.58, 0.97, probe.shore) * blend.forest.shorePenaltyWeight;
    const fieldPressure = this.fieldPressure(nearestVillage, roadDistance);

    const density =
      baseDensity *
        (1 -
          villagePenalty * blend.forest.villagePenaltyWeight -
          roadPenalty * blend.forest.roadPenaltyWeight -
          fieldPressure * blend.forest.fieldPressureWeight) *
        (1 - shorePenalty) +
      probe.moisture * blend.forest.moistureWeight;

    return clamp(density, 0, 1);
  }

  private fieldPressure(nearestVillage: NearestVillageInfo, roadDistance: number): number {
    if (!Number.isFinite(nearestVillage.distance) || nearestVillage.radius <= 0 || !Number.isFinite(roadDistance)) {
      return 0;
    }

    const inner = nearestVillage.radius * 0.96;
    const outer = nearestVillage.radius * 2.55;
    if (nearestVillage.distance < inner || nearestVillage.distance > outer) {
      return 0;
    }

    const bandCenter = (inner + outer) * 0.5;
    const bandHalf = Math.max((outer - inner) * 0.5, 1);
    const bandFactor = clamp(1 - Math.abs(nearestVillage.distance - bandCenter) / bandHalf, 0, 1);
    const roadFactor = 1 - smoothstep(22, Math.max(this.config.settlement.minVillageDistance * 0.44, 140), roadDistance);
    return clamp(bandFactor * roadFactor, 0, 1);
  }

  private nearestVillageInfo(x: number, y: number): NearestVillageInfo {
    const key = this.cacheKey(x, y);
    const cached = this.villageDistanceCache.get(key);
    if (cached) {
      return cached;
    }

    let bestDistance = Number.POSITIVE_INFINITY;
    let bestRadius = 0;

    for (const village of this.features.villages) {
      const distance = Math.hypot(x - village.x, y - village.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRadius = village.radius;
      }
    }

    const info = { distance: bestDistance, radius: bestRadius };
    this.villageDistanceCache.set(key, info);
    return info;
  }

  private nearestRoadDistance(x: number, y: number): number {
    const key = this.cacheKey(x, y);
    const cached = this.roadDistanceCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let best = Number.POSITIVE_INFINITY;

    for (const road of this.features.roads) {
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const distance = this.distanceToSegment(x, y, a.x, a.y, b.x, b.y) - road.width;
        if (distance < best) {
          best = distance;
        }
      }
    }

    this.roadDistanceCache.set(key, best);
    return best;
  }

  private distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
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
  }

  private cacheKey(x: number, y: number): string {
    return `${Math.floor(x / cacheCellSize)},${Math.floor(y / cacheCellSize)}`;
  }
}

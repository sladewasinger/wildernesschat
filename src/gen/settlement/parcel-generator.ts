import { lerp } from "../../util/math";
import { WorldConfig } from "../config";
import { hashCoords, hashString, hashToUnit } from "../hash";
import { TerrainSampler } from "../terrain";
import { parcelIdForRoadPosition } from "./stable-ids";
import { Parcel, Road, Village } from "./types";

export class ParcelGenerator {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly parcelSeed: number;

  constructor(config: WorldConfig, terrain: TerrainSampler, parcelSeed: number) {
    this.config = config;
    this.terrain = terrain;
    this.parcelSeed = parcelSeed;
  }

  generateParcels(roads: Road[], villages: Village[]): Parcel[] {
    const parcels: Parcel[] = [];
    const villageById = new Map<string, Village>();
    const villageParcelCount = new Map<string, number>();
    const minSeparation = 11;

    for (const village of villages) {
      villageById.set(village.id, village);
      villageParcelCount.set(village.id, 0);
    }

    for (const road of roads) {
      const spacingMultiplier = road.type === "major" ? 1.6 : road.type === "minor" ? 1.25 : 1;
      const spacing = this.config.houses.spacing * spacingMultiplier;

      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length < spacing * 0.65) {
          continue;
        }

        const tangentX = dx / length;
        const tangentY = dy / length;
        const normalX = -tangentY;
        const normalY = tangentX;
        const count = Math.floor(length / spacing);

        for (let step = 1; step < count; step += 1) {
          const t = step / count;
          const baseX = lerp(a.x, b.x, t);
          const baseY = lerp(a.y, b.y, t);
          const village = this.pickVillageForRoadPosition(road, t, villageById);
          if (!village) {
            continue;
          }

          if (!this.shouldKeepForVillageDensity(road, baseX, baseY, village)) {
            continue;
          }

          for (const side of [-1, 1] as const) {
            const localHash = hashString(`${road.id}:${i}:${step}:${side}`);
            if (!this.shouldSpawnParcel(localHash, road.type)) {
              continue;
            }

            const currentCount = villageParcelCount.get(village.id) ?? 0;
            if (currentCount >= 140) {
              continue;
            }

            const widthRoll = hashToUnit(hashCoords(this.parcelSeed ^ localHash, i, step, 43));
            const depthRoll = hashToUnit(hashCoords(this.parcelSeed ^ localHash, i, step, 47));
            const setbackRoll = hashToUnit(hashCoords(this.parcelSeed ^ localHash, i, step, 53));
            const width = lerp(this.config.houses.minWidth * 1.1, this.config.houses.maxWidth * 1.5, widthRoll);
            const depth = lerp(this.config.houses.minDepth * 1.5, this.config.houses.maxDepth * 2, depthRoll);
            const setback = lerp(this.config.houses.minSetback, this.config.houses.maxSetback, setbackRoll) + road.width * 0.5;
            const x = baseX + normalX * side * (setback + depth * 0.5);
            const y = baseY + normalY * side * (setback + depth * 0.5);
            const probe = this.terrain.probe(x, y);
            if (probe.waterDepth > 0.002 || probe.slope > this.config.houses.maxSlope) {
              continue;
            }

            const fits = parcels.every((parcel) => {
              const px = parcel.x - x;
              const py = parcel.y - y;
              return Math.hypot(px, py) >= minSeparation;
            });
            if (!fits) {
              continue;
            }

            parcels.push({
              id: parcelIdForRoadPosition(road.id, i, step, side),
              villageId: village.id,
              roadId: road.id,
              roadType: road.type,
              x,
              y,
              width,
              depth,
              angle: Math.atan2(tangentY, tangentX),
              side
            });
            villageParcelCount.set(village.id, currentCount + 1);
          }
        }
      }
    }

    return parcels;
  }

  private shouldSpawnParcel(localHash: number, roadType: Road["type"]): boolean {
    const roll = hashToUnit(hashCoords(this.parcelSeed ^ localHash, 3, 7, 61));
    const chance =
      roadType === "major"
        ? this.config.houses.sideChance * 0.25
        : roadType === "minor"
          ? this.config.houses.sideChance * 0.58
          : this.config.houses.sideChance * 0.95;
    return roll <= chance;
  }

  private shouldKeepForVillageDensity(road: Road, x: number, y: number, village: Village): boolean {
    if (road.type === "local") {
      return true;
    }
    const distance = Math.hypot(x - village.x, y - village.y);
    const range = road.type === "minor" ? village.radius * 2.8 : village.radius * 2.1;
    return distance <= range;
  }

  private pickVillageForRoadPosition(
    road: Road,
    t: number,
    villageById: Map<string, Village>
  ): Village | null {
    const start = villageById.get(road.fromVillageId);
    const end = villageById.get(road.toVillageId);
    if (road.fromVillageId === road.toVillageId) {
      return start ?? null;
    }
    if (t < 0.5) {
      return start ?? end ?? null;
    }
    return end ?? start ?? null;
  }
}

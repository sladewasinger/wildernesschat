import { WorldConfig } from "../config";
import { SettlementLayoutBuilder } from "../layout/settlement-layout-builder";
import { hashString } from "../hash";
import { TerrainSampler } from "../terrain";
import { pointInRect, regionKey, roadIntersectsBounds } from "./geometry";
import { HouseGenerator } from "./house-generator";
import { ParcelGenerator } from "./parcel-generator";
import { RoadGenerator } from "./road-generator";
import { SettlementFeatures, SettlementLayout } from "./types";
import { VillageGenerator } from "./village-generator";

type RegionFeatures = SettlementLayout;

export class SettlementSystem {
  private readonly config: WorldConfig;
  private readonly villageGenerator: VillageGenerator;
  private readonly roadGenerator: RoadGenerator;
  private readonly parcelGenerator: ParcelGenerator;
  private readonly houseGenerator: HouseGenerator;
  private readonly layoutBuilder: SettlementLayoutBuilder;
  private readonly regionCache = new Map<string, RegionFeatures>();
  private readonly maxCachedRegions = 220;

  constructor(config: WorldConfig, terrain: TerrainSampler) {
    this.config = config;
    const villageSeed = hashString(`${config.seed}:villages`);
    const roadSeed = hashString(`${config.seed}:roads`);
    const parcelSeed = hashString(`${config.seed}:parcels`);
    const houseSeed = hashString(`${config.seed}:houses`);

    this.villageGenerator = new VillageGenerator(config, terrain, villageSeed);
    this.roadGenerator = new RoadGenerator(config, terrain, roadSeed);
    this.parcelGenerator = new ParcelGenerator(config, terrain, parcelSeed);
    this.houseGenerator = new HouseGenerator(config, terrain, houseSeed);
    this.layoutBuilder = new SettlementLayoutBuilder(
      config,
      terrain,
      this.villageGenerator,
      this.roadGenerator,
      this.parcelGenerator,
      this.houseGenerator
    );
  }

  getFeaturesForBounds(minX: number, maxX: number, minY: number, maxY: number): SettlementFeatures {
    const regionSize = this.config.roads.regionSize;
    const minRegionX = Math.floor(minX / regionSize) - 1;
    const maxRegionX = Math.floor(maxX / regionSize) + 1;
    const minRegionY = Math.floor(minY / regionSize) - 1;
    const maxRegionY = Math.floor(maxY / regionSize) + 1;

    const villagesById = new Map<string, SettlementFeatures["villages"][number]>();
    const roadsById = new Map<string, SettlementFeatures["roads"][number]>();
    const parcelsById = new Map<string, SettlementFeatures["parcels"][number]>();
    const housesById = new Map<string, SettlementFeatures["houses"][number]>();

    for (let regionY = minRegionY; regionY <= maxRegionY; regionY += 1) {
      for (let regionX = minRegionX; regionX <= maxRegionX; regionX += 1) {
        const region = this.getRegion(regionX, regionY);

        for (const village of region.villages) {
          if (pointInRect(village.x, village.y, minX, maxX, minY, maxY)) {
            villagesById.set(village.id, village);
          }
        }
        for (const road of region.roads) {
          if (roadIntersectsBounds(road, minX, maxX, minY, maxY)) {
            roadsById.set(road.id, road);
          }
        }
        for (const parcel of region.parcels) {
          if (pointInRect(parcel.x, parcel.y, minX, maxX, minY, maxY)) {
            parcelsById.set(parcel.id, parcel);
          }
        }
        for (const house of region.houses) {
          if (pointInRect(house.x, house.y, minX, maxX, minY, maxY)) {
            housesById.set(house.id, house);
          }
        }
      }
    }

    return {
      villages: Array.from(villagesById.values()),
      roads: Array.from(roadsById.values()),
      parcels: Array.from(parcelsById.values()),
      houses: Array.from(housesById.values())
    };
  }

  clear(): void {
    this.regionCache.clear();
    this.villageGenerator.clear();
  }

  private getRegion(regionX: number, regionY: number): RegionFeatures {
    const key = regionKey(regionX, regionY);
    const cached = this.regionCache.get(key);
    if (cached) {
      return cached;
    }

    const generated = this.generateRegion(regionX, regionY);
    this.regionCache.set(key, generated);
    this.pruneRegionCache();
    return generated;
  }

  private generateRegion(regionX: number, regionY: number): RegionFeatures {
    return this.layoutBuilder.buildRegionLayout(regionX, regionY);
  }

  private pruneRegionCache(): void {
    if (this.regionCache.size <= this.maxCachedRegions) {
      return;
    }
    const overflow = this.regionCache.size - this.maxCachedRegions;
    const keys = this.regionCache.keys();
    for (let i = 0; i < overflow; i += 1) {
      const next = keys.next();
      if (next.done) {
        break;
      }
      this.regionCache.delete(next.value);
    }
  }
}

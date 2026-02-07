import { lerp } from "../../util/math";
import { WorldConfig } from "../config";
import { hashCoords, hashString, hashToUnit } from "../hash";
import { TerrainSampler } from "../terrain";
import { houseIdForParcel } from "./stable-ids";
import { House, Parcel } from "./types";

export class HouseGenerator {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly houseSeed: number;

  constructor(config: WorldConfig, terrain: TerrainSampler, houseSeed: number) {
    this.config = config;
    this.terrain = terrain;
    this.houseSeed = houseSeed;
  }

  generateHouses(parcels: Parcel[]): House[] {
    const houses: House[] = [];

    for (const parcel of parcels) {
      const localSeed = this.houseSeed ^ hashString(parcel.id);
      if (!this.shouldPlaceHouse(parcel, localSeed)) {
        continue;
      }

      const width = parcel.width * lerp(0.62, 0.9, hashToUnit(hashCoords(localSeed, 2, 3, 79)));
      const depth = parcel.depth * lerp(0.5, 0.84, hashToUnit(hashCoords(localSeed, 3, 2, 83)));
      const roadFacingOffset = (parcel.depth - depth) * 0.35;
      const normalX = Math.cos(parcel.angle + Math.PI * 0.5);
      const normalY = Math.sin(parcel.angle + Math.PI * 0.5);
      const x = parcel.x - normalX * parcel.side * roadFacingOffset;
      const y = parcel.y - normalY * parcel.side * roadFacingOffset;
      const probe = this.terrain.probe(x, y);
      if (probe.waterDepth > 0.001 || probe.slope > this.config.houses.maxSlope) {
        continue;
      }

      const angleJitter = (hashToUnit(hashCoords(localSeed, 5, 1, 89)) * 2 - 1) * 0.08;
      const roofStyle = Math.floor(hashToUnit(hashCoords(localSeed, 7, 11, 97)) * 4);

      houses.push({
        id: houseIdForParcel(parcel.id),
        x,
        y,
        width,
        depth,
        angle: parcel.angle + angleJitter,
        roofStyle
      });
    }

    return houses;
  }

  private shouldPlaceHouse(parcel: Parcel, localSeed: number): boolean {
    const roll = hashToUnit(hashCoords(localSeed, 1, 1, 67));
    const chance =
      parcel.roadType === "major"
        ? 0.46
        : parcel.roadType === "minor"
          ? 0.72
          : 0.88;
    return roll <= chance;
  }
}

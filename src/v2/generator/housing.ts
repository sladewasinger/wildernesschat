import { clamp, lerp } from "../../util/math";
import { hashCoords, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, Point, RoadSegment, VillageSite } from "../types";
import { distanceToRoadsExcludingRoad, distanceToSegment, sampleRoad } from "./geometry";

export type AnchorPlacement = {
  house: House;
  driveRoad: RoadSegment;
};

type GrowHousesAlongRoadParams = {
  site: VillageSite;
  road: RoadSegment;
  slotCount: number;
  roads: RoadSegment[];
  houses: House[];
  seed: number;
  threshold: number;
  terrain: V2TerrainSampler;
};

export const buildAnchorPlacement = (site: VillageSite, trunk: RoadSegment, planSeed: number): AnchorPlacement => {
  const sample = sampleRoad(trunk.points, 0.52);
  const side: -1 | 1 = hashToUnit(hashCoords(planSeed, site.cellX, site.cellY, 89)) < 0.5 ? -1 : 1;
  const normalX = -sample.tangentY;
  const normalY = sample.tangentX;
  const offset = trunk.width * 0.5 + V2_SETTLEMENT_CONFIG.housing.houseSetbackMin + 2;
  const x = sample.x + normalX * side * offset;
  const y = sample.y + normalY * side * offset;
  const width = lerp(12, 18, hashToUnit(hashCoords(planSeed, site.cellX, site.cellY, 97))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
  const depth = lerp(8, 13, hashToUnit(hashCoords(planSeed, site.cellX, site.cellY, 101))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
  const angle =
    Math.atan2(sample.tangentY, sample.tangentX) + (hashToUnit(hashCoords(planSeed, site.cellX, site.cellY, 103)) * 2 - 1) * 0.07;

  const house: House = {
    id: `ha-${site.id}`,
    x,
    y,
    width,
    depth,
    angle,
    tone: hashToUnit(hashCoords(planSeed, site.cellX, site.cellY, 107))
  };
  const frontX = house.x - normalX * side * depth * 0.45;
  const frontY = house.y - normalY * side * depth * 0.45;
  const driveRoad: RoadSegment = {
    id: `rda-${site.id}`,
    className: "drive",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points: [
      { x: frontX, y: frontY },
      {
        x: lerp(frontX, sample.x, 0.56),
        y: lerp(frontY, sample.y, 0.56)
      },
      { x: sample.x, y: sample.y }
    ]
  };

  return { house, driveRoad };
};

export const growHousesAlongRoad = ({
  site,
  road,
  slotCount,
  roads,
  houses,
  seed,
  threshold,
  terrain
}: GrowHousesAlongRoadParams): void => {
  for (let slot = 1; slot < slotCount; slot += 1) {
    const t = slot / slotCount;
    if (Math.abs(t - 0.5) < 0.1) {
      continue;
    }
    const sample = sampleRoad(road.points, t);
    for (const side of [-1, 1] as const) {
      const localHash = hashCoords(seed, slot, side, 137);
      const jitter = hashToUnit(hashCoords(localHash, 2, 3, 139));
      const normalX = -sample.tangentY;
      const normalY = sample.tangentX;
      const offset =
        road.width * 0.5 + lerp(V2_SETTLEMENT_CONFIG.housing.houseSetbackMin, V2_SETTLEMENT_CONFIG.housing.houseSetbackMax, jitter);
      const x = sample.x + normalX * side * offset;
      const y = sample.y + normalY * side * offset;
      const slope = terrain.slopeAt(x, y);
      if (slope > 0.095) {
        continue;
      }

      const elevation = terrain.elevationAt(x, y);
      const centerPull = 1 - Math.abs(t - 0.5) * 1.25;
      const desirability =
        site.score * 0.46 +
        (1 - clamp(slope / 0.09, 0, 1)) * 0.34 +
        (1 - clamp(Math.abs(elevation - 0.52) / 0.33, 0, 1)) * 0.2 +
        centerPull * 0.14 +
        (hashToUnit(hashCoords(localHash, 5, 7, 149)) - 0.5) * 0.18;
      if (desirability < threshold) {
        continue;
      }

      const width = lerp(10, 18, hashToUnit(hashCoords(localHash, 11, 13, 151))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
      const depth = lerp(7, 13, hashToUnit(hashCoords(localHash, 17, 19, 157))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
      const angle = Math.atan2(sample.tangentY, sample.tangentX) + (hashToUnit(hashCoords(localHash, 23, 29, 163)) * 2 - 1) * 0.09;
      const house: House = {
        id: `h-${site.id}-${road.id}-${slot}-${side}`,
        x,
        y,
        width,
        depth,
        angle,
        tone: hashToUnit(hashCoords(localHash, 31, 37, 167))
      };
      const roadClearance = Math.max(V2_SETTLEMENT_CONFIG.housing.houseRoadClearance, Math.max(width, depth) * 0.88);
      if (distanceToRoadsExcludingRoad(x, y, roads, road.id) < roadClearance) {
        continue;
      }
      if (!canPlaceHouse(house, houses)) {
        continue;
      }

      houses.push(house);
      const frontX = house.x - normalX * side * depth * 0.45;
      const frontY = house.y - normalY * side * depth * 0.45;
      roads.push({
        id: `rd-${house.id}`,
        className: "drive",
        width: V2_SETTLEMENT_CONFIG.roads.width,
        points: [
          { x: frontX, y: frontY },
          {
            x: lerp(frontX, sample.x, 0.55),
            y: lerp(frontY, sample.y, 0.55)
          },
          { x: sample.x, y: sample.y }
        ]
      });
    }
  }
};

export const canPlaceHouse = (house: House, existing: House[]): boolean => {
  const houseRadius = Math.hypot(house.width, house.depth) * 0.6;
  for (const other of existing) {
    const otherRadius = Math.hypot(other.width, other.depth) * 0.6;
    if (
      Math.hypot(house.x - other.x, house.y - other.y) <
      houseRadius + otherRadius + V2_SETTLEMENT_CONFIG.housing.houseSpacingPadding
    ) {
      return false;
    }
  }
  return true;
};

export const isRoadNearHouses = (points: Point[], houses: House[], clearance: number): boolean => {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    for (const house of houses) {
      const houseRadius = Math.hypot(house.width, house.depth) * 0.58;
      const distance = distanceToSegment(house.x, house.y, a.x, a.y, b.x, b.y);
      if (distance < houseRadius + clearance) {
        return true;
      }
    }
  }
  return false;
};

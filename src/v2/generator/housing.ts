import { clamp, lerp } from "../../util/math";
import { hashCoords, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { V2TerrainSampler } from "../terrain";
import { House, Point, RoadSegment, VillageSite } from "../types";
import { distanceToRoadsExcludingRoad, distanceToSegment, polylineLength, sampleRoad } from "./geometry";

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

type FinalizeTrunkTerminationParams = {
  site: VillageSite;
  trunk: RoadSegment;
  roads: RoadSegment[];
  houses: House[];
  seed: number;
  terrain: V2TerrainSampler;
};

export const finalizeTrunkTermination = ({
  site,
  trunk,
  roads,
  houses,
  seed,
  terrain
}: FinalizeTrunkTerminationParams): void => {
  if (trunk.points.length < 2) {
    return;
  }

  const trunkLength = polylineLength(trunk.points);
  if (trunkLength <= 1e-6) {
    return;
  }

  const attachments = collectDriveAttachmentTsOnRoad(trunk, roads);
  const startAttach = attachments.find((t) => t <= 0.5) ?? null;
  const endAttach = [...attachments].reverse().find((t) => t >= 0.5) ?? null;
  const maxStubDistance = 40;

  let startTrimT = 0;
  let endTrimT = 1;

  const startStubDistance = startAttach === null ? Number.POSITIVE_INFINITY : startAttach * trunkLength;
  if (startStubDistance > maxStubDistance) {
    const preferEndcap = chooseEndcapMode(seed, site, "start");
    let created = false;
    if (preferEndcap || startAttach === null) {
      created = tryAddEndcapHouse({
        site,
        side: "start",
        trunk,
        roads,
        houses,
        seed,
        terrain
      });
    }
    if (!created && startAttach !== null) {
      startTrimT = Math.max(startTrimT, startAttach);
    }
  }

  const endStubDistance = endAttach === null ? Number.POSITIVE_INFINITY : (1 - endAttach) * trunkLength;
  if (endStubDistance > maxStubDistance) {
    const preferEndcap = chooseEndcapMode(seed, site, "end");
    let created = false;
    if (preferEndcap || endAttach === null) {
      created = tryAddEndcapHouse({
        site,
        side: "end",
        trunk,
        roads,
        houses,
        seed,
        terrain
      });
    }
    if (!created && endAttach !== null) {
      endTrimT = Math.min(endTrimT, endAttach);
    }
  }

  if (startTrimT <= 1e-4 && endTrimT >= 1 - 1e-4) {
    return;
  }

  if (endTrimT - startTrimT < 0.16) {
    return;
  }

  trunk.points = sliceRoadPointsByT(trunk.points, startTrimT, endTrimT);
};

const chooseEndcapMode = (seed: number, site: VillageSite, side: "start" | "end"): boolean => {
  const sideSalt = side === "start" ? 1979 : 1987;
  const roll = hashToUnit(hashCoords(seed, site.cellX * 131 + 19, site.cellY * 137 + 23, sideSalt));
  return roll < 0.5;
};

const collectDriveAttachmentTsOnRoad = (road: RoadSegment, roads: RoadSegment[]): number[] => {
  const ts: number[] = [];
  const snapDistance = 2.6;

  for (const candidate of roads) {
    if (candidate.className !== "drive" || candidate.points.length < 2) {
      continue;
    }
    let bestT: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const endpointPoints = [candidate.points[0], candidate.points[candidate.points.length - 1]];
    for (const endpoint of endpointPoints) {
      const projected = projectPointToRoadT(road.points, endpoint.x, endpoint.y);
      if (!projected || projected.distance > snapDistance) {
        continue;
      }
      if (projected.distance < bestDistance) {
        bestDistance = projected.distance;
        bestT = projected.t;
      }
    }

    if (bestT === null) {
      continue;
    }

    let duplicate = false;
    for (const existing of ts) {
      if (Math.abs(existing - bestT) <= 0.012) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      ts.push(bestT);
    }
  }

  ts.sort((a, b) => a - b);
  return ts;
};

const projectPointToRoadT = (
  points: Point[],
  px: number,
  py: number
): { t: number; distance: number } | null => {
  const total = polylineLength(points);
  if (total <= 1e-6 || points.length < 2) {
    return null;
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestT = 0;
  let traversed = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLength = Math.hypot(dx, dy);
    if (segLength <= 1e-6) {
      continue;
    }

    const ux = dx / segLength;
    const uy = dy / segLength;
    const proj = clamp((px - a.x) * ux + (py - a.y) * uy, 0, segLength);
    const qx = a.x + ux * proj;
    const qy = a.y + uy * proj;
    const distance = Math.hypot(px - qx, py - qy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = (traversed + proj) / total;
    }
    traversed += segLength;
  }

  return { t: bestT, distance: bestDistance };
};

type AddEndcapHouseParams = {
  site: VillageSite;
  side: "start" | "end";
  trunk: RoadSegment;
  roads: RoadSegment[];
  houses: House[];
  seed: number;
  terrain: V2TerrainSampler;
};

const tryAddEndcapHouse = ({ site, side, trunk, roads, houses, seed, terrain }: AddEndcapHouseParams): boolean => {
  if (trunk.points.length < 2) {
    return false;
  }

  const endpoint = side === "start" ? trunk.points[0] : trunk.points[trunk.points.length - 1];
  const neighbor = side === "start" ? trunk.points[1] : trunk.points[trunk.points.length - 2];
  let tangentX = endpoint.x - neighbor.x;
  let tangentY = endpoint.y - neighbor.y;
  const tangentLength = Math.hypot(tangentX, tangentY);
  if (tangentLength <= 1e-6) {
    return false;
  }
  tangentX /= tangentLength;
  tangentY /= tangentLength;

  const normalX = -tangentY;
  const normalY = tangentX;
  const localHash = hashCoords(seed, site.cellX * 173 + (side === "start" ? 29 : 53), site.cellY * 179 + 31, 2011);
  const houseSide: -1 | 1 = hashToUnit(hashCoords(localHash, 3, 5, 2017)) < 0.5 ? -1 : 1;
  const width = lerp(11, 18, hashToUnit(hashCoords(localHash, 7, 11, 2027))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
  const depth = lerp(8, 13, hashToUnit(hashCoords(localHash, 13, 17, 2039))) * V2_SETTLEMENT_CONFIG.housing.houseScale;
  const setback = lerp(
    V2_SETTLEMENT_CONFIG.housing.houseSetbackMin * 0.92,
    V2_SETTLEMENT_CONFIG.housing.houseSetbackMax * 0.96,
    hashToUnit(hashCoords(localHash, 19, 23, 2053))
  );
  const x = endpoint.x + normalX * houseSide * (trunk.width * 0.5 + setback + depth * 0.46);
  const y = endpoint.y + normalY * houseSide * (trunk.width * 0.5 + setback + depth * 0.46);

  if (terrain.slopeAt(x, y) > 0.095) {
    return false;
  }

  const house: House = {
    id: `he-${site.id}-${side}`,
    x,
    y,
    width,
    depth,
    angle: Math.atan2(tangentY, tangentX) + (hashToUnit(hashCoords(localHash, 29, 31, 2063)) * 2 - 1) * 0.07,
    tone: hashToUnit(hashCoords(localHash, 37, 41, 2081))
  };
  const roadClearance = Math.max(V2_SETTLEMENT_CONFIG.housing.houseRoadClearance, Math.max(width, depth) * 0.88);
  if (distanceToRoadsExcludingRoad(house.x, house.y, roads, trunk.id) < roadClearance) {
    return false;
  }
  if (!canPlaceHouse(house, houses)) {
    return false;
  }

  const frontX = house.x - normalX * houseSide * depth * 0.45;
  const frontY = house.y - normalY * houseSide * depth * 0.45;
  const driveRoad: RoadSegment = {
    id: `rde-${site.id}-${side}`,
    className: "drive",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points: [
      { x: frontX, y: frontY },
      {
        x: lerp(frontX, endpoint.x, 0.58),
        y: lerp(frontY, endpoint.y, 0.58)
      },
      { x: endpoint.x, y: endpoint.y }
    ]
  };

  houses.push(house);
  roads.push(driveRoad);
  return true;
};

const sliceRoadPointsByT = (points: Point[], startT: number, endT: number): Point[] => {
  const total = polylineLength(points);
  if (total <= 1e-6 || points.length < 2) {
    return points;
  }

  const aT = clamp(startT, 0, 0.98);
  const bT = clamp(endT, aT + 0.02, 1);
  if (aT <= 1e-4 && bT >= 1 - 1e-4) {
    return points;
  }

  const start = sampleRoad(points, aT);
  const end = sampleRoad(points, bT);
  const sliced: Point[] = [{ x: start.x, y: start.y }];
  let traversed = 0;

  for (let i = 1; i < points.length; i += 1) {
    const b = points[i];
    const segLength = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const segmentEndT = (traversed + segLength) / total;
    traversed += segLength;
    if (segmentEndT <= aT + 1e-6) {
      continue;
    }
    if (segmentEndT >= bT - 1e-6) {
      break;
    }
    sliced.push({ x: b.x, y: b.y });
  }

  sliced.push({ x: end.x, y: end.y });
  return dedupeConsecutivePoints(sliced);
};

const dedupeConsecutivePoints = (points: Point[]): Point[] => {
  if (points.length <= 1) {
    return points;
  }

  const deduped: Point[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = deduped[deduped.length - 1];
    const next = points[i];
    if (Math.hypot(next.x - prev.x, next.y - prev.y) <= 1e-4) {
      continue;
    }
    deduped.push(next);
  }
  return deduped;
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

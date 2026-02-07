import { hashCoords, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { RoadSegment, VillageSite } from "../types";

export const buildTrunkRoad = (site: VillageSite, planSeed: number): RoadSegment => {
  const dirX = Math.cos(site.angle);
  const dirY = Math.sin(site.angle);
  const normalX = -dirY;
  const normalY = dirX;
  const half = site.trunkLength * 0.5;
  const wobbleRoll = hashToUnit(hashCoords(planSeed, site.cellX, site.cellY, 71));
  const wobble = (wobbleRoll * 2 - 1) * Math.min(22, site.trunkLength * 0.13);
  const start = { x: site.x - dirX * half, y: site.y - dirY * half };
  const end = { x: site.x + dirX * half, y: site.y + dirY * half };
  const mid = { x: site.x + normalX * wobble, y: site.y + normalY * wobble };

  return {
    id: `rt-${site.id}`,
    className: "trunk",
    width: V2_SETTLEMENT_CONFIG.roads.width,
    points: [start, mid, end]
  };
};

export const createDirectionalRoad = (
  id: string,
  className: RoadSegment["className"],
  width: number,
  startX: number,
  startY: number,
  angle: number,
  length: number,
  hash: number
): RoadSegment => {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const normalX = -dirY;
  const normalY = dirX;
  const bend = (hashToUnit(hashCoords(hash, 43, 47, 229)) * 2 - 1) * Math.min(18, length * 0.23);
  const endX = startX + dirX * length;
  const endY = startY + dirY * length;
  const mid = {
    x: startX + dirX * length * 0.52 + normalX * bend,
    y: startY + dirY * length * 0.52 + normalY * bend
  };

  return {
    id,
    className,
    width,
    points: [{ x: startX, y: startY }, mid, { x: endX, y: endY }]
  };
};

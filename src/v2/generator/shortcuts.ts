import { hashCoords, hashString, hashToUnit } from "../../gen/hash";
import { V2_SETTLEMENT_CONFIG } from "../config";
import { House, RoadSegment, VillageSite } from "../types";
import { hasParallelRoadConflict, isRoadUsable } from "./geometry";
import { isRoadNearHouses } from "./housing";
import { V2TerrainSampler } from "../terrain";

type AddShortcutsParams = {
  site: VillageSite;
  roads: RoadSegment[];
  houses: House[];
  terrain: V2TerrainSampler;
  maxCount: number;
  pairChanceThreshold: number;
};

export const addShortcuts = ({ site, roads, houses, terrain, maxCount, pairChanceThreshold }: AddShortcutsParams): number => {
  const shortcuts = V2_SETTLEMENT_CONFIG.stage3.shortcuts;
  const branchEnds = roads
    .filter((road) => road.className === "branch")
    .map((road) => ({
      id: road.id,
      start: road.points[0],
      end: road.points[road.points.length - 1],
      tangentX: (() => {
        const last = road.points[road.points.length - 1];
        const prev = road.points[road.points.length - 2] ?? road.points[0];
        const dx = last.x - prev.x;
        const dy = last.y - prev.y;
        const length = Math.hypot(dx, dy) || 1;
        return dx / length;
      })(),
      tangentY: (() => {
        const last = road.points[road.points.length - 1];
        const prev = road.points[road.points.length - 2] ?? road.points[0];
        const dx = last.x - prev.x;
        const dy = last.y - prev.y;
        const length = Math.hypot(dx, dy) || 1;
        return dy / length;
      })()
    }));

  let added = 0;
  const usedBranchIds = new Set<string>();
  const shortcutMaxCount = Math.max(0, maxCount);
  const minStartDistance = shortcuts.minBranchStartDistance;
  const maxParallelCos = Math.cos((shortcuts.minAngleDeg * Math.PI) / 180);

  for (let i = 0; i < branchEnds.length; i += 1) {
    if (added >= shortcutMaxCount) {
      break;
    }
    for (let j = i + 1; j < branchEnds.length; j += 1) {
      if (added >= shortcutMaxCount) {
        break;
      }
      const a = branchEnds[i];
      const b = branchEnds[j];
      if (usedBranchIds.has(a.id) || usedBranchIds.has(b.id)) {
        continue;
      }
      const dist = Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y);
      if (dist < shortcuts.minSpanDistance || dist > shortcuts.maxSpanDistance) {
        continue;
      }
      if (Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) < minStartDistance) {
        continue;
      }
      const alignment = Math.abs(a.tangentX * b.tangentX + a.tangentY * b.tangentY);
      if (alignment > maxParallelCos) {
        continue;
      }

      const pairHash = hashString(`${site.id}:${a.id}:${b.id}`);
      if (hashToUnit(hashCoords(pairHash, 29, 31, 223)) > pairChanceThreshold) {
        continue;
      }

      const nx = -(b.end.y - a.end.y) / dist;
      const ny = (b.end.x - a.end.x) / dist;
      const bend = (hashToUnit(hashCoords(pairHash, 37, 41, 227)) * 2 - 1) * Math.min(16, dist * 0.2);
      const mid = {
        x: (a.end.x + b.end.x) * 0.5 + nx * bend,
        y: (a.end.y + b.end.y) * 0.5 + ny * bend
      };
      const shortcut: RoadSegment = {
        id: `rs-${site.id}-${i}-${j}`,
        className: "shortcut",
        width: V2_SETTLEMENT_CONFIG.roads.width,
        points: [a.end, mid, b.end]
      };
      if (!isRoadUsable(shortcut.points, roads, V2_SETTLEMENT_CONFIG.roads.branch.minDistance, terrain, { allowLastPointTouch: true })) {
        continue;
      }
      if (hasParallelRoadConflict(shortcut, roads)) {
        continue;
      }
      if (isRoadNearHouses(shortcut.points, houses, shortcuts.houseClearance)) {
        continue;
      }

      roads.push(shortcut);
      usedBranchIds.add(a.id);
      usedBranchIds.add(b.id);
      added += 1;
    }
  }

  return added;
};

import { weightedChoice, Rng } from "../util/random";
import { DIRECTIONS, DIRECTION_OFFSETS, Direction, TileSet } from "./types";

export type CellConstraints = Map<number, Set<number>>;

export type WfcSolveInput = {
  width: number;
  height: number;
  tileSet: TileSet;
  rng: Rng;
  constraints?: CellConstraints;
};

const intersectInto = (target: Set<number>, allowed: Set<number>): boolean => {
  let changed = false;
  for (const value of Array.from(target)) {
    if (!allowed.has(value)) {
      target.delete(value);
      changed = true;
    }
  }
  return changed;
};

const unionAllowed = (options: Set<number>, tileSet: TileSet, direction: Direction): Set<number> => {
  const allowed = new Set<number>();
  for (const tileId of options) {
    const neighbors = tileSet.adjacency.get(tileId)![direction];
    for (const neighbor of neighbors) {
      allowed.add(neighbor);
    }
  }
  return allowed;
};

const propagate = (
  wave: Set<number>[],
  width: number,
  height: number,
  tileSet: TileSet,
  seedIndices: number[]
): boolean => {
  const queue = [...seedIndices];

  while (queue.length > 0) {
    const index = queue.shift()!;
    const x = index % width;
    const y = Math.floor(index / width);
    const sourceOptions = wave[index];

    for (const direction of DIRECTIONS) {
      const offset = DIRECTION_OFFSETS[direction];
      const nx = x + offset.dx;
      const ny = y + offset.dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        continue;
      }
      const neighborIndex = nx + ny * width;
      const neighborOptions = wave[neighborIndex];
      const allowed = unionAllowed(sourceOptions, tileSet, direction);
      const changed = intersectInto(neighborOptions, allowed);

      if (neighborOptions.size === 0) {
        return false;
      }
      if (changed) {
        queue.push(neighborIndex);
      }
    }
  }

  return true;
};

const lowestEntropyCell = (wave: Set<number>[]): number => {
  let bestIndex = -1;
  let bestSize = Number.POSITIVE_INFINITY;
  for (let i = 0; i < wave.length; i += 1) {
    const size = wave[i].size;
    if (size > 1 && size < bestSize) {
      bestSize = size;
      bestIndex = i;
    }
  }
  return bestIndex;
};

export const solveWfc = ({ width, height, tileSet, rng, constraints }: WfcSolveInput): number[] | null => {
  const allOptions = new Set<number>(tileSet.tiles.map((_, index) => index));
  const wave = new Array<Set<number>>(width * height);

  for (let i = 0; i < wave.length; i += 1) {
    wave[i] = new Set(allOptions);
  }

  const constrainedIndices: number[] = [];
  if (constraints) {
    for (const [index, allowed] of constraints.entries()) {
      const cell = wave[index];
      intersectInto(cell, allowed);
      if (cell.size === 0) {
        return null;
      }
      constrainedIndices.push(index);
    }
  }

  if (constrainedIndices.length > 0 && !propagate(wave, width, height, tileSet, constrainedIndices)) {
    return null;
  }

  while (true) {
    const cellIndex = lowestEntropyCell(wave);
    if (cellIndex === -1) {
      break;
    }

    const options = Array.from(wave[cellIndex]);
    const picked = weightedChoice(options, tileSet.weights, rng);
    wave[cellIndex] = new Set([picked]);

    if (!propagate(wave, width, height, tileSet, [cellIndex])) {
      return null;
    }
  }

  return wave.map((cell) => Array.from(cell)[0]);
};

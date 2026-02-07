import { lerp } from "../util/math";
import { hashCoords, hashToUnit } from "./hash";

export type FbmOptions = {
  octaves: number;
  persistence: number;
  lacunarity: number;
};

const fade = (value: number): number => {
  return value * value * (3 - 2 * value);
};

const lattice = (seed: number, x: number, y: number): number => {
  return hashToUnit(hashCoords(seed, x, y));
};

export const valueNoise2D = (seed: number, x: number, y: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const tx = fade(x - x0);
  const ty = fade(y - y0);

  const n00 = lattice(seed, x0, y0);
  const n10 = lattice(seed, x1, y0);
  const n01 = lattice(seed, x0, y1);
  const n11 = lattice(seed, x1, y1);

  const a = lerp(n00, n10, tx);
  const b = lerp(n01, n11, tx);
  return lerp(a, b, ty);
};

export const fbm2D = (seed: number, x: number, y: number, options: FbmOptions): number => {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < options.octaves; i += 1) {
    sum += valueNoise2D(seed + i * 1013, x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= options.persistence;
    frequency *= options.lacunarity;
  }

  return norm > 0 ? sum / norm : 0;
};

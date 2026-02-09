const fnvOffset = 2166136261;
const fnvPrime = 16777619;

export const hashString = (value: string): number => {
  let hash = fnvOffset;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, fnvPrime);
  }
  return hash >>> 0;
};

export const mixUint32 = (value: number): number => {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
};

export const hashCoords = (seed: number, x: number, y: number, salt = 0): number => {
  const a = Math.imul(x | 0, 0x9e3779b1);
  const b = Math.imul(y | 0, 0x85ebca6b);
  const c = Math.imul(salt | 0, 0xc2b2ae35);
  return mixUint32((seed ^ a ^ b ^ c) >>> 0);
};

export const hashToUnit = (value: number): number => {
  return (value >>> 0) / 4294967295;
};

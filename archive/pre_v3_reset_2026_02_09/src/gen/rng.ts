export type Rng = {
  next: () => number;
};

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  if (state === 0) {
    state = 1;
  }

  return {
    next: () => {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
};

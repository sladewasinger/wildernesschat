export type Rng = {
  next: () => number;
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const seededRng = (seed: string): Rng => {
  let state = hashString(seed) || 1;
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

export const weightedChoice = (options: number[], weights: number[], rng: Rng): number => {
  let total = 0;
  for (const option of options) {
    total += weights[option] ?? 1;
  }
  if (total <= 0) {
    return options[0];
  }
  let roll = rng.next() * total;
  for (const option of options) {
    roll -= weights[option] ?? 1;
    if (roll <= 0) {
      return option;
    }
  }
  return options[options.length - 1];
};

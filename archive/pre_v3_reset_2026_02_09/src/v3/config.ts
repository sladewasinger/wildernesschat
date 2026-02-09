export const V3_VIEW_CONFIG = {
  defaultZoom: 1.35,
  minZoom: 0.6,
  maxZoom: 3,
  keyZoomStep: 1.12,
  wheelZoomStep: 1.1,
  moveSpeed: 230,
  terrainWorldStep: 4,
  terrainMinScreenStepPx: 5
} as const;

export const V3_CACHE_CONFIG = {
  sampleQuantize: 3,
  maxCachedSamples: 260000
} as const;

export const V3_WATER_CONFIG = {
  macroWarpFrequency: 0.00034,
  macroWarpAmplitude: 220,
  lakeCellSize: 760,
  lakeCellChance: 0.46,
  lakeJitter: 0.34,
  lakeRadiusMin: 88,
  lakeRadiusMax: 238,
  lakeEdgeFeather: 0.2,
  lakeEdgeNoiseFrequency: 0.00122,
  lakeEdgeNoiseAmplitude: 0.3,
  lakeMaskPower: 1.28,
  riverFrequency: 0.00078,
  riverWarpFrequency: 0.00125,
  riverWarpAmplitude: 140,
  riverDensityFrequency: 0.00042,
  riverDensityLow: 0.5,
  riverDensityHigh: 0.82,
  riverWidthMin: 0.011,
  riverWidthMax: 0.038,
  riverWidthFeather: 0.016,
  riverLakeBoost: 0.52,
  riverLakeReach: 3.4,
  kindThreshold: 0.2,
  waterFillThreshold: 0.03
} as const;

export const V3_RENDER_CONFIG = {
  grassLow: { r: 114, g: 150, b: 85 },
  grassHigh: { r: 146, g: 181, b: 105 },
  coastTint: { r: 188, g: 206, b: 160 },
  lakeShallow: { r: 79, g: 143, b: 191 },
  lakeDeep: { r: 33, g: 79, b: 132 },
  riverShallow: { r: 93, g: 171, b: 209 },
  riverDeep: { r: 41, g: 98, b: 160 },
  contourMinorColor: "rgba(24, 32, 26, 0.38)",
  contourMajorColor: "rgba(17, 24, 19, 0.6)",
  contourMinorWidth: 0.95,
  contourMajorWidth: 1.65,
  contourLevels: [0.25, 0.4, 0.55, 0.7, 0.85],
  contourMajorEvery: 2,
  waterOutlineThreshold: 0.12,
  waterOutlineOuterColor: "rgba(14, 20, 24, 0.95)",
  waterOutlineInnerColor: "rgba(202, 231, 244, 0.84)",
  waterOutlineOuterWidth: 1.9,
  waterOutlineInnerWidth: 1.05
} as const;

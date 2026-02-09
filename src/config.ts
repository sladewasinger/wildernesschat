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

export const V3_CHUNK_CONFIG = {
  worldSize: 768,
  samplePaddingCells: 3,
  visiblePaddingChunks: 1
} as const;

export const V3_LOD_CONFIG = {
  low: { minZoom: 0, sampleStep: 16, smoothingPasses: 1, drawInsetShore: false, drawDeepWater: false },
  medium: { minZoom: 0.9, sampleStep: 12, smoothingPasses: 2, drawInsetShore: true, drawDeepWater: false },
  high: { minZoom: 1.45, sampleStep: 8, smoothingPasses: 2, drawInsetShore: true, drawDeepWater: true }
} as const;

export const V3_CACHE_CONFIG = {
  sampleQuantize: 3,
  maxCachedSamples: 260000
} as const;

export const V3_LAKE_CONFIG = {
  cellSize: 2600,
  lakeChance: 0.5,
  jitter: 0.34,
  radiusMin: 260,
  radiusMax: 520,
  edgeFeather: 36,
  largeLakeMinRadius: 300
} as const;

export const V3_RIVER_CONFIG = {
  linkSearchRadiusCells: 2,
  maxLinkDistance: 5200,
  optionalLinkChance: 0.26,
  mandatoryWidth: 76,
  widthJitter: 0.06,
  edgeFeather: 16,
  meanderAmplitudeMin: 64,
  meanderAmplitudeMax: 128,
  segmentLength: 240,
  kindThreshold: 0.18
} as const;

export const V3_RENDER_CONFIG = {
  flatGrassColor: { r: 124, g: 165, b: 87 },
  waterShallowColor: { r: 98, g: 167, b: 209 },
  waterMidColor: { r: 73, g: 139, b: 187 },
  waterDeepColor: { r: 48, g: 102, b: 152 },
  waterMidThreshold: 0.54,
  waterDeepThreshold: 0.82,
  waterOutlineThreshold: 0.2,
  shorelineOuterColor: 0x0f1820,
  shorelineInsetColor: 0xd2e8f4,
  shorelineOuterWidthPx: 3.1,
  shorelineInsetWidthPx: 2.1
} as const;

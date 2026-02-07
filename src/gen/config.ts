export type TerrainConfig = {
  elevationFrequency: number;
  elevationOctaves: number;
  elevationPersistence: number;
  elevationLacunarity: number;
  continentalFrequency: number;
  seaLevel: number;
  shoreBand: number;
  warpFrequency: number;
  warpAmplitude: number;
  moistureFrequency: number;
  moistureOctaves: number;
  moisturePersistence: number;
  moistureLacunarity: number;
  contourInterval: number;
  contourStrength: number;
  riverRegionSize: number;
  riverSeedsPerRegion: number;
  riverStartElevation: number;
  riverStepLength: number;
  riverMaxSteps: number;
};

export type VegetationConfig = {
  treeGridSize: number;
  treeRenderMargin: number;
  forestMinDensity: number;
  forestDenseThreshold: number;
  treeMinRadius: number;
  treeMaxRadius: number;
};

export type ChunkConfig = {
  pixelSize: number;
  maxCachedChunks: number;
};

export type DebugLayerConfig = {
  showContours: boolean;
  showRivers: boolean;
  showWaterMask: boolean;
  showMoisture: boolean;
  showForestMask: boolean;
};

export type WorldConfig = {
  seed: string;
  terrain: TerrainConfig;
  vegetation: VegetationConfig;
  chunk: ChunkConfig;
  debug: DebugLayerConfig;
};

export const defaultWorldConfig = (seed: string): WorldConfig => {
  return {
    seed,
    terrain: {
      elevationFrequency: 0.0018,
      elevationOctaves: 5,
      elevationPersistence: 0.53,
      elevationLacunarity: 2.1,
      continentalFrequency: 0.00034,
      seaLevel: 0.49,
      shoreBand: 0.06,
      warpFrequency: 0.0012,
      warpAmplitude: 120,
      moistureFrequency: 0.0017,
      moistureOctaves: 4,
      moisturePersistence: 0.58,
      moistureLacunarity: 2.05,
      contourInterval: 0.048,
      contourStrength: 0.18,
      riverRegionSize: 1100,
      riverSeedsPerRegion: 2,
      riverStartElevation: 0.6,
      riverStepLength: 18,
      riverMaxSteps: 110
    },
    vegetation: {
      treeGridSize: 14,
      treeRenderMargin: 24,
      forestMinDensity: 0.32,
      forestDenseThreshold: 0.62,
      treeMinRadius: 2.5,
      treeMaxRadius: 7.4
    },
    chunk: {
      pixelSize: 320,
      maxCachedChunks: 196
    },
    debug: {
      showContours: true,
      showRivers: true,
      showWaterMask: false,
      showMoisture: false,
      showForestMask: false
    }
  };
};

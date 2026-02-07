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

export type SettlementConfig = {
  cellSize: number;
  minVillageDistance: number;
  suitabilityThreshold: number;
  targetMoisture: number;
  maxCoastSearch: number;
  preferredCoastMin: number;
  preferredCoastMax: number;
};

export type RoadConfig = {
  regionSize: number;
  nearestNeighbors: number;
  maxConnectionDistance: number;
  loopChance: number;
  majorWidth: number;
  minorWidth: number;
  localWidth: number;
  routeStep: number;
  maxCurvatureOffset: number;
};

export type HouseConfig = {
  spacing: number;
  sideChance: number;
  minSetback: number;
  maxSetback: number;
  minWidth: number;
  maxWidth: number;
  minDepth: number;
  maxDepth: number;
  maxSlope: number;
};

export type ChunkConfig = {
  pixelSize: number;
  maxCachedChunks: number;
  sampleStep: number;
};

export type DebugLayerConfig = {
  showContours: boolean;
  showRivers: boolean;
  showWaterMask: boolean;
  showMoisture: boolean;
  showForestMask: boolean;
  showRoads: boolean;
  showVillages: boolean;
  showParcels: boolean;
  showHouses: boolean;
};

export type WorldConfig = {
  seed: string;
  terrain: TerrainConfig;
  vegetation: VegetationConfig;
  settlement: SettlementConfig;
  roads: RoadConfig;
  houses: HouseConfig;
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
    settlement: {
      cellSize: 360,
      minVillageDistance: 300,
      suitabilityThreshold: 0.47,
      targetMoisture: 0.5,
      maxCoastSearch: 420,
      preferredCoastMin: 90,
      preferredCoastMax: 280
    },
    roads: {
      regionSize: 1800,
      nearestNeighbors: 3,
      maxConnectionDistance: 900,
      loopChance: 0.22,
      majorWidth: 8.8,
      minorWidth: 5.2,
      localWidth: 3.7,
      routeStep: 80,
      maxCurvatureOffset: 70
    },
    houses: {
      spacing: 34,
      sideChance: 0.62,
      minSetback: 9,
      maxSetback: 16,
      minWidth: 10,
      maxWidth: 18,
      minDepth: 8,
      maxDepth: 14,
      maxSlope: 0.26
    },
    chunk: {
      pixelSize: 320,
      maxCachedChunks: 196,
      sampleStep: 2
    },
    debug: {
      showContours: false,
      showRivers: true,
      showWaterMask: false,
      showMoisture: false,
      showForestMask: false,
      showRoads: true,
      showVillages: true,
      showParcels: false,
      showHouses: true
    }
  };
};

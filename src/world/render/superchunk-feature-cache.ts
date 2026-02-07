import { WorldConfig } from "../../gen/config";
import { SettlementFeatures, SettlementSystem } from "../../gen/settlements";

type SuperchunkEntry = {
  key: string;
  features: SettlementFeatures;
};

const superchunkKey = (x: number, y: number): string => `${x},${y}`;

export class SuperchunkFeatureCache {
  private readonly config: WorldConfig;
  private readonly settlements: SettlementSystem;
  private readonly cache = new Map<string, SuperchunkEntry>();

  constructor(config: WorldConfig, settlements: SettlementSystem) {
    this.config = config;
    this.settlements = settlements;
  }

  getFeaturesForChunk(chunkX: number, chunkY: number): SettlementFeatures {
    const superSpan = Math.max(1, this.config.chunk.superchunkSpanChunks | 0);
    const superchunkX = Math.floor(chunkX / superSpan);
    const superchunkY = Math.floor(chunkY / superSpan);
    const key = superchunkKey(superchunkX, superchunkY);
    const cached = this.cache.get(key);
    if (cached) {
      return cached.features;
    }

    const chunkPixel = this.config.chunk.pixelSize;
    const superSize = superSpan * chunkPixel;
    const minX = superchunkX * superSize;
    const minY = superchunkY * superSize;
    const maxX = minX + superSize;
    const maxY = minY + superSize;
    const margin = this.config.chunk.featureMargin;

    const features = this.settlements.getFeaturesForBounds(minX - margin, maxX + margin, minY - margin, maxY + margin);
    this.cache.set(key, { key, features });
    this.prune();
    return features;
  }

  clear(): void {
    this.cache.clear();
  }

  private prune(): void {
    const max = this.config.chunk.maxCachedSuperchunks;
    if (this.cache.size <= max) {
      return;
    }

    const overflow = this.cache.size - max;
    const keys = this.cache.keys();
    for (let i = 0; i < overflow; i += 1) {
      const next = keys.next();
      if (next.done) {
        break;
      }
      this.cache.delete(next.value);
    }
  }
}

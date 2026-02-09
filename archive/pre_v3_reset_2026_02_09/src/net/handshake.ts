import { WorldConfig } from "../gen/config";
import { hashString } from "../gen/hash";

type CanonicalGenerationConfig = {
  terrain: WorldConfig["terrain"];
  vegetation: WorldConfig["vegetation"];
  settlement: WorldConfig["settlement"];
  roads: WorldConfig["roads"];
  houses: WorldConfig["houses"];
};

export type WorldHandshake = {
  protocolVersion: 1;
  seed: string;
  generationConfig: CanonicalGenerationConfig;
  configHash: string;
};

const toCanonicalObject = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(toCanonicalObject);
  }
  if (value && typeof value === "object") {
    const sorted = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const canonical: Record<string, unknown> = {};
    for (const [key, child] of sorted) {
      canonical[key] = toCanonicalObject(child);
    }
    return canonical;
  }
  return value;
};

export const canonicalGenerationConfigFromWorld = (config: WorldConfig): CanonicalGenerationConfig => {
  return {
    terrain: { ...config.terrain },
    vegetation: { ...config.vegetation },
    settlement: { ...config.settlement },
    roads: { ...config.roads },
    houses: { ...config.houses }
  };
};

export const canonicalStringify = (value: unknown): string => {
  return JSON.stringify(toCanonicalObject(value));
};

const hashHex = (text: string): string => {
  const hash = hashString(text) >>> 0;
  return hash.toString(16).padStart(8, "0");
};

const buildHandshakeHash = (seed: string, generationConfig: CanonicalGenerationConfig): string => {
  return hashHex(canonicalStringify({ seed, generationConfig }));
};

export const buildWorldHandshake = (config: WorldConfig): WorldHandshake => {
  const generationConfig = canonicalGenerationConfigFromWorld(config);
  return {
    protocolVersion: 1,
    seed: config.seed,
    generationConfig,
    configHash: buildHandshakeHash(config.seed, generationConfig)
  };
};

export const serializeWorldHandshake = (handshake: WorldHandshake): string => {
  return canonicalStringify(handshake);
};

export const parseWorldHandshake = (json: string): WorldHandshake => {
  const parsed = JSON.parse(json) as WorldHandshake;
  if (parsed.protocolVersion !== 1 || typeof parsed.seed !== "string") {
    throw new Error("Invalid world handshake payload.");
  }

  const expected = buildHandshakeHash(parsed.seed, parsed.generationConfig);

  if (expected !== parsed.configHash) {
    throw new Error("World handshake hash mismatch.");
  }

  return parsed;
};

import { WorldConfig } from "./config";
import { hashString } from "./hash";
import { RiverSystem } from "./rivers";
import { SettlementSystem } from "./settlements";
import { createTerrainSampler } from "./terrain";
import { buildWorldHandshake } from "../net/handshake";

type DeterminismDigest = {
  terrainHash: string;
  riversHash: string;
  settlementsHash: string;
  stableIdHash: string;
  overallHash: string;
};

export type DeterminismReport = {
  protocolVersion: number;
  seed: string;
  configHash: string;
  digests: DeterminismDigest;
};

export type DeterminismSuiteResult = {
  consistent: boolean;
  runs: DeterminismReport[];
};

const toHash = (input: string): string => {
  return (hashString(input) >>> 0).toString(16).padStart(8, "0");
};

const q = (value: number, precision = 4): string => {
  return value.toFixed(precision);
};

const terrainDigest = (config: WorldConfig): string => {
  const terrain = createTerrainSampler(config);
  const values: string[] = [];

  for (let y = -6; y <= 6; y += 1) {
    for (let x = -6; x <= 6; x += 1) {
      const wx = x * 73.25 + (y % 3) * 11.7;
      const wy = y * 68.5 + (x % 4) * 9.3;
      const probe = terrain.probe(wx, wy);
      values.push(`${q(probe.elevation)}|${q(probe.moisture)}|${q(probe.waterDepth)}|${q(probe.slope)}|${q(probe.forestDensity)}`);
    }
  }

  return toHash(values.join(";"));
};

const riversDigest = (config: WorldConfig): string => {
  const terrain = createTerrainSampler(config);
  const rivers = new RiverSystem(config, terrain).getRiversForBounds(-1900, 1900, -1900, 1900).slice();
  rivers.sort((a, b) => {
    const ax = a.points[0]?.x ?? 0;
    const ay = a.points[0]?.y ?? 0;
    const bx = b.points[0]?.x ?? 0;
    const by = b.points[0]?.y ?? 0;
    return ax === bx ? ay - by : ax - bx;
  });

  const encoded = rivers.map((river) => {
    const points = river.points.slice(0, 14).map((p) => `${q(p.x, 2)},${q(p.y, 2)}`).join("|");
    return `${q(river.width, 3)}:${points}`;
  });

  return toHash(encoded.join(";"));
};

const settlementsDigest = (config: WorldConfig): { coreHash: string; idHash: string } => {
  const terrain = createTerrainSampler(config);
  const settlements = new SettlementSystem(config, terrain);
  const features = settlements.getFeaturesForBounds(-1850, 1850, -1850, 1850);

  const villages = features.villages.slice().sort((a, b) => a.id.localeCompare(b.id));
  const roads = features.roads.slice().sort((a, b) => a.id.localeCompare(b.id));
  const parcels = features.parcels.slice().sort((a, b) => a.id.localeCompare(b.id));
  const houses = features.houses.slice().sort((a, b) => a.id.localeCompare(b.id));

  const villageData = villages.map((v) => `${v.id}:${v.template}:${q(v.x, 2)},${q(v.y, 2)},${q(v.score, 4)},${q(v.radius, 2)}`);
  const roadData = roads.map((r) => {
    const start = r.points[0];
    const end = r.points[r.points.length - 1];
    return `${r.id}:${r.type}:${r.hierarchy}:${q(r.width, 2)}:${q(start?.x ?? 0, 2)},${q(start?.y ?? 0, 2)}>${q(end?.x ?? 0, 2)},${q(end?.y ?? 0, 2)}`;
  });
  const parcelData = parcels.map(
    (p) => `${p.id}:${p.roadId}:${p.roadHierarchy}:${q(p.x, 2)},${q(p.y, 2)},${q(p.width, 2)},${q(p.depth, 2)},${q(p.angle, 4)}`
  );
  const houseData = houses.map((h) => `${h.id}:${q(h.x, 2)},${q(h.y, 2)},${q(h.width, 2)},${q(h.depth, 2)},${q(h.angle, 4)},${h.roofStyle}`);

  const coreHash = toHash([...villageData, ...roadData, ...parcelData, ...houseData].join(";"));
  const idHash = toHash(
    [...villages.map((v) => v.id), ...roads.map((r) => r.id), ...parcels.map((p) => p.id), ...houses.map((h) => h.id)].join("|")
  );

  return { coreHash, idHash };
};

export const buildDeterminismReport = (config: WorldConfig): DeterminismReport => {
  const handshake = buildWorldHandshake(config);
  const terrainHash = terrainDigest(config);
  const riversHash = riversDigest(config);
  const settlementHashes = settlementsDigest(config);
  const overallHash = toHash([
    handshake.configHash,
    terrainHash,
    riversHash,
    settlementHashes.coreHash,
    settlementHashes.idHash
  ].join("/"));

  return {
    protocolVersion: handshake.protocolVersion,
    seed: config.seed,
    configHash: handshake.configHash,
    digests: {
      terrainHash,
      riversHash,
      settlementsHash: settlementHashes.coreHash,
      stableIdHash: settlementHashes.idHash,
      overallHash
    }
  };
};

export const runDeterminismSuite = (config: WorldConfig, runs = 3): DeterminismSuiteResult => {
  const reports: DeterminismReport[] = [];
  for (let i = 0; i < Math.max(1, runs); i += 1) {
    reports.push(buildDeterminismReport(config));
  }

  const baseline = reports[0].digests.overallHash;
  const consistent = reports.every((report) => report.digests.overallHash === baseline);
  return {
    consistent,
    runs: reports
  };
};

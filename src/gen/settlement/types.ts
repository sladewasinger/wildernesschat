export type Village = {
  id: string;
  x: number;
  y: number;
  score: number;
  radius: number;
  cellX: number;
  cellY: number;
};

export type RoadType = "major" | "minor" | "local";

export type Road = {
  id: string;
  type: RoadType;
  width: number;
  points: { x: number; y: number }[];
  fromVillageId: string;
  toVillageId: string;
};

export type Parcel = {
  id: string;
  villageId: string;
  roadId: string;
  roadType: RoadType;
  x: number;
  y: number;
  width: number;
  depth: number;
  angle: number;
  side: -1 | 1;
};

export type House = {
  id: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  angle: number;
  roofStyle: number;
};

export type SettlementFeatures = {
  villages: Village[];
  roads: Road[];
  parcels: Parcel[];
  houses: House[];
};


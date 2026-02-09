export type VillageTemplate = "lakeside" | "crossroad" | "linear";

export type Village = {
  id: string;
  x: number;
  y: number;
  score: number;
  radius: number;
  cellX: number;
  cellY: number;
  template: VillageTemplate;
};

export type RoadType = "major" | "minor" | "local";
export type RoadHierarchy = "arterial" | "collector" | "lane" | "path";

export type Road = {
  id: string;
  type: RoadType;
  hierarchy: RoadHierarchy;
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
  roadHierarchy: RoadHierarchy;
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

export type RoadNodeKind = "village" | "junction" | "bridge";

export type RoadNode = {
  id: string;
  kind: RoadNodeKind;
  x: number;
  y: number;
  villageId?: string;
  roadId?: string;
};

export type RoadEdge = {
  id: string;
  roadId: string;
  hierarchy: RoadHierarchy;
  fromNodeId: string;
  toNodeId: string;
  fromVillageId: string;
  toVillageId: string;
  length: number;
  hasBridge: boolean;
  bridgeNodeIds: string[];
};

export type SettlementLayout = {
  villages: Village[];
  roadNodes: RoadNode[];
  roadEdges: RoadEdge[];
  roads: Road[];
  parcels: Parcel[];
  houses: House[];
};

export type SettlementFeatures = Pick<SettlementLayout, "villages" | "roads" | "parcels" | "houses">;

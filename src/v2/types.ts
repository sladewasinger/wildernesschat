export type Point = {
  x: number;
  y: number;
};

export type CubicBezierDebug = {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
};

export type RoadClass = "trunk" | "branch" | "drive" | "shortcut";

export type RoadSegment = {
  id: string;
  className: RoadClass;
  width: number;
  points: Point[];
  renderPoints?: Point[] | null;
  bezierDebug?: CubicBezierDebug[] | null;
};

export type House = {
  id: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  angle: number;
  tone: number;
};

export type VillageSite = {
  id: string;
  cellX: number;
  cellY: number;
  x: number;
  y: number;
  angle: number;
  trunkLength: number;
  score: number;
};

export type VillagePlan = {
  site: VillageSite;
  roads: RoadSegment[];
  houses: House[];
  metrics: {
    branchCount: number;
    shortcutCount: number;
    connectorCount: number;
  };
};

export type Direction = "N" | "E" | "S" | "W";

export const DIRECTIONS: Direction[] = ["N", "E", "S", "W"];

export const DIRECTION_OFFSETS: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
};

export const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  N: "S",
  E: "W",
  S: "N",
  W: "E"
};

export type TileAdjacency = Record<Direction, Set<number>>;

export type TileSet = {
  tileSize: number;
  tiles: HTMLCanvasElement[];
  weights: number[];
  adjacency: Map<number, TileAdjacency>;
};

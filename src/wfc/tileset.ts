import { DIRECTIONS, DIRECTION_OFFSETS, OPPOSITE_DIRECTION, TileAdjacency, TileSet } from "./types";

const makeAdjacency = (): TileAdjacency => ({
  N: new Set<number>(),
  E: new Set<number>(),
  S: new Set<number>(),
  W: new Set<number>()
});

const imageDataHash = (pixels: Uint8ClampedArray): string => {
  let hash = 2166136261;
  for (let i = 0; i < pixels.length; i += 1) {
    hash ^= pixels[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
};

export const loadTileSetFromImage = async (src: string, tileSize: number): Promise<TileSet> => {
  const image = await loadImage(src);
  const cols = Math.floor(image.width / tileSize);
  const rows = Math.floor(image.height / tileSize);
  if (cols <= 0 || rows <= 0) {
    throw new Error("Training image is smaller than one tile.");
  }

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.width;
  sourceCanvas.height = image.height;
  const sourceCtx = sourceCanvas.getContext("2d");
  if (!sourceCtx) {
    throw new Error("2D canvas context unavailable.");
  }
  sourceCtx.drawImage(image, 0, 0);

  const tileHashes = new Map<string, number>();
  const tiles: HTMLCanvasElement[] = [];
  const weights: number[] = [];
  const adjacency = new Map<number, TileAdjacency>();
  const grid: number[] = new Array(cols * rows);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const imageData = sourceCtx.getImageData(x * tileSize, y * tileSize, tileSize, tileSize);
      const hash = imageDataHash(imageData.data);
      let tileId = tileHashes.get(hash);
      if (tileId === undefined) {
        tileId = tiles.length;
        tileHashes.set(hash, tileId);
        const tileCanvas = document.createElement("canvas");
        tileCanvas.width = tileSize;
        tileCanvas.height = tileSize;
        const tileCtx = tileCanvas.getContext("2d");
        if (!tileCtx) {
          throw new Error("2D canvas context unavailable.");
        }
        tileCtx.putImageData(imageData, 0, 0);
        tiles.push(tileCanvas);
        weights.push(0);
        adjacency.set(tileId, makeAdjacency());
      }
      weights[tileId] += 1;
      grid[x + y * cols] = tileId;
    }
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const tileId = grid[x + y * cols];
      const rules = adjacency.get(tileId)!;
      for (const direction of DIRECTIONS) {
        const offset = DIRECTION_OFFSETS[direction];
        const nx = x + offset.dx;
        const ny = y + offset.dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
          continue;
        }
        const neighborTile = grid[nx + ny * cols];
        rules[direction].add(neighborTile);
        adjacency.get(neighborTile)![OPPOSITE_DIRECTION[direction]].add(tileId);
      }
    }
  }

  return { tileSize, tiles, weights, adjacency };
};

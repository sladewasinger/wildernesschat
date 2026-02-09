import { World } from "./world/world";
import { floorDiv } from "./util/math";

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: HTMLElement;
  private readonly world: World;
  private readonly input: InputState = { up: false, down: false, left: false, right: false };

  private playerX = 0;
  private playerY = 0;
  private lastTime = 0;

  constructor(canvas: HTMLCanvasElement, hud: HTMLElement, world: World) {
    this.canvas = canvas;
    this.hud = hud;
    this.world = world;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable.");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.resize();
  }

  start(): void {
    requestAnimationFrame(this.tick);
  }

  private readonly resize = (): void => {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "w" || event.key === "ArrowUp") this.input.up = true;
    if (event.key === "s" || event.key === "ArrowDown") this.input.down = true;
    if (event.key === "a" || event.key === "ArrowLeft") this.input.left = true;
    if (event.key === "d" || event.key === "ArrowRight") this.input.right = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "w" || event.key === "ArrowUp") this.input.up = false;
    if (event.key === "s" || event.key === "ArrowDown") this.input.down = false;
    if (event.key === "a" || event.key === "ArrowLeft") this.input.left = false;
    if (event.key === "d" || event.key === "ArrowRight") this.input.right = false;
  };

  private readonly tick = (time: number): void => {
    const dt = this.lastTime === 0 ? 0 : Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    let moveX = 0;
    let moveY = 0;
    if (this.input.left) moveX -= 1;
    if (this.input.right) moveX += 1;
    if (this.input.up) moveY -= 1;
    if (this.input.down) moveY += 1;

    if (moveX !== 0 || moveY !== 0) {
      const length = Math.hypot(moveX, moveY);
      moveX /= length;
      moveY /= length;
    }

    const speed = 210;
    this.playerX += moveX * speed * dt;
    this.playerY += moveY * speed * dt;
    this.world.prefetchChunksNearPlayer(this.playerX, this.playerY, this.canvas.width, this.canvas.height, moveX, moveY);
    this.world.advanceGenerationBudget();
  }

  private render(): void {
    const ctx = this.ctx;
    const chunkSize = this.world.getChunkSize();
    const halfW = this.canvas.width * 0.5;
    const halfH = this.canvas.height * 0.5;

    const minChunkX = floorDiv(this.playerX - halfW, chunkSize) - 1;
    const maxChunkX = floorDiv(this.playerX + halfW, chunkSize) + 1;
    const minChunkY = floorDiv(this.playerY - halfH, chunkSize) - 1;
    const maxChunkY = floorDiv(this.playerY + halfH, chunkSize) + 1;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let cy = minChunkY; cy <= maxChunkY; cy += 1) {
      for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
        const chunkCanvas = this.world.getChunkCanvas(cx, cy);
        const screenX = Math.floor(cx * chunkSize - this.playerX + halfW);
        const screenY = Math.floor(cy * chunkSize - this.playerY + halfH);
        ctx.drawImage(chunkCanvas, screenX, screenY, chunkSize, chunkSize);
      }
    }

    const sample = this.world.sampleAt(this.playerX, this.playerY);
    const generation = this.world.getGenerationStats();
    const handshake = this.world.getWorldHandshake();

    ctx.fillStyle = "#f4eec7";
    ctx.beginPath();
    ctx.arc(halfW, halfH, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1e252d";
    ctx.lineWidth = 2;
    ctx.stroke();

    const speedX = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    const speedY = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0);
    const moveMag = Math.hypot(speedX, speedY) > 0 ? 1 : 0;

    this.hud.textContent = [
      "Village Generator",
      "Move: WASD / Arrows",
      `Seed: ${this.world.getSeed()}`,
      `Handshake: v${handshake.protocolVersion} hash=${handshake.configHash}`,
      `Player px: ${this.playerX.toFixed(1)}, ${this.playerY.toFixed(1)}`,
      `Movement: ${moveMag ? "moving" : "idle"}`,
      `Chunk: ${floorDiv(this.playerX, chunkSize)}, ${floorDiv(this.playerY, chunkSize)}`,
      `Terrain: elev=${sample.elevation.toFixed(3)} moist=${sample.moisture.toFixed(3)} slope=${sample.slope.toFixed(3)} water=${sample.waterDepth.toFixed(3)}`,
      `Streaming: pending=${generation.pendingChunks} seamWarnings=${generation.seamWarnings}`
    ].join("\n");
  }
}

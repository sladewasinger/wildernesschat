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
    if (this.toggleDebugLayer(event)) {
      return;
    }
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
    const debug = this.world.getDebugLayers();
    const generation = this.world.getGenerationStats();
    const handshake = this.world.getWorldHandshake();

    ctx.fillStyle = "#f4eec7";
    ctx.beginPath();
    ctx.arc(halfW, halfH, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1e252d";
    ctx.lineWidth = 2;
    ctx.stroke();

    this.hud.textContent = [
      "Organic village generator (phase 0-7 systems implemented)",
      "Move: WASD / Arrows",
      "Debug: 1 water 2 moisture 3 forest 4 contours 5 rivers 6 roads 7 villages 8 houses 9 parcels",
      "Mask modes (1/2/3) hide roads/parcels/houses/trees for readability",
      `Seed: ${this.world.getSeed()}`,
      `Handshake: v${handshake.protocolVersion} hash=${handshake.configHash}`,
      `Player px: ${this.playerX.toFixed(1)}, ${this.playerY.toFixed(1)}`,
      `Chunk: ${floorDiv(this.playerX, chunkSize)}, ${floorDiv(this.playerY, chunkSize)}`,
      `Elev: ${sample.elevation.toFixed(3)} Moisture: ${sample.moisture.toFixed(3)}`,
      `Slope: ${sample.slope.toFixed(3)} Forest: ${sample.forestDensity.toFixed(3)}`,
      `Water depth: ${sample.waterDepth.toFixed(3)}`,
      `Streaming: pendingChunks=${generation.pendingChunks} seamWarnings=${generation.seamWarnings}`,
      `Layers: water=${debug.showWaterMask ? "on" : "off"} moisture=${debug.showMoisture ? "on" : "off"} forest=${debug.showForestMask ? "on" : "off"} contours=${debug.showContours ? "on" : "off"} rivers=${debug.showRivers ? "on" : "off"} roads=${debug.showRoads ? "on" : "off"} villages=${debug.showVillages ? "on" : "off"} parcels=${debug.showParcels ? "on" : "off"} houses=${debug.showHouses ? "on" : "off"}`
    ].join("\n");
  }

  private toggleDebugLayer(event: KeyboardEvent): boolean {
    if (event.repeat) {
      return true;
    }

    if (event.key === "1") {
      this.world.toggleDebugLayer("showWaterMask");
      return true;
    }
    if (event.key === "2") {
      this.world.toggleDebugLayer("showMoisture");
      return true;
    }
    if (event.key === "3") {
      this.world.toggleDebugLayer("showForestMask");
      return true;
    }
    if (event.key === "4") {
      this.world.toggleDebugLayer("showContours");
      return true;
    }
    if (event.key === "5") {
      this.world.toggleDebugLayer("showRivers");
      return true;
    }
    if (event.key === "6") {
      this.world.toggleDebugLayer("showRoads");
      return true;
    }
    if (event.key === "7") {
      this.world.toggleDebugLayer("showVillages");
      return true;
    }
    if (event.key === "8") {
      this.world.toggleDebugLayer("showHouses");
      return true;
    }
    if (event.key === "9") {
      this.world.toggleDebugLayer("showParcels");
      return true;
    }
    return false;
  }
}

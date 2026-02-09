import { clamp } from "../util/math";
import { hashString } from "../gen/hash";
import { V2_SETTLEMENT_CONFIG, V2_STAGE_MAX, V2_STAGE_MIN } from "./config";
import { V2TerrainSampler } from "./terrain";
import { RoadSegment, VillagePlan, VillageSite } from "./types";
import { buildHouseFirstVillagePlan } from "./generator/house-first";
import {
  addInterVillageConnectors,
  collectContinuityRoadsInBounds,
  collectContinuityRoadsNearSite,
  createStage4ContinuityContext,
  Stage4ContinuityContext
} from "./generator/inter-village";
import { collectSitesInBounds, SiteSelectionContext } from "./generator/site-selection";

export class V2SettlementGenerator {
  private readonly siteSeed: number;
  private readonly planSeed: number;
  private readonly terrain: V2TerrainSampler;
  private readonly siteCache = new Map<string, VillageSite | null>();
  private readonly planCache = new Map<string, VillagePlan>();
  private readonly siteSelectionContext: SiteSelectionContext;
  private readonly stage4ContinuityContext: Stage4ContinuityContext;

  constructor(seed: string, terrain: V2TerrainSampler) {
    this.siteSeed = hashString(`${seed}:v2:sites`);
    this.planSeed = hashString(`${seed}:v2:plans`);
    this.terrain = terrain;
    this.siteSelectionContext = {
      siteSeed: this.siteSeed,
      terrain: this.terrain,
      siteCellSize: V2_SETTLEMENT_CONFIG.siting.siteCellSize,
      minSiteScore: V2_SETTLEMENT_CONFIG.siting.minSiteScore,
      siteCache: this.siteCache
    };
    this.stage4ContinuityContext = createStage4ContinuityContext(this.planSeed, this.terrain);
  }

  collectSitesInBounds(minX: number, maxX: number, minY: number, maxY: number): VillageSite[] {
    return collectSitesInBounds(this.siteSelectionContext, minX, maxX, minY, maxY);
  }

  collectStage4ContinuityRoadsInBounds(minX: number, maxX: number, minY: number, maxY: number): RoadSegment[] {
    return collectContinuityRoadsInBounds(
      this.stage4ContinuityContext,
      this.siteSelectionContext,
      this.planSeed,
      minX,
      maxX,
      minY,
      maxY
    );
  }

  buildVillagePlan(site: VillageSite, stage: number): VillagePlan {
    const stageValue = clamp(Math.floor(stage), V2_STAGE_MIN, V2_STAGE_MAX);
    const cacheKey = `${site.id}:${stageValue}`;
    const cached = this.planCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const roads: VillagePlan["roads"] = [];
    const houses: VillagePlan["houses"] = [];
    const metrics: VillagePlan["metrics"] = {
      branchCount: 0,
      shortcutCount: 0,
      connectorCount: 0
    };

    let primaryRoad: RoadSegment | null = null;
    if (stageValue >= 1) {
      const planLocal = buildHouseFirstVillagePlan({
        site,
        stage: stageValue,
        planSeed: this.planSeed,
        terrain: this.terrain
      });
      roads.push(...planLocal.roads);
      houses.push(...planLocal.houses);
      metrics.branchCount = planLocal.branchCount;
      metrics.shortcutCount = planLocal.shortcutCount;
      primaryRoad = planLocal.primaryRoad;
    }

    if (stageValue >= 4) {
      const continuityRoads = collectContinuityRoadsNearSite(
        this.stage4ContinuityContext,
        this.siteSelectionContext,
        this.planSeed,
        site,
        V2_SETTLEMENT_CONFIG.stage4.attachments.searchRadius
      );
      metrics.connectorCount = addInterVillageConnectors({
        site,
        trunk:
          primaryRoad ??
          ({
            id: `rt-${site.id}`,
            className: "trunk",
            width: V2_SETTLEMENT_CONFIG.roads.width,
            points: [{ x: site.x - 1, y: site.y }, { x: site.x + 1, y: site.y }]
          } satisfies RoadSegment),
        roads,
        houses,
        planSeed: this.planSeed,
        terrain: this.terrain,
        continuityRoads
      });
    }

    const plan: VillagePlan = { site, roads, houses, metrics };
    this.planCache.set(cacheKey, plan);
    return plan;
  }
}

import { clamp } from "../util/math";
import { hashString } from "../gen/hash";
import { V2_SETTLEMENT_CONFIG, V2_STAGE_MAX, V2_STAGE_MIN } from "./config";
import { V2TerrainSampler } from "./terrain";
import { VillagePlan, VillageSite } from "./types";
import { addBranches } from "./generator/branching";
import { buildAnchorPlacement, growHousesAlongRoad } from "./generator/housing";
import { addInterVillageConnectors } from "./generator/inter-village";
import { collectSitesInBounds, SiteSelectionContext } from "./generator/site-selection";
import { addShortcuts } from "./generator/shortcuts";
import { pickStage3GrowthProfile } from "./generator/stage3-profile";
import { buildTrunkRoad } from "./generator/trunk";

export class V2SettlementGenerator {
  private readonly siteSeed: number;
  private readonly planSeed: number;
  private readonly terrain: V2TerrainSampler;
  private readonly siteCache = new Map<string, VillageSite | null>();
  private readonly planCache = new Map<string, VillagePlan>();
  private readonly siteSelectionContext: SiteSelectionContext;

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
  }

  collectSitesInBounds(minX: number, maxX: number, minY: number, maxY: number): VillageSite[] {
    return collectSitesInBounds(this.siteSelectionContext, minX, maxX, minY, maxY);
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
    const trunk = buildTrunkRoad(site, this.planSeed);

    if (stageValue >= 1) {
      const anchor = buildAnchorPlacement(site, trunk, this.planSeed);
      roads.push(trunk);
      roads.push(anchor.driveRoad);
      houses.push(anchor.house);
    }

    if (stageValue >= 2) {
      growHousesAlongRoad({
        site,
        road: trunk,
        slotCount: V2_SETTLEMENT_CONFIG.stage2.trunkGrowth.slotCount,
        roads,
        houses,
        seed: hashString(`${site.id}:trunk-growth`),
        threshold: V2_SETTLEMENT_CONFIG.stage2.trunkGrowth.threshold,
        terrain: this.terrain
      });
    }

    if (stageValue >= 3) {
      const growthProfile = pickStage3GrowthProfile(site, this.planSeed);
      metrics.branchCount = addBranches({
        site,
        trunk,
        roads,
        houses,
        allowReuseHeuristic: stageValue >= 4,
        planSeed: this.planSeed,
        terrain: this.terrain,
        growthProfile
      });
      metrics.shortcutCount = addShortcuts({
        site,
        roads,
        houses,
        terrain: this.terrain,
        maxCount: growthProfile.shortcutMaxCount,
        pairChanceThreshold: growthProfile.shortcutPairChance
      });
    }

    if (stageValue >= 4) {
      metrics.connectorCount = addInterVillageConnectors({
        site,
        trunk,
        roads,
        houses,
        planSeed: this.planSeed,
        terrain: this.terrain,
        siteContext: this.siteSelectionContext
      });
    }

    const plan: VillagePlan = { site, roads, houses, metrics };
    this.planCache.set(cacheKey, plan);
    return plan;
  }
}

import { WorldConfig } from "../config";
import { TerrainSampler } from "../terrain";
import { pointInRect, roadMidpoint } from "../settlement/geometry";
import { bridgeNodeId, roadGraphEdgeId, roadNodeId } from "../settlement/stable-ids";
import { HouseGenerator } from "../settlement/house-generator";
import { ParcelGenerator } from "../settlement/parcel-generator";
import { RoadGenerator } from "../settlement/road-generator";
import { VillageGenerator } from "../settlement/village-generator";
import { Road, RoadEdge, RoadNode, SettlementLayout, Village } from "../settlement/types";

type BridgeRun = {
  startDistance: number;
  endDistance: number;
};

export class SettlementLayoutBuilder {
  private readonly config: WorldConfig;
  private readonly terrain: TerrainSampler;
  private readonly villageGenerator: VillageGenerator;
  private readonly roadGenerator: RoadGenerator;
  private readonly parcelGenerator: ParcelGenerator;
  private readonly houseGenerator: HouseGenerator;

  constructor(
    config: WorldConfig,
    terrain: TerrainSampler,
    villageGenerator: VillageGenerator,
    roadGenerator: RoadGenerator,
    parcelGenerator: ParcelGenerator,
    houseGenerator: HouseGenerator
  ) {
    this.config = config;
    this.terrain = terrain;
    this.villageGenerator = villageGenerator;
    this.roadGenerator = roadGenerator;
    this.parcelGenerator = parcelGenerator;
    this.houseGenerator = houseGenerator;
  }

  buildRegionLayout(regionX: number, regionY: number): SettlementLayout {
    const regionSize = this.config.roads.regionSize;
    const coreMinX = regionX * regionSize;
    const coreMinY = regionY * regionSize;
    const coreMaxX = coreMinX + regionSize;
    const coreMaxY = coreMinY + regionSize;
    const margin = this.config.roads.maxConnectionDistance + this.config.settlement.cellSize;

    const villages = this.villageGenerator
      .collectVillagesInBounds(coreMinX - margin, coreMaxX + margin, coreMinY - margin, coreMaxY + margin)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const regionalRoads = this.roadGenerator.buildRegionalRoadNetwork(villages);
    const localRoads = this.roadGenerator.buildLocalRoadNetwork(villages, regionalRoads);
    const roads = [...regionalRoads, ...localRoads].sort((a, b) => a.id.localeCompare(b.id));
    const parcels = this.parcelGenerator.generateParcels(roads, villages).slice().sort((a, b) => a.id.localeCompare(b.id));
    const houses = this.houseGenerator.generateHouses(parcels).slice().sort((a, b) => a.id.localeCompare(b.id));
    const graph = this.buildRoadGraph(villages, roads);

    const regionVillages = villages.filter((village) => pointInRect(village.x, village.y, coreMinX, coreMaxX, coreMinY, coreMaxY));
    const regionRoads = roads.filter((road) => {
      const mid = roadMidpoint(road);
      return pointInRect(mid.x, mid.y, coreMinX, coreMaxX, coreMinY, coreMaxY);
    });
    const regionRoadIds = new Set(regionRoads.map((road) => road.id));
    const regionRoadEdges = graph.roadEdges
      .filter((edge) => regionRoadIds.has(edge.roadId))
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const regionNodeIds = new Set<string>();
    for (const edge of regionRoadEdges) {
      regionNodeIds.add(edge.fromNodeId);
      regionNodeIds.add(edge.toNodeId);
      for (const bridgeId of edge.bridgeNodeIds) {
        regionNodeIds.add(bridgeId);
      }
    }
    const regionRoadNodes = graph.roadNodes
      .filter(
        (node) =>
          regionNodeIds.has(node.id) ||
          pointInRect(node.x, node.y, coreMinX, coreMaxX, coreMinY, coreMaxY)
      )
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const regionParcels = parcels.filter((parcel) => pointInRect(parcel.x, parcel.y, coreMinX, coreMaxX, coreMinY, coreMaxY));
    const regionHouses = houses.filter((house) => pointInRect(house.x, house.y, coreMinX, coreMaxX, coreMinY, coreMaxY));

    return {
      villages: regionVillages,
      roadNodes: regionRoadNodes,
      roadEdges: regionRoadEdges,
      roads: regionRoads,
      parcels: regionParcels,
      houses: regionHouses
    };
  }

  private buildRoadGraph(villages: Village[], roads: Road[]): { roadNodes: RoadNode[]; roadEdges: RoadEdge[] } {
    const roadNodes = new Map<string, RoadNode>();
    const roadEdges: RoadEdge[] = [];
    const villageById = new Map(villages.map((village) => [village.id, village]));

    for (const village of villages) {
      roadNodes.set(village.id, {
        id: village.id,
        kind: "village",
        x: village.x,
        y: village.y,
        villageId: village.id
      });
    }

    for (const road of roads) {
      if (road.points.length < 2) {
        continue;
      }
      const start = road.points[0];
      const end = road.points[road.points.length - 1];
      const startNodeId = this.endpointNodeId(
        roadNodes,
        villageById,
        road.id,
        "start",
        road.fromVillageId,
        start.x,
        start.y
      );
      const endNodeId = this.endpointNodeId(
        roadNodes,
        villageById,
        road.id,
        "end",
        road.toVillageId,
        end.x,
        end.y
      );
      const bridgeNodes = this.detectBridgeNodes(road);
      for (const bridge of bridgeNodes) {
        roadNodes.set(bridge.id, bridge);
      }

      roadEdges.push({
        id: roadGraphEdgeId(road.id),
        roadId: road.id,
        hierarchy: road.hierarchy,
        fromNodeId: startNodeId,
        toNodeId: endNodeId,
        fromVillageId: road.fromVillageId,
        toVillageId: road.toVillageId,
        length: this.roadLength(road),
        hasBridge: bridgeNodes.length > 0,
        bridgeNodeIds: bridgeNodes.map((bridge) => bridge.id)
      });
    }

    return {
      roadNodes: Array.from(roadNodes.values()).sort((a, b) => a.id.localeCompare(b.id)),
      roadEdges: roadEdges.sort((a, b) => a.id.localeCompare(b.id))
    };
  }

  private endpointNodeId(
    roadNodes: Map<string, RoadNode>,
    villageById: Map<string, Village>,
    roadId: string,
    position: "start" | "end",
    villageId: string,
    x: number,
    y: number
  ): string {
    const village = villageById.get(villageId);
    if (village && Math.hypot(village.x - x, village.y - y) <= 8) {
      return villageId;
    }

    const nodeId = roadNodeId(roadId, position);
    if (!roadNodes.has(nodeId)) {
      roadNodes.set(nodeId, {
        id: nodeId,
        kind: "junction",
        x,
        y,
        roadId
      });
    }
    return nodeId;
  }

  private detectBridgeNodes(road: Road): RoadNode[] {
    if (road.points.length < 2) {
      return [];
    }
    const totalLength = this.roadLength(road);
    if (totalLength <= 1) {
      return [];
    }

    const runs: BridgeRun[] = [];
    let traversed = 0;
    let runStart = -1;

    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
      if (segmentLength <= 1e-6) {
        continue;
      }
      const samples = Math.max(2, Math.ceil(segmentLength / 8));
      for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex += 1) {
        const t = sampleIndex / samples;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const distance = traversed + segmentLength * t;
        const inWater = this.terrain.sample(x, y).waterDepth > 0.004;
        if (inWater && runStart < 0) {
          runStart = distance;
        } else if (!inWater && runStart >= 0) {
          runs.push({ startDistance: runStart, endDistance: distance });
          runStart = -1;
        }
      }
      traversed += segmentLength;
    }
    if (runStart >= 0) {
      runs.push({ startDistance: runStart, endDistance: totalLength });
    }

    const nodes: RoadNode[] = [];
    let bridgeIndex = 0;
    for (const run of runs) {
      const span = run.endDistance - run.startDistance;
      const midDistance = (run.startDistance + run.endDistance) * 0.5;
      const normalizedStart = run.startDistance / totalLength;
      const normalizedEnd = run.endDistance / totalLength;
      if (span < 4 || span > 140) {
        continue;
      }
      if (normalizedStart < 0.04 || normalizedEnd > 0.96) {
        continue;
      }
      const point = this.pointAtDistance(road, midDistance);
      nodes.push({
        id: bridgeNodeId(road.id, bridgeIndex),
        kind: "bridge",
        x: point.x,
        y: point.y,
        roadId: road.id
      });
      bridgeIndex += 1;
    }

    return nodes;
  }

  private roadLength(road: Road): number {
    let total = 0;
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total;
  }

  private pointAtDistance(road: Road, distance: number): { x: number; y: number } {
    if (road.points.length === 0) {
      return { x: 0, y: 0 };
    }
    if (road.points.length === 1) {
      return road.points[0];
    }

    let remaining = Math.max(0, distance);
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
      if (segmentLength <= 1e-6) {
        continue;
      }
      if (remaining <= segmentLength) {
        const t = remaining / segmentLength;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t
        };
      }
      remaining -= segmentLength;
    }

    return road.points[road.points.length - 1];
  }
}

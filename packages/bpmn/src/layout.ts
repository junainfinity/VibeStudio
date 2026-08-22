/**
 * Deterministic layered layout + BPMNDI emission (route "b").
 *
 * WHY hand-rolled rather than `bpmn-auto-layout` (which is installed): tested
 * empirically against 1.3.0 before this was written — it emits NO BPMNShape
 * for lanes (its source only knows `bpmn:Lane` as an entry in a default-size
 * lookup table and never walks laneSets), so every node would render outside
 * any visible swimlane, and in the probe it produced no BPMNEdge waypoints
 * either. Since the product requirement is "every node inside visible
 * swimlanes", route (a) is inadequate and is not imported at runtime at all,
 * keeping the runtime dependency-free.
 *
 * The IR makes a simple algorithm sufficient by construction: tasks are
 * 1-in/1-out, splits/joins are explicit and blocks are well-nested, so
 * longest-path layering over the graph *ignoring back edges* yields a clean
 * left-to-right flow. Back edges are exactly the edges that go against the
 * IR's own `topologicalOrder` (Kahn over the SCC DAG), so no separate DFS is
 * needed and the layering terminates on cyclic input by definition.
 *
 * Geometry:
 * - x: column per layer (task 100 wide, hGap 60), all lanes share columns;
 * - y: lanes stack top-to-bottom in IR order; within a lane, nodes that share
 *   a layer stack into rows; every shape is centred in its 100×80 cell, which
 *   keeps all coordinates integral;
 * - boundary events sit ON their host's bottom border (half in, half out),
 *   spread along it at a minimum centre-to-centre pitch of EVENT_SIZE + 4 so
 *   sibling shapes never overlap; when the host is too narrow for all its
 *   siblings at that pitch, the row keeps the pitch and extends past the
 *   host's RIGHT edge (still deterministic) instead of overlapping;
 * - a boundary event's exception edge leaves downward, turns inside the
 *   host's row gap (the drop height is clamped to stay inside the gap no
 *   matter how many siblings share it), runs horizontally there, then
 *   reaches the target's height through the vertical gap band LEFT of the
 *   target's column and enters the target's left border — the same
 *   shape-free bands back edges use — so exception edges cross no node
 *   shapes;
 * - back edges route through the vertical gap bands between columns and a
 *   horizontal track below all lanes, so they can never cross a node shape;
 * - forward edges are straight or L/Z-shaped with the bend in the gap band
 *   right of the source column. Known cosmetic limits: a forward edge that
 *   skips 2+ columns (a split→join "empty branch") runs its horizontal
 *   segment through intermediate columns at target height, and 4+ boundary
 *   events on one 100-wide host overflow far enough right that their shapes
 *   can reach into the vertical gap band edges route through.
 * - label DI is omitted; bpmn-js renders labels without it.
 */
import {
  buildIndex,
  isTask,
  topologicalOrder,
  type GraphIndex,
  type Node,
  type ProcessIR
} from "@vibestudio/ir";
import { dataAssociationsOf } from "./semantic.js";
import type { XmlWriter } from "./xml.js";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface DiagramLayout {
  /** One shape per IR lane, in IR order, spanning the full diagram width. */
  readonly laneShapes: ReadonlyArray<{ readonly id: string; readonly rect: Rect }>;
  /** Flow nodes in IR order, then data-object references when included. */
  readonly nodeShapes: ReadonlyArray<{ readonly id: string; readonly rect: Rect }>;
  /** Sequence flows in IR order, then data associations when included. */
  readonly edgeWaypoints: ReadonlyArray<{
    readonly id: string;
    readonly waypoints: ReadonlyArray<Point>;
  }>;
}

const TASK_WIDTH = 100;
const TASK_HEIGHT = 80;
const EVENT_SIZE = 36;
const GATEWAY_SIZE = 50;
const H_GAP = 60;
const V_GAP = 40;
const LANE_HEADER = 30;
const LANE_PAD = 20;
const COLUMN_WIDTH = TASK_WIDTH;
const ROW_HEIGHT = TASK_HEIGHT;
const COLUMN_PITCH = COLUMN_WIDTH + H_GAP;
const ROW_PITCH = ROW_HEIGHT + V_GAP;
const DATA_OBJECT_WIDTH = 36;
const DATA_OBJECT_HEIGHT = 50;
const DATA_OBJECT_PITCH = 80;
/** First loop track sits this far below the last lane. */
const LOOP_MARGIN = 20;
/** Parallel loop tracks are spread apart by this much. */
const LOOP_SPACING = 16;
/** How far below the boundary event its exception edge drops before turning. */
const BOUNDARY_DROP = 12;
const BOUNDARY_DROP_SPACING = 8;
/**
 * Minimum centre-to-centre distance between sibling boundary events on one
 * host: any closer and the 36px shapes would overlap.
 */
const BOUNDARY_MIN_PITCH = EVENT_SIZE + 4;
/** Exception-edge drop segments stay this clear of the next row's shapes. */
const BOUNDARY_GAP_CLEARANCE = 4;

function sizeOf(node: Node): { width: number; height: number } {
  if (isTask(node)) return { width: TASK_WIDTH, height: TASK_HEIGHT };
  if (node.type === "exclusiveGateway" || node.type === "parallelGateway" || node.type === "inclusiveGateway") {
    return { width: GATEWAY_SIZE, height: GATEWAY_SIZE };
  }
  return { width: EVENT_SIZE, height: EVENT_SIZE };
}

function centerX(rect: Rect): number {
  return rect.x + rect.width / 2;
}

function centerY(rect: Rect): number {
  return rect.y + rect.height / 2;
}

/** A positioned node plus the grid coordinates edge routing needs. */
interface Placed {
  readonly rect: Rect;
  readonly layer: number;
  /** Top of the 80-high row slot the node is centred in. */
  readonly slotTop: number;
}

/**
 * Longest-path layering that ignores back edges. An edge is "back" iff its
 * source comes after its target in the IR's deterministic topological order,
 * so processing nodes in that order sees every forward predecessor already
 * layered. Boundary events inherit host+1 through the analysis graph's
 * implicit host→boundary edge, which keeps their successors right of the host.
 */
function computeLayers(g: GraphIndex): Map<string, number> {
  const topo = topologicalOrder(g);
  const topoIndex = new Map<string, number>();
  topo.forEach((id, index) => topoIndex.set(id, index));
  const layers = new Map<string, number>();
  for (const id of topo) {
    const own = topoIndex.get(id) ?? 0;
    let layer = 0;
    for (const predecessor of g.pred.get(id) ?? []) {
      const predecessorIndex = topoIndex.get(predecessor);
      if (predecessorIndex !== undefined && predecessorIndex < own) {
        layer = Math.max(layer, (layers.get(predecessor) ?? 0) + 1);
      }
    }
    layers.set(id, layer);
  }
  return layers;
}

function placeInGrid(
  node: Node,
  layerOf: ReadonlyMap<string, number>,
  rowOf: ReadonlyMap<string, number>,
  laneTop: ReadonlyMap<string, number>,
  contentX: number
): Placed {
  const { width, height } = sizeOf(node);
  const layer = layerOf.get(node.id) ?? 0;
  const top = laneTop.get(node.lane);
  if (top === undefined) {
    throw new Error(`bpmn layout: node "${node.id}" references unknown lane "${node.lane}"`);
  }
  const slotTop = top + V_GAP + (rowOf.get(node.id) ?? 0) * ROW_PITCH;
  return {
    rect: {
      x: contentX + layer * COLUMN_PITCH + (COLUMN_WIDTH - width) / 2,
      y: slotTop + (ROW_HEIGHT - height) / 2,
      width,
      height
    },
    layer,
    slotTop
  };
}

function routeForward(source: Placed, target: Placed, contentX: number): Point[] {
  const sourceY = centerY(source.rect);
  const targetY = centerY(target.rect);
  const start = { x: source.rect.x + source.rect.width, y: sourceY };
  const end = { x: target.rect.x, y: targetY };
  if (sourceY === targetY) return [start, end];
  // Bend in the shape-free gap band right of the source column.
  const bendX = contentX + source.layer * COLUMN_PITCH + COLUMN_WIDTH + H_GAP / 2;
  return [start, { x: bendX, y: sourceY }, { x: bendX, y: targetY }, end];
}

/**
 * Back edges leave the source downward into its row gap, travel along the
 * shape-free gap bands (between columns, then below all lanes), and re-enter
 * the target's left border at its own height. Every segment lies in a band
 * that can contain no node shape, so loops never cross nodes.
 */
function routeLoop(source: Placed, target: Placed, contentX: number, loopY: number): Point[] {
  const sourceCenterX = centerX(source.rect);
  const targetCenterY = centerY(target.rect);
  const dropY = source.slotTop + ROW_HEIGHT + V_GAP / 2;
  const outX = contentX + source.layer * COLUMN_PITCH + COLUMN_WIDTH + H_GAP / 2;
  const inX = contentX + target.layer * COLUMN_PITCH - H_GAP / 2;
  return [
    { x: sourceCenterX, y: source.rect.y + source.rect.height },
    { x: sourceCenterX, y: dropY },
    { x: outX, y: dropY },
    { x: outX, y: loopY },
    { x: inX, y: loopY },
    { x: inX, y: targetCenterY },
    { x: target.rect.x, y: targetCenterY }
  ];
}

/**
 * A boundary event's exception edge leaves downward (BPMN reading convention
 * for exception paths) and turns inside the host's row gap: the drop height
 * is clamped so it stays in the gap regardless of how many siblings share it
 * (siblings spread apart while the gap allows, then compress). The
 * horizontal run lies in that row gap; the leg to the target's height runs
 * through the vertical gap band LEFT of the target's column (mirroring
 * routeLoop's `inX`) and enters the target's left border, so no segment can
 * cross a node shape — dropping at the target's centerX used to cut through
 * anything stacked between the host's row and the target.
 */
function routeFromBoundary(
  source: Placed,
  target: Placed,
  index: number,
  count: number,
  contentX: number
): Point[] {
  const sourceX = centerX(source.rect);
  const bottom = source.rect.y + source.rect.height;
  // Last shape-free y of the host's row gap.
  const gapEnd = source.slotTop + ROW_HEIGHT + V_GAP - BOUNDARY_GAP_CLEARANCE;
  const spacing =
    count > 1
      ? Math.min(
          BOUNDARY_DROP_SPACING,
          Math.max(0, Math.floor((gapEnd - bottom - BOUNDARY_DROP) / (count - 1)))
        )
      : 0;
  const dropY = Math.min(bottom + BOUNDARY_DROP + index * spacing, gapEnd);
  const inX = contentX + target.layer * COLUMN_PITCH - H_GAP / 2;
  const targetY = centerY(target.rect);
  return dedupe([
    { x: sourceX, y: bottom },
    { x: sourceX, y: dropY },
    { x: inX, y: dropY },
    { x: inX, y: targetY },
    { x: target.rect.x, y: targetY }
  ]);
}

/** Drop consecutive duplicate waypoints (degenerate zero-length segments). */
function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last === undefined || last.x !== point.x || last.y !== point.y) out.push(point);
  }
  return out;
}

function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`bpmn layout: missing ${what}: ${String(key)}`);
  return value;
}

export function computeLayout(ir: ProcessIR, includeDataObjects: boolean): DiagramLayout {
  const g = buildIndex(ir);
  const layerOf = computeLayers(g);

  // Columns are occupied by non-boundary nodes only; boundary events hang off
  // their host and take no column of their own.
  let maxLayer = 0;
  for (const node of ir.nodes) {
    if (node.type === "boundaryEvent") continue;
    maxLayer = Math.max(maxLayer, layerOf.get(node.id) ?? 0);
  }
  const columnCount = maxLayer + 1;
  const contentX = LANE_HEADER + LANE_PAD;
  const diagramWidth = contentX + columnCount * COLUMN_PITCH - H_GAP + LANE_PAD;

  // Data objects get a band ABOVE the lanes (nothing else lives there); loop
  // tracks run BELOW the lanes, so the two never collide.
  const hasDataBand = includeDataObjects && ir.data_objects.length > 0;
  const lanesTop = hasDataBand ? DATA_OBJECT_HEIGHT + 2 * V_GAP : 0;

  // Row assignment: within a lane, nodes sharing a layer stack top-down in IR
  // array order. Lanes are sized to their fullest column.
  const rowOf = new Map<string, number>();
  const laneRowCount = new Map<string, number>();
  for (const lane of ir.lanes) {
    const nextRowByLayer = new Map<number, number>();
    let rows = 1;
    for (const node of ir.nodes) {
      if (node.lane !== lane.id || node.type === "boundaryEvent") continue;
      const layer = layerOf.get(node.id) ?? 0;
      const row = nextRowByLayer.get(layer) ?? 0;
      nextRowByLayer.set(layer, row + 1);
      rowOf.set(node.id, row);
      rows = Math.max(rows, row + 1);
    }
    laneRowCount.set(lane.id, rows);
  }

  const laneShapes: Array<{ id: string; rect: Rect }> = [];
  const laneTop = new Map<string, number>();
  let cursorY = lanesTop;
  for (const lane of ir.lanes) {
    const rows = laneRowCount.get(lane.id) ?? 1;
    const height = rows * ROW_PITCH + V_GAP;
    laneTop.set(lane.id, cursorY);
    laneShapes.push({ id: lane.id, rect: { x: 0, y: cursorY, width: diagramWidth, height } });
    cursorY += height;
  }
  const lanesBottom = cursorY;

  const placed = new Map<string, Placed>();
  for (const node of ir.nodes) {
    if (node.type === "boundaryEvent") continue;
    placed.set(node.id, placeInGrid(node, layerOf, rowOf, laneTop, contentX));
  }
  for (const node of ir.nodes) {
    if (node.type !== "boundaryEvent") continue;
    const hostId = g.hostOf.get(node.id);
    const host = hostId !== undefined ? placed.get(hostId) : undefined;
    if (hostId === undefined || host === undefined) {
      // Malformed IR (boundary without a resolvable task host — an error the
      // validator reports). Grid placement keeps the layout total instead of
      // crashing mid-render.
      placed.set(node.id, placeInGrid(node, layerOf, rowOf, laneTop, contentX));
      continue;
    }
    // On the host's bottom border, half in / half out; multiple boundary
    // events spread evenly along it, in analysis-graph (= IR) order — but
    // never closer than BOUNDARY_MIN_PITCH centre-to-centre (the even spread
    // would overlap sibling shapes on a narrow host). When all siblings
    // cannot fit at that pitch, the row keeps the pitch, stays anchored at
    // the host's left edge and extends past its RIGHT edge deterministically.
    // (For a host wide enough for the even spread this reproduces the plain
    // width*(i+1)/(n+1) placement exactly.)
    const siblings = g.boundariesOf.get(hostId) ?? [node.id];
    const index = Math.max(0, siblings.indexOf(node.id));
    const pitch = Math.max(host.rect.width / (siblings.length + 1), BOUNDARY_MIN_PITCH);
    const firstCenterX = Math.max(
      host.rect.x + EVENT_SIZE / 2,
      centerX(host.rect) - ((siblings.length - 1) * pitch) / 2
    );
    const eventCenterX = Math.round(firstCenterX + index * pitch);
    placed.set(node.id, {
      rect: {
        x: eventCenterX - EVENT_SIZE / 2,
        y: host.rect.y + host.rect.height - EVENT_SIZE / 2,
        width: EVENT_SIZE,
        height: EVENT_SIZE
      },
      layer: host.layer,
      slotTop: host.slotTop
    });
  }

  const edgeWaypoints: Array<{ id: string; waypoints: Point[] }> = [];
  let loopIndex = 0;
  for (const edge of ir.edges) {
    const source = mustGet(placed, edge.from, `source node of edge "${edge.id}"`);
    const target = mustGet(placed, edge.to, `target node of edge "${edge.id}"`);
    const sourceNode = g.nodesById.get(edge.from);
    let waypoints: Point[];
    if (sourceNode !== undefined && sourceNode.type === "boundaryEvent") {
      const hostId = g.hostOf.get(edge.from);
      const siblings =
        hostId !== undefined ? (g.boundariesOf.get(hostId) ?? [edge.from]) : [edge.from];
      waypoints = routeFromBoundary(
        source,
        target,
        Math.max(0, siblings.indexOf(edge.from)),
        siblings.length,
        contentX
      );
    } else if (target.layer > source.layer) {
      waypoints = routeForward(source, target, contentX);
    } else {
      waypoints = routeLoop(
        source,
        target,
        contentX,
        lanesBottom + LOOP_MARGIN + loopIndex * LOOP_SPACING
      );
      loopIndex += 1;
    }
    edgeWaypoints.push({ id: edge.id, waypoints });
  }

  const nodeShapes: Array<{ id: string; rect: Rect }> = ir.nodes.map((node) => ({
    id: node.id,
    rect: mustGet(placed, node.id, "placed node").rect
  }));

  if (includeDataObjects) {
    const dataObjectRect = new Map<string, Rect>();
    ir.data_objects.forEach((dataObject, index) => {
      const rect: Rect = {
        x: contentX + index * DATA_OBJECT_PITCH,
        y: V_GAP,
        width: DATA_OBJECT_WIDTH,
        height: DATA_OBJECT_HEIGHT
      };
      dataObjectRect.set(dataObject.id, rect);
      nodeShapes.push({ id: dataObject.id, rect });
    });
    // Association DI mirrors the semantic layer association-for-association
    // (same shared source of truth), as straight lines node-top ↔ object-bottom.
    for (const node of ir.nodes) {
      const nodePlaced = placed.get(node.id);
      if (nodePlaced === undefined) continue;
      for (const association of dataAssociationsOf(node)) {
        const objectRect = dataObjectRect.get(association.dataObjectId);
        if (objectRect === undefined) continue;
        const nodeTop = { x: centerX(nodePlaced.rect), y: nodePlaced.rect.y };
        const objectBottom = { x: centerX(objectRect), y: objectRect.y + objectRect.height };
        edgeWaypoints.push({
          id: association.id,
          waypoints:
            association.direction === "in" ? [objectBottom, nodeTop] : [nodeTop, objectBottom]
        });
      }
    }
  }

  return { laneShapes, nodeShapes, edgeWaypoints };
}

/** Emit the bpmndi:BPMNDiagram subtree for a computed layout. */
export function writeDi(w: XmlWriter, ir: ProcessIR, layout: DiagramLayout): void {
  const processId = ir.process.id;
  w.open("bpmndi:BPMNDiagram", [["id", `${processId}_diagram`]]);
  w.open("bpmndi:BPMNPlane", [
    ["id", `${processId}_plane`],
    ["bpmnElement", processId]
  ]);
  for (const lane of layout.laneShapes) {
    w.open("bpmndi:BPMNShape", [
      ["id", `${lane.id}_di`],
      ["bpmnElement", lane.id],
      ["isHorizontal", "true"]
    ]);
    writeBounds(w, lane.rect);
    w.close("bpmndi:BPMNShape");
  }
  for (const shape of layout.nodeShapes) {
    w.open("bpmndi:BPMNShape", [
      ["id", `${shape.id}_di`],
      ["bpmnElement", shape.id]
    ]);
    writeBounds(w, shape.rect);
    w.close("bpmndi:BPMNShape");
  }
  for (const edge of layout.edgeWaypoints) {
    w.open("bpmndi:BPMNEdge", [
      ["id", `${edge.id}_di`],
      ["bpmnElement", edge.id]
    ]);
    for (const point of edge.waypoints) {
      w.leaf("di:waypoint", [
        ["x", point.x],
        ["y", point.y]
      ]);
    }
    w.close("bpmndi:BPMNEdge");
  }
  w.close("bpmndi:BPMNPlane");
  w.close("bpmndi:BPMNDiagram");
}

function writeBounds(w: XmlWriter, rect: Rect): void {
  w.leaf("dc:Bounds", [
    ["x", rect.x],
    ["y", rect.y],
    ["width", rect.width],
    ["height", rect.height]
  ]);
}

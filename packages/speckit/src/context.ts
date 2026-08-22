/**
 * Shared, precomputed view of a Process IR that every file generator draws
 * from. Built once per `generateSpecKit` call so all four kit files agree on
 * ordering (the IR package's loop-aware topological order) and on naming
 * (id -> "Name (id)" labels). Everything here is a pure lookup over the input
 * document — no clocks, no randomness, no key-order enumeration — which is
 * what makes the kit byte-identical across runs and machines.
 */
import {
  buildIndex,
  isGateway,
  isTask,
  nearestWorkAncestors,
  nearestWorkDescendants,
  topologicalOrder,
  type DataObject,
  type GraphIndex,
  type Lane,
  type Node,
  type ProcessIR,
  type Task
} from "@vibestudio/ir";
import { oneLine } from "./markdown.js";

export interface SpecContext {
  readonly ir: ProcessIR;
  readonly g: GraphIndex;
  /** All node ids in loop-aware topological order (merge -> body -> exit within loops). */
  readonly order: readonly string[];
  readonly lanesById: ReadonlyMap<string, Lane>;
  readonly dataById: ReadonlyMap<string, DataObject>;
}

export function buildContext(ir: ProcessIR): SpecContext {
  const g = buildIndex(ir);
  const lanesById = new Map<string, Lane>();
  for (const lane of ir.lanes) if (!lanesById.has(lane.id)) lanesById.set(lane.id, lane);
  const dataById = new Map<string, DataObject>();
  for (const d of ir.data_objects) if (!dataById.has(d.id)) dataById.set(d.id, d);
  return { ir, g, order: topologicalOrder(g), lanesById, dataById };
}

/**
 * The generated-from banner every kit file starts with. The kit is a build
 * artifact of the IR — editing it by hand would silently fork the source of
 * truth, so the banner says so up front.
 */
export function banner(ir: ProcessIR): string {
  return `<!-- generated from Process IR '${ir.process.id}' v${ir.ir_version} — do not edit by hand -->`;
}

/**
 * "Name (id)" for a node id; falls back to the bare id so we never print
 * 'undefined'. Names are IR free text, so every label is one-lined here —
 * labels land in headings and single-line list items throughout the kit.
 */
export function nodeLabel(ctx: SpecContext, id: string): string {
  const n = ctx.g.nodesById.get(id);
  return n ? `${oneLine(n.name)} (${n.id})` : id;
}

/** "Name (id)" for a data object id, with the same bare-id fallback. */
export function dataLabel(ctx: SpecContext, id: string): string {
  const d = ctx.dataById.get(id);
  return d ? `${oneLine(d.name)} (${d.id})` : id;
}

/** "Name (kind)" for a lane id — the kind is what tells an implementer UI vs automation vs integration. */
export function laneLabel(ctx: SpecContext, id: string): string {
  const lane = ctx.lanesById.get(id);
  return lane ? `${oneLine(lane.name)} (${lane.kind})` : id;
}

/**
 * Labels of the nearest work node(s) — tasks/events, looking through gateways —
 * behind (`back`) or ahead of (`forward`) the given node. A gateway routes but
 * does no work, so contracts and branch targets are always described in terms
 * of the work they connect. Falls back to the node's own label when nothing
 * resolves, so a degenerate graph still renders something readable.
 */
export function workLabels(ctx: SpecContext, id: string, dir: "back" | "forward"): string {
  const n = ctx.g.nodesById.get(id);
  if (!n || !isGateway(n)) return nodeLabel(ctx, id);
  const near = dir === "back" ? nearestWorkAncestors(ctx.g, id) : nearestWorkDescendants(ctx.g, id);
  if (near.length === 0) return nodeLabel(ctx, id);
  return near.map((w) => nodeLabel(ctx, w)).join(", ");
}

/** Nodes in topological order; ids not in the graph cannot occur (order comes from the graph). */
export function nodesInOrder(ctx: SpecContext): Node[] {
  const out: Node[] = [];
  for (const id of ctx.order) {
    const n = ctx.g.nodesById.get(id);
    if (n) out.push(n);
  }
  return out;
}

/** Task nodes in topological order — the spine of spec.md and the build order of plan.md. */
export function tasksInOrder(ctx: SpecContext): Task[] {
  return nodesInOrder(ctx).filter(isTask);
}

/**
 * Resolve an id from `applies_to` / `affects` lists, which share one namespace
 * across nodes, lanes, data objects and edges. Unknown ids render as-is: a
 * dangling reference is the validator's problem, not a rendering crash.
 */
export function anyLabel(ctx: SpecContext, id: string): string {
  const n = ctx.g.nodesById.get(id);
  if (n) return `${oneLine(n.name)} (${n.id})`;
  const lane = ctx.lanesById.get(id);
  if (lane) return `${oneLine(lane.name)} (${lane.id})`;
  const d = ctx.dataById.get(id);
  if (d) return `${oneLine(d.name)} (${d.id})`;
  const e = ctx.g.edgesById.get(id);
  if (e) return e.name ? `${oneLine(e.name)} (${e.id})` : e.id;
  return id;
}

/** "kind" or "kind (detail)" for trigger/result definitions; the detail is free text and rendered inline. */
export function kindWithDetail(def: { kind: string; detail?: string }): string {
  return def.detail ? `${def.kind} (${oneLine(def.detail)})` : def.kind;
}

import type { GraphIndex } from "../graph.js";
import type { Edge, Node, ProcessIR } from "../types.js";
import type { ElementRef, Mode, RawFinding } from "./catalog.js";

export interface RuleContext {
  ir: ProcessIR;
  g: GraphIndex;
  mode: Mode;
}

export type RuleFn = (ctx: RuleContext) => RawFinding[];

// ---- path / element helpers -------------------------------------------------

export function nodePath(g: GraphIndex, id: string): string {
  const i = g.nodeIndex.get(id);
  return i === undefined ? "/nodes" : `/nodes/${i}`;
}

export function edgePath(g: GraphIndex, id: string): string {
  const i = g.edgeIndex.get(id);
  return i === undefined ? "/edges" : `/edges/${i}`;
}

export function nodeRef(n: Node): ElementRef {
  return { kind: "node", id: n.id };
}

export function edgeRef(e: Edge): ElementRef {
  return { kind: "edge", id: e.id };
}

/** "serviceTask 'Validate checkout' (checkout-validate)" */
export function describeNode(n: Node): string {
  const kind = "direction" in n ? `${n.type} ${n.direction}` : n.type;
  return `${kind} '${n.name}' (${n.id})`;
}

/** "edge cart-review -> checkout-validate (e-2)" */
export function describeEdge(e: Edge): string {
  return `edge ${e.from} -> ${e.to} (${e.id})`;
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

export function sortedIds(xs: Iterable<string>): string[] {
  return [...xs].sort();
}

/**
 * Tiny IR builder for adversarial shape tests. Every task reads/writes the single
 * data object "d", every edge carries it, so data rules stay quiet unless a test
 * deliberately breaks them.
 */
import type { Edge, Node, ProcessIR } from "../src/types.js";

type NodeInit = Partial<Node> & { id: string; type: Node["type"] };

export function start(id = "s", lane = "sys"): NodeInit {
  return { id, type: "startEvent", name: id, lane, data: { writes: ["d"] } } as NodeInit;
}
export function end(id = "end", lane = "sys", kind?: "none" | "terminate" | "error"): NodeInit {
  return { id, type: "endEvent", name: id, lane, ...(kind ? { result: { kind } } : {}) } as NodeInit;
}
export function task(id: string, lane = "sys", type: Node["type"] = "serviceTask"): NodeInit {
  return {
    id,
    type,
    name: id,
    lane,
    data: { reads: ["d"], writes: ["d"] },
    acceptance_criteria: [{ id: "AC-1", given: "g", when: "w", then: "t" }],
    ...(type === "serviceTask" || type === "sendTask" || type === "receiveTask" ? { integration: { system: "x" } } : {})
  } as NodeInit;
}
export function user(id: string, lane = "hum"): NodeInit {
  return task(id, lane, "userTask");
}
export function gw(id: string, type: "exclusiveGateway" | "parallelGateway" | "inclusiveGateway", direction: "split" | "join", pairs_with?: string, lane = "sys"): NodeInit {
  return { id, type, name: id, lane, direction, ...(pairs_with ? { pairs_with } : {}) } as NodeInit;
}
export const xs = (id: string) => gw(id, "exclusiveGateway", "split");
export const xj = (id: string, pairs?: string) => gw(id, "exclusiveGateway", "join", pairs);
export const ps = (id: string) => gw(id, "parallelGateway", "split");
export const pj = (id: string, pairs: string) => gw(id, "parallelGateway", "join", pairs);
export const os = (id: string) => gw(id, "inclusiveGateway", "split");
export const oj = (id: string, pairs: string) => gw(id, "inclusiveGateway", "join", pairs);
export function boundary(id: string, host: string, kind: "error" | "timer" | "message" = "error", interrupting = true, lane = "sys"): NodeInit {
  return { id, type: "boundaryEvent", name: id, lane, attached_to: host, trigger: { kind }, interrupting } as NodeInit;
}

let edgeCounter = 0;
export function e(from: string, to: string, opts: Partial<Edge> = {}): Edge {
  edgeCounter++;
  return { id: `e${edgeCounter}-${from}-${to}`, from, to, data_contract: { carries: ["d"] }, ...opts } as Edge;
}
/** Conditional edge (natural-language condition). */
export const cond = (from: string, to: string, expression = "cond", extra: Partial<Edge> = {}) => e(from, to, { condition: { expression }, ...extra });
/** Default edge. */
export const dflt = (from: string, to: string, extra: Partial<Edge> = {}) => e(from, to, { is_default: true, ...extra });

export function ir(nodes: NodeInit[], edges: Edge[], extra: Partial<ProcessIR> = {}): ProcessIR {
  edgeCounter = 0;
  return {
    ir_version: "1.0",
    process: { id: "p", name: "P" },
    lanes: [
      { id: "sys", name: "System", kind: "system" },
      { id: "hum", name: "Human", kind: "human" }
    ],
    data_objects: [{ id: "d", name: "D", schema: { type: "object" } }],
    nodes: nodes as Node[],
    edges,
    ...extra
  };
}

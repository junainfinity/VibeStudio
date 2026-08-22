/**
 * Topology rules: start/end presence, orphans, in/out-degree per node kind,
 * reachability from start, co-reachability to end, self-loops, duplicate edges.
 * Degrees are counted over explicit sequence flows; reachability uses the
 * analysis graph (which adds host -> boundary-event edges).
 */
import { reachableFrom } from "../graph.js";
import { isGateway, isTask, type Node } from "../types.js";
import type { RawFinding } from "./catalog.js";
import { describeEdge, describeNode, edgePath, edgeRef, nodePath, nodeRef, type RuleContext, type RuleFn } from "./context.js";

interface Card {
  in: [number, number]; // [min, max]; max = Infinity for unbounded
  out: [number, number];
}

function expectedCard(n: Node): Card | undefined {
  switch (n.type) {
    case "startEvent":
      return { in: [0, 0], out: [1, 1] };
    case "endEvent":
      return { in: [1, 1], out: [0, 0] };
    case "intermediateCatchEvent":
      return { in: [1, 1], out: [1, 1] };
    case "boundaryEvent":
      return { in: [0, 0], out: [1, 1] };
    default:
      if (isTask(n)) return { in: [1, 1], out: [1, 1] };
      if (isGateway(n)) return n.direction === "split" ? { in: [1, 1], out: [2, Infinity] } : { in: [2, Infinity], out: [1, 1] };
      return undefined;
  }
}

function fmtRange([min, max]: [number, number]): string {
  if (min === max) return `exactly ${min}`;
  if (max === Infinity) return `at least ${min}`;
  return `${min}-${max}`;
}

function cardFix(n: Node, dir: "incoming" | "outgoing", actual: number): string {
  if (n.type === "startEvent" && dir === "incoming")
    return "Start events cannot have incoming flows. If this is a loop re-entry point, insert an exclusiveGateway join after the start event and loop back into that.";
  if (n.type === "startEvent" && dir === "outgoing")
    return actual === 0 ? "Connect the start event to the first node with an edge." : "A start event has one outgoing flow. Insert a gateway split right after it if the process branches immediately.";
  if (n.type === "endEvent" && dir === "incoming")
    return actual === 0 ? "Connect a flow into the end event or remove it." : "An end event has one incoming flow. Insert an exclusiveGateway join before it, or use one end event per branch.";
  if (n.type === "endEvent" && dir === "outgoing") return "End events cannot have outgoing flows. Remove the edge or change the node to a task/intermediate event.";
  if (n.type === "boundaryEvent" && dir === "incoming") return "Boundary events cannot have incoming flows; they are attached to a task via attached_to.";
  if (n.type === "boundaryEvent" && dir === "outgoing") return "Give the boundary event exactly one outgoing edge describing the exception path.";
  if (isGateway(n)) {
    if (n.direction === "split" && dir === "outgoing")
      return actual < 2 ? "A split needs at least 2 outgoing flows. Add the missing branch, or remove the gateway if there is only one path." : "";
    if (n.direction === "split" && dir === "incoming")
      return actual === 0 ? "Connect a flow into the split gateway." : "A split has exactly 1 incoming flow. Put an exclusiveGateway join in front of it if several flows converge here, or set direction to 'join' if this gateway is meant to merge.";
    if (n.direction === "join" && dir === "incoming")
      return actual < 2 ? "A join needs at least 2 incoming flows. Route the branches into it, or remove the gateway." : "";
    if (n.direction === "join" && dir === "outgoing")
      return actual === 0 ? "Connect the join to the next node." : "A join has exactly 1 outgoing flow. Add a split gateway after it if the flow branches again.";
  }
  // tasks / intermediate events
  if (dir === "incoming")
    return actual === 0
      ? "Connect a flow into this node."
      : "Tasks and intermediate events have exactly one incoming flow. Insert an exclusiveGateway join (merge) before it — or a parallelGateway join if all incoming flows must complete first.";
  return actual === 0
    ? "Connect this node to the next node (or to an end event)."
    : "Tasks and intermediate events have exactly one outgoing flow. Insert a gateway split after it (exclusiveGateway for either/or, parallelGateway for both, inclusiveGateway for one-or-more).";
}

export const graphNoStartOrEnd: RuleFn = ({ ir }) => {
  const out: RawFinding[] = [];
  const starts = ir.nodes.filter((n) => n.type === "startEvent").length;
  const ends = ir.nodes.filter((n) => n.type === "endEvent").length;
  if (starts === 0)
    out.push({ rule: "graph.no-start-or-end", message: "The process has no startEvent.", path: "/nodes", fix: "Add a startEvent (with its trigger) and connect it to the first task or gateway." });
  if (ends === 0)
    out.push({ rule: "graph.no-start-or-end", message: "The process has no endEvent.", path: "/nodes", fix: "Add at least one endEvent and route every terminal path into an end event." });
  return out;
};

/** Ids of nodes with neither incoming nor outgoing explicit edges. */
export function orphanIds(ctx: RuleContext): Set<string> {
  const { ir, g } = ctx;
  const s = new Set<string>();
  for (const n of ir.nodes) {
    if ((g.inEdges.get(n.id)?.length ?? 0) === 0 && (g.outEdges.get(n.id)?.length ?? 0) === 0) s.add(n.id);
  }
  return s;
}

export const graphOrphan: RuleFn = (ctx) => {
  const { g } = ctx;
  return [...orphanIds(ctx)].map((id) => {
    const n = g.nodesById.get(id)!;
    return {
      rule: "graph.orphan" as const,
      message: `${describeNode(n)} is not connected to anything.`,
      path: nodePath(g, id),
      element: nodeRef(n),
      fix: n.type === "boundaryEvent" ? "Give the boundary event an outgoing edge, or remove it." : "Connect it into the flow with edges (in and out as appropriate for its kind), or remove it."
    };
  });
};

export const cardMismatch: RuleFn = (ctx) => {
  const { ir, g } = ctx;
  const orphans = orphanIds(ctx);
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (orphans.has(n.id)) continue;
    const exp = expectedCard(n);
    if (!exp) continue;
    const inN = g.inEdges.get(n.id)?.length ?? 0;
    const outN = g.outEdges.get(n.id)?.length ?? 0;
    if (inN < exp.in[0] || inN > exp.in[1]) {
      out.push({
        rule: "card.mismatch",
        message: `${describeNode(n)} has ${inN} incoming flow(s); expected ${fmtRange(exp.in)}.`,
        path: nodePath(g, n.id),
        element: nodeRef(n),
        fix: cardFix(n, "incoming", inN),
        data: { direction: "in", actual: inN, expected: exp.in }
      });
    }
    if (outN < exp.out[0] || outN > exp.out[1]) {
      out.push({
        rule: "card.mismatch",
        message: `${describeNode(n)} has ${outN} outgoing flow(s); expected ${fmtRange(exp.out)}.`,
        path: nodePath(g, n.id),
        element: nodeRef(n),
        fix: cardFix(n, "outgoing", outN),
        data: { direction: "out", actual: outN, expected: exp.out }
      });
    }
  }
  return out;
};

export const graphUnreachable: RuleFn = (ctx) => {
  const { ir, g } = ctx;
  const orphans = orphanIds(ctx);
  const starts = ir.nodes.filter((n) => n.type === "startEvent").map((n) => n.id);
  if (starts.length === 0) return []; // graph.no-start-or-end covers it
  const reach = reachableFrom(g, starts);
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (orphans.has(n.id) || reach.has(n.id)) continue;
    out.push({
      rule: "graph.unreachable",
      message: `${describeNode(n)} cannot be reached from any start event.`,
      path: nodePath(g, n.id),
      element: nodeRef(n),
      fix:
        n.type === "boundaryEvent"
          ? "Boundary events are reached through their host: set attached_to to a task that is on the main flow."
          : n.type === "startEvent"
            ? "Start events are roots; this should not happen."
            : "Connect it to the main flow (add the missing incoming edge from a reachable node — or, if it hangs off a boundary event, fix that event's attached_to), or remove it."
    });
  }
  return out;
};

export const graphNoPathToEnd: RuleFn = (ctx) => {
  const { ir, g } = ctx;
  const orphans = orphanIds(ctx);
  const ends = ir.nodes.filter((n) => n.type === "endEvent").map((n) => n.id);
  if (ends.length === 0) return []; // graph.no-start-or-end covers it
  const coReach = reachableFrom(g, ends, { reverse: true });
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (orphans.has(n.id) || coReach.has(n.id)) continue;
    out.push({
      rule: "graph.no-path-to-end",
      message: `${describeNode(n)} has no path to any end event.`,
      path: nodePath(g, n.id),
      element: nodeRef(n),
      fix: "Continue the flow from this node (or from the loop it is in, via an exclusiveGateway split) until it reaches an endEvent."
    });
  }
  return out;
};

export const edgeSelfLoop: RuleFn = ({ ir, g }) =>
  ir.edges
    .filter((e) => e.from === e.to)
    .map((e) => ({
      rule: "edge.self-loop" as const,
      message: `${describeEdge(e)} loops a node onto itself.`,
      path: edgePath(g, e.id),
      element: edgeRef(e),
      fix: "Model repetition explicitly: exclusiveGateway join before the node, exclusiveGateway split after it with a conditional edge back to the join and another edge forward."
    }));

export const edgeDuplicate: RuleFn = ({ ir, g }) => {
  const seen = new Map<string, string>();
  const out: RawFinding[] = [];
  for (const e of ir.edges) {
    const key = `${e.from} ${e.to}`;
    const first = seen.get(key);
    if (first) {
      out.push({
        rule: "edge.duplicate",
        message: `${describeEdge(e)} duplicates edge '${first}' (same source and target).`,
        path: edgePath(g, e.id),
        element: edgeRef(e),
        fix: "Keep a single edge between two nodes; combine conditions with 'or' if both branches lead to the same place."
      });
    } else {
      seen.set(key, e.id);
    }
  }
  return out;
};

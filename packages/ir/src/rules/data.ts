/**
 * Data-flow rules. Availability is purely local and declarative:
 *
 *   incoming(u) = carries of u's incoming edges — union for tasks/events/splits
 *                 and parallel joins, INTERSECTION for exclusive/inclusive joins
 *                 (only one branch is guaranteed to have run);
 *                 for a boundary event: incoming(host) — the host's inputs, not its
 *                 writes, because the host may not have completed when the event fires.
 *   available(u) = writes(u) ∪ incoming(u)
 *
 * Every edge may only carry what is available at its source, and every node may
 * only read what arrives on its incoming edge(s). This catches hallucinated data
 * flow without any transitive analysis.
 */
import { nearestWorkAncestors, type GraphIndex } from "../graph.js";
import { isGateway, isTask, type Node } from "../types.js";
import type { RawFinding } from "./catalog.js";
import { describeEdge, describeNode, edgePath, edgeRef, nodePath, nodeRef, type RuleFn } from "./context.js";

function writesOf(n: Node): Set<string> {
  const d = (n as { data?: { writes?: string[] } }).data;
  return new Set(d?.writes ?? []);
}

function readsOf(n: Node): string[] {
  const d = (n as { data?: { reads?: string[] } }).data;
  return d?.reads ?? [];
}

export function incomingData(g: GraphIndex, n: Node): Set<string> {
  if (n.type === "boundaryEvent") {
    // The host may not have completed when the event fires, so only the host's INPUTS are guaranteed.
    const host = g.nodesById.get(n.attached_to);
    return host ? incomingData(g, host) : new Set();
  }
  const ins = g.inEdges.get(n.id) ?? [];
  if (ins.length === 0) return new Set();
  const sets = ins.map((e) => new Set(e.data_contract?.carries ?? []));
  const intersect = isGateway(n) && n.direction === "join" && n.type !== "parallelGateway";
  if (intersect) {
    let acc = sets[0]!;
    for (const s of sets.slice(1)) acc = new Set([...acc].filter((x) => s.has(x)));
    return acc;
  }
  return new Set(sets.flatMap((s) => [...s]));
}

export function availableData(g: GraphIndex, n: Node): Set<string> {
  return new Set([...writesOf(n), ...incomingData(g, n)]);
}

export const edgeContractEmpty: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const e of ir.edges) {
    if ((e.data_contract?.carries?.length ?? 0) > 0) continue;
    const src = g.nodesById.get(e.from);
    const dst = g.nodesById.get(e.to);
    const intoEnd = dst?.type === "endEvent";
    // Name the work upstream of a gateway rather than the gateway itself.
    const upstream = src && isGateway(src) ? nearestWorkAncestors(g, src.id).map((id) => g.nodesById.get(id)?.name ?? id) : [];
    const fromLabel = upstream.length ? upstream.map((n) => `'${n}'`).join(" / ") : `'${src?.name ?? e.from}'`;
    out.push({
      rule: "edge.contract-empty",
      message: `${describeEdge(e)} carries no data.`,
      path: `${edgePath(g, e.id)}/data_contract/carries`,
      element: edgeRef(e),
      fix: intoEnd
        ? `List the process outputs that exist when it ends at '${dst?.name ?? e.to}' in data_contract.carries (they become the process result contract).`
        : `List the data objects that are available after ${fromLabel} and needed by '${dst?.name ?? e.to}' in data_contract.carries (add invariants that hold at this point).`,
      question: intoEnd
        ? `When the process ends at '${dst?.name ?? e.to}', what is the final result/output?`
        : `What information flows from ${fromLabel} to '${dst?.name ?? e.to}'?`
    });
  }
  return out;
};

export const dataNotAvailable: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const e of ir.edges) {
    const src = g.nodesById.get(e.from);
    if (!src || !g.nodesById.has(e.to)) continue; // ref.unknown
    const avail = availableData(g, src);
    (e.data_contract?.carries ?? []).forEach((x, j) => {
      if (avail.has(x)) return;
      const isMerge = isGateway(src) && src.direction === "join" && src.type !== "parallelGateway";
      out.push({
        rule: "data.not-available",
        message: `${describeEdge(e)} carries '${x}', but ${describeNode(src)} neither writes it nor receives it${isMerge ? " on every incoming flow" : ""} (available here: ${[...avail].sort().join(", ") || "nothing"}).`,
        path: `${edgePath(g, e.id)}/data_contract/carries/${j}`,
        element: edgeRef(e),
        fix: isMerge
          ? `An ${src.type} join only guarantees data present on ALL incoming flows. Carry '${x}' on each edge into '${src.id}', or drop it from this edge (and re-derive it later).`
          : isTask(src)
            ? `If '${src.name}' produces '${x}', add it to its data.writes; otherwise carry '${x}' on the edge into '${src.id}' (from the node that writes it), or remove it here.`
            : src.type === "startEvent"
              ? `A start event only carries its trigger payload: add '${x}' to the start event's data.writes if the trigger provides it, otherwise remove it here.`
              : src.type === "boundaryEvent"
                ? `A boundary event may carry what its host task RECEIVED plus its own payload (the host may not have finished, so its writes are not guaranteed): add '${x}' to the boundary event's data.writes if the event provides it, otherwise remove it here.`
                : `Carry '${x}' on the edge into '${src.id}' (from the node that writes it), or remove it here.`,
        data: { missing: x, available: [...avail].sort() }
      });
    });
  }
  return out;
};

export const dataReadUnavailable: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    const reads = readsOf(n);
    if (reads.length === 0) continue;
    if (isGateway(n) || n.type === "boundaryEvent" || n.type === "startEvent") continue; // schema forbids reads there
    const incoming = incomingData(g, n);
    reads.forEach((x, j) => {
      if (incoming.has(x)) return;
      out.push({
        rule: "data.read-unavailable",
        message: `${describeNode(n)} reads '${x}', but no incoming flow carries it (arriving: ${[...incoming].sort().join(", ") || "nothing"}).`,
        path: `${nodePath(g, n.id)}/data/reads/${j}`,
        element: nodeRef(n),
        fix: `Add '${x}' to data_contract.carries of the edge(s) into '${n.id}' — making sure an upstream node writes it — or remove it from reads.`,
        data: { missing: x, arriving: [...incoming].sort() }
      });
    });
  }
  return out;
};

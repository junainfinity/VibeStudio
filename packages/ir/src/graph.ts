/**
 * Graph helpers over a Process IR. Everything here is deterministic and
 * side-effect free; the validator rules build on these primitives.
 *
 * The "analysis graph" is the sequence-flow graph plus one implicit edge from
 * each boundary event's host task to the boundary event, so that reachability
 * and region checks treat exception paths as part of the flow they escape from.
 */
import type { Edge, Node, ProcessIR } from "./types.js";
import { isTask } from "./types.js";

export interface GraphIndex {
  ir: ProcessIR;
  nodesById: Map<string, Node>;
  edgesById: Map<string, Edge>;
  /** Explicit sequence flows only. */
  outEdges: Map<string, Edge[]>;
  inEdges: Map<string, Edge[]>;
  /** Analysis successors/predecessors: sequence flows + host->boundary implicit edges. */
  succ: Map<string, string[]>;
  pred: Map<string, string[]>;
  /** boundary event id -> host task id (only for resolvable, task-typed hosts) */
  hostOf: Map<string, string>;
  /** host task id -> boundary event ids */
  boundariesOf: Map<string, string[]>;
  nodeIndex: Map<string, number>;
  edgeIndex: Map<string, number>;
}

export function buildIndex(ir: ProcessIR): GraphIndex {
  const nodesById = new Map<string, Node>();
  const nodeIndex = new Map<string, number>();
  ir.nodes.forEach((n, i) => {
    if (!nodesById.has(n.id)) {
      nodesById.set(n.id, n);
      nodeIndex.set(n.id, i);
    }
  });
  const edgesById = new Map<string, Edge>();
  const edgeIndex = new Map<string, number>();
  const outEdges = new Map<string, Edge[]>();
  const inEdges = new Map<string, Edge[]>();
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  for (const n of nodesById.values()) {
    outEdges.set(n.id, []);
    inEdges.set(n.id, []);
    succ.set(n.id, []);
    pred.set(n.id, []);
  }
  ir.edges.forEach((e, i) => {
    if (!edgesById.has(e.id)) {
      edgesById.set(e.id, e);
      edgeIndex.set(e.id, i);
    }
    // Only index edges whose endpoints resolve; dangling refs are reported by ref rules.
    if (nodesById.has(e.from) && nodesById.has(e.to)) {
      outEdges.get(e.from)!.push(e);
      inEdges.get(e.to)!.push(e);
      succ.get(e.from)!.push(e.to);
      pred.get(e.to)!.push(e.from);
    }
  });
  const hostOf = new Map<string, string>();
  const boundariesOf = new Map<string, string[]>();
  for (const n of nodesById.values()) {
    if (n.type === "boundaryEvent") {
      const host = nodesById.get(n.attached_to);
      if (host && isTask(host)) {
        hostOf.set(n.id, host.id);
        if (!boundariesOf.has(host.id)) boundariesOf.set(host.id, []);
        boundariesOf.get(host.id)!.push(n.id);
        succ.get(host.id)!.push(n.id);
        pred.get(n.id)!.push(host.id);
      }
    }
  }
  return { ir, nodesById, edgesById, outEdges, inEdges, succ, pred, hostOf, boundariesOf, nodeIndex, edgeIndex };
}

/** Forward reachability over the analysis graph from a set of roots (roots included). */
export function reachableFrom(
  g: GraphIndex,
  roots: Iterable<string>,
  opts: { skip?: ReadonlySet<string>; reverse?: boolean; includeRoots?: boolean } = {}
): Set<string> {
  const adj = opts.reverse ? g.pred : g.succ;
  const skip = opts.skip ?? new Set<string>();
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const r of roots) {
    if (skip.has(r)) continue;
    if (!seen.has(r)) {
      seen.add(r);
      stack.push(r);
    }
  }
  while (stack.length) {
    const cur = stack.pop()!;
    for (const nxt of adj.get(cur) ?? []) {
      if (skip.has(nxt) || seen.has(nxt)) continue;
      seen.add(nxt);
      stack.push(nxt);
    }
  }
  if (opts.includeRoots === false) for (const r of roots) seen.delete(r);
  return seen;
}

/**
 * Nodes reachable from `root` without passing through `skip`, EXCLUDING the root
 * unless it is re-entered via a cycle. Used for gateway region checks.
 */
export function reachableExcludingRoot(g: GraphIndex, root: string, skip: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [...(g.succ.get(root) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (skip.has(cur) || seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of g.succ.get(cur) ?? []) stack.push(nxt);
  }
  return seen;
}

/** Tarjan's SCC over the analysis graph. Returns components in deterministic order (by first node index). */
export function stronglyConnectedComponents(g: GraphIndex): string[][] {
  const ids = [...g.nodesById.keys()];
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comps: string[][] = [];
  let counter = 0;

  const strong = (v: string): void => {
    // iterative Tarjan to avoid recursion limits on large graphs
    type Frame = { node: string; iter: number };
    const frames: Frame[] = [{ node: v, iter: 0 }];
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    while (frames.length) {
      const f = frames[frames.length - 1]!;
      const succs = g.succ.get(f.node) ?? [];
      if (f.iter < succs.length) {
        const w = succs[f.iter++]!;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          frames.push({ node: w, iter: 0 });
        } else if (onStack.has(w)) {
          low.set(f.node, Math.min(low.get(f.node)!, index.get(w)!));
        }
      } else {
        frames.pop();
        if (frames.length) {
          const parent = frames[frames.length - 1]!.node;
          low.set(parent, Math.min(low.get(parent)!, low.get(f.node)!));
        }
        if (low.get(f.node) === index.get(f.node)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== f.node);
          comps.push(comp);
        }
      }
    }
  };

  for (const id of ids) if (!index.has(id)) strong(id);
  // Deterministic order: components by the min node index of their members; members in flow order.
  const byIdx = (a: string, b: string) => (g.nodeIndex.get(a) ?? 0) - (g.nodeIndex.get(b) ?? 0);
  for (const c of comps) c.sort(byIdx);
  comps.sort((a, b) => byIdx(a[0]!, b[0]!));
  return comps.map((c) => (c.length > 1 ? flowOrderWithin(g, c) : c));
}

/**
 * Orders the members of a cyclic component by BFS from its entry nodes (members
 * with a predecessor outside the component; falls back to the lowest-index member),
 * so loops read merge → body → exit-split rather than in document order.
 */
function flowOrderWithin(g: GraphIndex, comp: string[]): string[] {
  const inComp = new Set(comp);
  const entries = comp.filter((n) => (g.pred.get(n) ?? []).some((p) => !inComp.has(p)));
  const queue = entries.length ? [...entries] : [comp[0]!];
  const seen = new Set(queue);
  const order: string[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const nxt of g.succ.get(cur) ?? []) {
      if (inComp.has(nxt) && !seen.has(nxt)) {
        seen.add(nxt);
        queue.push(nxt);
      }
    }
  }
  for (const n of comp) if (!seen.has(n)) order.push(n); // unreachable-from-entry members (should not happen in an SCC)
  return order;
}

/** True if the component is a real cycle (size > 1, or a self-loop). */
export function isCyclicComponent(g: GraphIndex, comp: string[]): boolean {
  if (comp.length > 1) return true;
  const only = comp[0]!;
  return (g.succ.get(only) ?? []).includes(only);
}

/** Topological order of the analysis graph ignoring back edges (Kahn on the DAG of SCCs). */
export function topologicalOrder(g: GraphIndex): string[] {
  const comps = stronglyConnectedComponents(g);
  const compOf = new Map<string, number>();
  comps.forEach((c, i) => c.forEach((n) => compOf.set(n, i)));
  const indeg = new Array<number>(comps.length).fill(0);
  const cadj: Set<number>[] = comps.map(() => new Set<number>());
  for (const [u, vs] of g.succ) {
    for (const v of vs) {
      const cu = compOf.get(u)!;
      const cv = compOf.get(v)!;
      if (cu !== cv && !cadj[cu]!.has(cv)) {
        cadj[cu]!.add(cv);
        indeg[cv]!++;
      }
    }
  }
  const ready: number[] = [];
  indeg.forEach((d, i) => d === 0 && ready.push(i));
  const order: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => a - b);
    const c = ready.shift()!;
    order.push(...comps[c]!);
    for (const nxt of [...cadj[c]!].sort((a, b) => a - b)) {
      indeg[nxt]!--;
      if (indeg[nxt] === 0) ready.push(nxt);
    }
  }
  return order;
}

/**
 * Nearest task/event ancestors of a node, looking back through gateways
 * (which are routing, not work). Used by the packet builder to name the
 * upstream units a task's input contract comes from. Deterministic order.
 */
export function nearestWorkAncestors(g: GraphIndex, id: string): string[] {
  return nearestWork(g, id, "pred");
}

/** Nearest task/event descendants of a node, looking forward through gateways. */
export function nearestWorkDescendants(g: GraphIndex, id: string): string[] {
  return nearestWork(g, id, "succ");
}

function nearestWork(g: GraphIndex, id: string, dir: "pred" | "succ"): string[] {
  const adj = dir === "pred" ? g.pred : g.succ;
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const queue = [...(adj.get(id) ?? [])];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const n = g.nodesById.get(cur);
    if (!n) continue;
    if (isGatewayType(n.type)) {
      queue.push(...(adj.get(cur) ?? []));
    } else {
      out.push(cur);
    }
  }
  return out;
}

function isGatewayType(t: string): boolean {
  return t === "exclusiveGateway" || t === "parallelGateway" || t === "inclusiveGateway";
}


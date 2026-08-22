/**
 * Gateway semantics: conditions/defaults on branches, split/join pairing,
 * block well-formedness for parallel/inclusive pairs (no branch escapes, no
 * entry from outside, exactly one token per branch into the join), and loop exits.
 */
import { isCyclicComponent, reachableExcludingRoot, reachableFrom, stronglyConnectedComponents, type GraphIndex } from "../graph.js";
import { isGateway, isSplit, isTask, type Edge, type Gateway, type Node } from "../types.js";
import type { RawFinding } from "./catalog.js";
import { describeEdge, describeNode, edgePath, edgeRef, nodePath, nodeRef, type RuleContext, type RuleFn } from "./context.js";
import { incomingData } from "./data.js";

const CONDITIONAL = new Set(["exclusiveGateway", "inclusiveGateway"]);
const BLOCK_STRUCTURED = new Set(["parallelGateway", "inclusiveGateway"]);

function isConditionalSplit(n: Node | undefined): n is Gateway & { direction: "split" } {
  return !!n && isSplit(n) && CONDITIONAL.has(n.type);
}

// ---- conditions & defaults ---------------------------------------------------

export const gwConditionMissing: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (!isConditionalSplit(n)) continue;
    const outs = g.outEdges.get(n.id) ?? [];
    const bare = outs.filter((e) => !e.condition && !e.is_default);
    const hasDefault = outs.some((e) => e.is_default);
    // Exactly one bare branch and no default is handled by gw.default-implicit (deterministic fix).
    if (bare.length === 1 && !hasDefault) continue;
    for (const e of bare) {
      const target = g.nodesById.get(e.to);
      out.push({
        rule: "gw.condition-missing",
        message: `${describeEdge(e)} leaves ${describeNode(n)} without a condition and is not the default flow.`,
        path: edgePath(g, e.id),
        element: edgeRef(e),
        fix: `Add condition: { expression: "<when this branch is taken>", language: "natural" } to edge '${e.id}'${hasDefault ? "" : ", or set is_default: true if it is the fallback branch"}.`,
        question: `At '${n.name}', under what condition does the flow go to '${target?.name ?? e.to}'?`
      });
    }
  }
  return out;
};

export const gwDefaultImplicit: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (!isConditionalSplit(n)) continue;
    const outs = g.outEdges.get(n.id) ?? [];
    if (outs.length < 2 || outs.some((e) => e.is_default)) continue;
    const bare = outs.filter((e) => !e.condition);
    if (bare.length !== 1) continue;
    const e = bare[0]!;
    out.push({
      rule: "gw.default-implicit",
      message: `${describeEdge(e)} is the only branch of ${describeNode(n)} without a condition, and the split has no default flow.`,
      path: edgePath(g, e.id),
      element: edgeRef(e),
      fix: `Set is_default: true on edge '${e.id}' (the fallback taken when no other condition matches), or give it an explicit condition.`
    });
  }
  return out;
};

export const gwConditionMisplaced: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const e of ir.edges) {
    if (!e.condition && !e.is_default) continue;
    const src = g.nodesById.get(e.from);
    if (!src) continue; // ref.unknown
    if (isConditionalSplit(src)) continue;
    const what = e.condition && e.is_default ? "a condition and is_default" : e.condition ? "a condition" : "is_default";
    out.push({
      rule: "gw.condition-misplaced",
      message: `${describeEdge(e)} has ${what}, but it does not leave an exclusiveGateway/inclusiveGateway split (source is ${describeNode(src)}).`,
      path: edgePath(g, e.id),
      element: edgeRef(e),
      fix:
        src.type === "parallelGateway"
          ? `Parallel splits take every branch unconditionally: remove ${what} from this edge, or change the gateway to exclusiveGateway/inclusiveGateway.`
          : `Move the decision into an exclusiveGateway split placed after this node, and put ${what} on the gateway's outgoing edges.`
    });
  }
  return out;
};

export const gwDefaultMultiple: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (!isConditionalSplit(n)) continue;
    const defaults = (g.outEdges.get(n.id) ?? []).filter((e) => e.is_default);
    if (defaults.length > 1) {
      out.push({
        rule: "gw.default-multiple",
        message: `${describeNode(n)} has ${defaults.length} default flows (${defaults.map((e) => e.id).join(", ")}); at most one is allowed.`,
        path: nodePath(g, n.id),
        element: nodeRef(n),
        fix: "Keep is_default on exactly one outgoing edge and give the others explicit conditions."
      });
    }
  }
  return out;
};

export const gwDefaultMissing: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (!isConditionalSplit(n)) continue;
    const outs = g.outEdges.get(n.id) ?? [];
    if (outs.length < 2 || outs.some((e) => e.is_default) || outs.some((e) => !e.condition)) continue;
    out.push({
      rule: "gw.default-missing",
      message: `${describeNode(n)} has no default flow; if none of its conditions match, the process would be stuck.`,
      path: nodePath(g, n.id),
      element: nodeRef(n),
      fix: "Mark the fallback branch with is_default: true (and drop its condition), or make the conditions provably exhaustive and say so in the gateway description."
    });
  }
  return out;
};

export const gwDefaultConditional: RuleFn = ({ ir, g }) =>
  ir.edges
    .filter((e) => e.is_default && e.condition)
    .map((e) => ({
      rule: "gw.default-conditional" as const,
      message: `${describeEdge(e)} is the default flow but also carries a condition; the default is taken only when no other condition matches and must be unconditional.`,
      path: `${edgePath(g, e.id)}/condition`,
      element: edgeRef(e),
      fix: "Remove the condition from the default flow (move it to the gateway description if it documents intent), or clear is_default and keep the condition."
    }));

/** Data-object id → identifier used in formal expressions ('payment-result' → 'payment_result'). */
export function dataIdentifier(id: string): string {
  return id.replace(/-/g, "_");
}

const IDENT_ROOT = /(?<![\w.'"])([A-Za-z_][A-Za-z0-9_]*)\s*(?=[.[])/g;

export const gwConditionUnbound: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  const byIdent = new Map(ir.data_objects.map((d) => [dataIdentifier(d.id), d.id] as const));
  for (const e of ir.edges) {
    if (!e.condition || !e.condition.language || e.condition.language === "natural") continue;
    const src = g.nodesById.get(e.from);
    if (!isConditionalSplit(src)) continue;
    const available = incomingData(g, src);
    const seen = new Set<string>();
    for (const m of e.condition.expression.matchAll(IDENT_ROOT)) {
      const ident = m[1]!;
      const dataId = byIdent.get(ident);
      if (!dataId || available.has(dataId) || seen.has(dataId)) continue;
      seen.add(dataId);
      out.push({
        rule: "gw.condition-unbound",
        message: `Condition on ${describeEdge(e)} references '${ident}' (data object '${dataId}'), which is not carried into ${describeNode(src)} (arriving: ${[...available].sort().join(", ") || "nothing"}).`,
        path: `${edgePath(g, e.id)}/condition/expression`,
        element: edgeRef(e),
        fix: `Carry '${dataId}' on the edge into '${src.id}' so the routing code can evaluate the condition, or rewrite the condition over the data that is available.`
      });
    }
  }
  return out;
};

// ---- pairing ---------------------------------------------------------------

export interface Pairing {
  split: Gateway;
  join: Gateway;
}

/** Valid (split, join) pairings; invalid declarations are reported by gwPairingInvalid. */
export function validPairings(ctx: RuleContext): Pairing[] {
  const { ir, g } = ctx;
  const claimed = new Map<string, Gateway>();
  const pairs: Pairing[] = [];
  for (const n of ir.nodes) {
    if (!isGateway(n) || n.direction !== "join" || n.pairs_with === undefined) continue;
    const s = g.nodesById.get(n.pairs_with);
    if (!s || !isGateway(s) || s.direction !== "split" || s.type !== n.type) continue;
    if (claimed.has(s.id)) continue;
    claimed.set(s.id, n);
    pairs.push({ split: s, join: n });
  }
  return pairs;
}

export const gwPairingRequired: RuleFn = (ctx) => {
  const { ir, g } = ctx;
  const paired = new Set(validPairings(ctx).map((p) => p.split.id));
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (!isGateway(n) || n.direction !== "join" || !BLOCK_STRUCTURED.has(n.type)) continue;
    if (n.pairs_with !== undefined) continue;
    const upstream = reachableFrom(g, [n.id], { reverse: true, includeRoots: false });
    const candidates = ir.nodes.filter((s) => isGateway(s) && s.direction === "split" && s.type === n.type && !paired.has(s.id) && upstream.has(s.id)).map((s) => s.id);
    out.push({
      rule: "gw.pairing-required",
      message: `${describeNode(n)} does not declare which split it closes.`,
      path: `${nodePath(g, n.id)}/pairs_with`,
      element: nodeRef(n),
      fix:
        candidates.length === 1
          ? `Set pairs_with: "${candidates[0]}" (the unpaired ${n.type} split upstream of this join).`
          : candidates.length > 1
            ? `Set pairs_with to the ${n.type} split whose branches this join merges (unpaired candidates upstream: ${candidates.join(", ")}).`
            : `Set pairs_with to the id of the ${n.type} split whose branches this join merges — there is no unpaired ${n.type} split upstream, so also check the split's type/direction.`
    });
  }
  return out;
};

export const gwPairingInvalid: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  const claimed = new Map<string, Gateway>();
  for (const n of ir.nodes) {
    if (!isGateway(n) || n.pairs_with === undefined) continue;
    const p = `${nodePath(g, n.id)}/pairs_with`;
    if (n.direction === "split") {
      out.push({
        rule: "gw.pairing-invalid",
        message: `${describeNode(n)} sets pairs_with, but pairing is declared on the join, not the split.`,
        path: p,
        element: nodeRef(n),
        fix: "Remove pairs_with from the split and set it on the matching join gateway."
      });
      continue;
    }
    const s = g.nodesById.get(n.pairs_with);
    if (!s) continue; // ref.unknown
    if (!isGateway(s) || s.direction !== "split" || s.type !== n.type) {
      out.push({
        rule: "gw.pairing-invalid",
        message: `${describeNode(n)} pairs with ${describeNode(s)}, which is not a ${n.type} split.`,
        path: p,
        element: nodeRef(n),
        fix: `Point pairs_with at the ${n.type} split that opens this block (same gateway type, direction 'split').`
      });
      continue;
    }
    const prev = claimed.get(s.id);
    if (prev) {
      out.push({
        rule: "gw.pairing-invalid",
        message: `${describeNode(n)} and ${describeNode(prev)} both claim to close ${describeNode(s)}; a split has exactly one join.`,
        path: p,
        element: nodeRef(n),
        fix: "Merge the two joins into one, or introduce a separate split for the second join."
      });
      continue;
    }
    claimed.set(s.id, n);
  }
  return out;
};

export const gwJoinMissing: RuleFn = (ctx) => {
  const { ir, g } = ctx;
  const pairs = validPairings(ctx);
  const pairedSplits = new Set(pairs.map((p) => p.split.id));
  const pairedJoins = new Set(pairs.map((p) => p.join.id));
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (!isGateway(n) || n.direction !== "split" || !BLOCK_STRUCTURED.has(n.type)) continue;
    if (pairedSplits.has(n.id)) continue;
    const downstream = reachableFrom(g, [n.id], { includeRoots: false });
    const candidates = ir.nodes.filter((j) => isGateway(j) && j.direction === "join" && j.type === n.type && !pairedJoins.has(j.id) && downstream.has(j.id)).map((j) => j.id);
    out.push({
      rule: "gw.join-missing",
      message: `${describeNode(n)} has no matching join.`,
      path: nodePath(g, n.id),
      element: nodeRef(n),
      fix:
        candidates.length > 0
          ? `${candidates.length === 1 ? `Join '${candidates[0]}'` : `One of the joins ${candidates.join(", ")}`} downstream is not (validly) paired: set its pairs_with to "${n.id}" if it closes this split. Otherwise add a ${n.type} with direction "join" and pairs_with "${n.id}", and route every branch into it.`
          : `Add a ${n.type} with direction "join" and pairs_with "${n.id}", and route every branch of the split into it before the flow continues.`
    });
  }
  return out;
};

// ---- block well-formedness ------------------------------------------------------

function nonInterruptingBoundaries(g: GraphIndex): Set<string> {
  const s = new Set<string>();
  for (const n of g.nodesById.values()) if (n.type === "boundaryEvent" && n.interrupting === false) s.add(n.id);
  return s;
}

export const gwRegionLeak: RuleFn = (ctx) => {
  const { g } = ctx;
  const out: RawFinding[] = [];
  const nonInterrupting = nonInterruptingBoundaries(g);

  for (const { split, join } of validPairings(ctx)) {
    const splitPath = nodePath(g, split.id);
    const joinPath = nodePath(g, join.id);

    // A block's join comes after its split. If every path from a start event to the split passes
    // through the join (the join dominates the split), the "join" is really a loop re-entry merge.
    const starts = [...g.nodesById.values()].filter((n) => n.type === "startEvent").map((n) => n.id);
    const splitReachableWithoutJoin = reachableFrom(g, starts, { skip: new Set([join.id]) }).has(split.id);
    const splitReachableAtAll = reachableFrom(g, starts).has(split.id);
    if (!reachableFrom(g, [split.id]).has(join.id) || (splitReachableAtAll && !splitReachableWithoutJoin)) {
      const isLoopMerge = splitReachableAtAll && !splitReachableWithoutJoin;
      out.push({
        rule: "gw.region-leak",
        message: isLoopMerge
          ? `${describeNode(join)} comes BEFORE ${describeNode(split)} (every path to the split passes through the join), so it is a loop re-entry merge, not the block's join.`
          : `${describeNode(join)} is not reachable from the split it claims to close, ${describeNode(split)}.`,
        path: `${joinPath}/pairs_with`,
        element: nodeRef(join),
        fix: isLoopMerge ? "Remove pairs_with from this merge (loop re-entry merges are unpaired), or point it at the split that actually opens the block it closes." : "Point pairs_with at the split whose branches flow into this join.",
        data: { split: split.id, join: join.id }
      });
      continue;
    }

    // Region: everything reachable from the split without passing the join.
    const region = reachableExcludingRoot(g, split.id, new Set([join.id]));

    if (BLOCK_STRUCTURED.has(split.type)) {
      // (a) No branch may end without passing the join — except via a terminate end, or along a
      //     non-interrupting boundary path (the host still delivers its own token).
      const mainRegion = reachableExcludingRoot(g, split.id, new Set([join.id, ...nonInterrupting]));
      for (const id of [...mainRegion].sort()) {
        const n = g.nodesById.get(id)!;
        if (n.type === "endEvent" && n.result?.kind !== "terminate") {
          out.push({
            rule: "gw.region-leak",
            message: `A branch of ${describeNode(split)} reaches ${describeNode(n)} without passing its join '${join.id}', so the join would wait forever.`,
            path: splitPath,
            element: nodeRef(split),
            fix: `Bring that path back into its own branch (an exclusiveGateway join before the parallel join '${join.id}') so the branch still delivers exactly one flow to the join — or, if it really must stop everything, make the end event result.kind = "terminate".`,
            data: { split: split.id, join: join.id, leaksTo: n.id }
          });
        }
      }
      // (b) No branch may loop back to the split without passing the join.
      if (region.has(split.id)) {
        out.push({
          rule: "gw.region-leak",
          message: `A branch of ${describeNode(split)} loops back to the split without passing its join '${join.id}'.`,
          path: splitPath,
          element: nodeRef(split),
          fix: `Close the block first: loop back from after join '${join.id}' (via an exclusiveGateway split), not from inside a branch.`,
          data: { split: split.id, join: join.id }
        });
      }
      // (c) Nothing may enter the block except through the split.
      for (const id of [...region].sort()) {
        if (id === join.id) continue;
        for (const p of [...(g.pred.get(id) ?? [])].sort()) {
          if (p === split.id || region.has(p)) continue;
          const pn = g.nodesById.get(p)!;
          out.push({
            rule: "gw.region-leak",
            message: `Flow from ${describeNode(pn)} enters the block of ${describeNode(split)} at '${id}' without passing the split, so the join '${join.id}' would receive tokens it did not open.`,
            path: nodePath(g, id),
            element: nodeRef(g.nodesById.get(id)!),
            fix: `Route that flow to before '${split.id}' (an exclusiveGateway join in front of the split) or to after '${join.id}', not into the middle of the block.`,
            data: { split: split.id, join: join.id, from: p, into: id }
          });
        }
      }
      // (d) Each branch delivers exactly one flow into the join.
      out.push(...tokenAccounting(g, split, join, region));
    }

    // (e) The join only merges branches of its own split (all pair types).
    for (const pred of [...(g.pred.get(join.id) ?? [])].sort()) {
      if (pred === split.id || region.has(pred)) continue;
      const pn = g.nodesById.get(pred)!;
      out.push({
        rule: "gw.region-leak",
        message: `${describeNode(join)} receives a flow from ${describeNode(pn)}, which is not on a branch of its split '${split.id}'.`,
        path: joinPath,
        element: nodeRef(join),
        fix: `Only branches opened by '${split.id}' may enter this join. Merge the outside flow after the join with an exclusiveGateway join, or fix pairs_with.`,
        data: { split: split.id, join: join.id, outsidePredecessor: pred }
      });
    }
  }
  return out;
};

/** For parallel/inclusive blocks: every branch head must own exactly one incoming flow of the join. */
function tokenAccounting(g: GraphIndex, split: Gateway, join: Gateway, region: Set<string>): RawFinding[] {
  const out: RawFinding[] = [];
  const heads = (g.outEdges.get(split.id) ?? []).map((e) => e.to);
  const reachOfHead = new Map<string, Set<string>>();
  for (const h of heads) {
    if (h === join.id) continue;
    const r = reachableExcludingRoot(g, h, new Set([join.id, split.id]));
    r.add(h);
    reachOfHead.set(h, r);
  }
  const owners = new Map<string, Edge[]>(); // head -> in-edges of the join it exclusively owns
  for (const e of g.inEdges.get(join.id) ?? []) {
    if (!region.has(e.from) && e.from !== split.id) continue; // reported by (e)
    const hs = e.from === split.id ? [`${split.id}->${join.id}`] : heads.filter((h) => reachOfHead.get(h)?.has(e.from));
    if (hs.length >= 2) {
      out.push({
        rule: "gw.region-leak",
        message: `${describeEdge(e)} into ${describeNode(join)} is fed by ${hs.length} branches of '${split.id}' (${hs.join(", ")}) merged before the join, so the join cannot tell the branches apart.`,
        path: edgePath(g, e.id),
        element: edgeRef(e),
        fix: `Let each branch reach '${join.id}' on its own edge; move any exclusiveGateway merge of the branches to after the join.`,
        data: { split: split.id, join: join.id, heads: hs }
      });
      continue;
    }
    const h = hs[0];
    if (!h) continue;
    if (!owners.has(h)) owners.set(h, []);
    owners.get(h)!.push(e);
  }
  for (const [h, edges] of [...owners.entries()].sort()) {
    if (edges.length < 2) continue;
    out.push({
      rule: "gw.region-leak",
      message: `The branch of ${describeNode(split)} starting at '${h}' delivers ${edges.length} flows into ${describeNode(join)} (${edges.map((e) => e.id).join(", ")}); the join expects exactly one per branch, so it would wait forever or fire twice.`,
      path: nodePath(g, h),
      element: nodeRef(g.nodesById.get(h) ?? split),
      fix: `Merge those flows with an exclusiveGateway join inside the branch, before '${join.id}' (typical for an exception path from a boundary event or a decision inside the branch).`,
      data: { split: split.id, join: join.id, head: h, edges: edges.map((e) => e.id) }
    });
  }
  return out;
}

// ---- loops -------------------------------------------------------------------

export const loopNoExit: RuleFn = ({ g }) => {
  const out: RawFinding[] = [];
  for (const comp of stronglyConnectedComponents(g)) {
    if (!isCyclicComponent(g, comp)) continue;
    const inComp = new Set(comp);
    const hasExit = comp.some((id) => {
      const n = g.nodesById.get(id);
      if (!n) return false;
      const leaves = (g.succ.get(id) ?? []).some((s) => !inComp.has(s));
      if (!leaves) return false;
      // A conditional split, or a task whose boundary event(s) make completion vs. exception the condition.
      return isConditionalSplit(n) || (isTask(n) && (g.boundariesOf.get(id)?.length ?? 0) > 0);
    });
    if (hasExit) continue;
    const first = comp[0]!;
    out.push({
      rule: "loop.no-exit",
      message: `The loop ${comp.join(" -> ")} -> ${first} has no conditional exit.`,
      path: nodePath(g, first),
      element: nodeRef(g.nodesById.get(first)!),
      fix: "Add an exclusiveGateway split inside the loop with one conditional edge that leaves it (e.g. 'attempts < 3' → retry, default → continue/end).",
      data: { cycle: comp }
    });
  }
  return out;
};

/**
 * The graph plan: the machine-readable half of the dev plan.
 *
 * Where plan.md tells a human how the build is ordered, the graph plan gives
 * an orchestration harness the same facts as data: one self-contained work
 * packet per task (contracts in, contracts out, acceptance criteria,
 * integration), the loop structure with its exit conditions, and a routing
 * table for every gateway (gateways are not units of work — routing is the
 * orchestrator's job, so it is emitted separately from the packets).
 *
 * Each packet deliberately embeds everything an implementing agent needs —
 * including the JSON Schemas of the data objects it touches — so a single
 * node can be built by a small local model without the rest of the document
 * in context. Like the rest of the kit it is generated from the IR alone and
 * fully deterministic.
 */
import {
  isGateway,
  isTask,
  nearestWorkAncestors,
  nearestWorkDescendants,
  stronglyConnectedComponents,
  type AcceptanceCriterion,
  type Edge,
  type Gateway,
  type Integration,
  type JsonSchema,
  type ProcessIR,
  type Task
} from "@vibestudio/ir";
import { buildContext, type SpecContext } from "./context.js";
import { oneLine, renderDoc, table, type Block } from "./markdown.js";
import { banner, nodeLabel } from "./context.js";

export interface PacketFlow {
  /** The adjacent node this flow physically connects to (may be a gateway or event). */
  via: string;
  /** The nearest task/event nodes looking through gateways — who the work really comes from / goes to. */
  work: string[];
  /** Data object ids guaranteed present on this flow. */
  carries: string[];
  /** Condition on the flow, when it leaves an exclusive/inclusive split. */
  condition?: string;
}

export interface WorkPacket {
  id: string;
  name: string;
  type: string;
  lane: string;
  lane_kind: string;
  description?: string;
  inputs: PacketFlow[];
  outputs: PacketFlow[];
  reads: string[];
  writes: string[];
  /** JSON Schemas for every data object this packet touches, keyed by data object id. */
  data_schemas: Record<string, JsonSchema>;
  acceptance_criteria: AcceptanceCriterion[];
  integration?: Integration;
  /** Set when the task is part of a loop: which loop and the conditions under which the flow leaves it. */
  loop?: { id: string; exits: { on: string; to: string }[] };
}

export interface LoopInfo {
  id: string;
  /** Loop member node ids in build order (merge -> body -> exit). */
  members: string[];
  /** Every edge that leaves the loop, with its condition when present. */
  exits: { from: string; to: string; edge: string; condition?: string }[];
}

export interface GatewayRoute {
  gateway: string;
  name: string;
  type: string;
  direction: "split" | "join";
  branches: { edge: string; to: string; condition?: string; is_default?: boolean }[];
}

export interface GraphPlan {
  process: { id: string; name: string; goal?: string };
  /** Every node id in loop-aware topological order (the full build order). */
  build_order: string[];
  /** One work packet per task node, in build order. */
  packets: WorkPacket[];
  loops: LoopInfo[];
  /** Routing is owned by the orchestrator, never by tasks. */
  routing: GatewayRoute[];
}

function conditionText(e: Edge): string | undefined {
  if (e.is_default) return "otherwise (default)";
  return e.condition?.expression;
}

function loopsOf(ctx: SpecContext): LoopInfo[] {
  const comps = stronglyConnectedComponents(ctx.g).filter((c) => c.length > 1);
  const orderPos = new Map(ctx.order.map((id, i) => [id, i] as const));
  const loops: LoopInfo[] = [];
  comps
    .map((members) => [...members].sort((a, b) => (orderPos.get(a) ?? 0) - (orderPos.get(b) ?? 0)))
    .sort((a, b) => (orderPos.get(a[0]!) ?? 0) - (orderPos.get(b[0]!) ?? 0))
    .forEach((members, i) => {
      const inLoop = new Set(members);
      const exits: LoopInfo["exits"] = [];
      for (const id of members) {
        for (const e of ctx.g.outEdges.get(id) ?? []) {
          if (!inLoop.has(e.to)) exits.push({ from: e.from, to: e.to, edge: e.id, condition: conditionText(e) });
        }
      }
      loops.push({ id: `loop-${i + 1}`, members, exits });
    });
  return loops;
}

function flowsFor(ctx: SpecContext, edges: Edge[], dir: "back" | "forward"): PacketFlow[] {
  return edges.map((e) => {
    const via = dir === "back" ? e.from : e.to;
    const viaNode = ctx.g.nodesById.get(via);
    const work =
      viaNode && isGateway(viaNode)
        ? dir === "back"
          ? nearestWorkAncestors(ctx.g, via)
          : nearestWorkDescendants(ctx.g, via)
        : [via];
    const flow: PacketFlow = { via, work, carries: [...e.data_contract.carries] };
    const cond = conditionText(e);
    if (cond) flow.condition = cond;
    return flow;
  });
}

function schemasFor(ctx: SpecContext, ids: Iterable<string>): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const id of [...new Set(ids)].sort()) {
    const d = ctx.dataById.get(id);
    if (d?.schema) out[id] = d.schema;
  }
  return out;
}

function packetFor(ctx: SpecContext, task: Task, loops: LoopInfo[]): WorkPacket {
  const lane = ctx.lanesById.get(task.lane);
  const inputs = flowsFor(ctx, ctx.g.inEdges.get(task.id) ?? [], "back");
  const outputs = flowsFor(ctx, ctx.g.outEdges.get(task.id) ?? [], "forward");
  const reads = [...(task.data?.reads ?? [])];
  const writes = [...(task.data?.writes ?? [])];
  const packet: WorkPacket = {
    id: task.id,
    name: task.name,
    type: task.type,
    lane: task.lane,
    lane_kind: lane?.kind ?? "system",
    inputs,
    outputs,
    reads,
    writes,
    data_schemas: schemasFor(ctx, [...reads, ...writes, ...inputs.flatMap((f) => f.carries), ...outputs.flatMap((f) => f.carries)]),
    acceptance_criteria: task.acceptance_criteria ?? []
  };
  if (task.description) packet.description = task.description;
  if (task.integration) packet.integration = task.integration;
  const loop = loops.find((l) => l.members.includes(task.id));
  if (loop) packet.loop = { id: loop.id, exits: loop.exits.map((x) => ({ on: x.condition ?? "task completes", to: x.to })) };
  return packet;
}

function routingOf(ctx: SpecContext): GatewayRoute[] {
  const routes: GatewayRoute[] = [];
  for (const id of ctx.order) {
    const n = ctx.g.nodesById.get(id);
    if (!n || !isGateway(n)) continue;
    const gw = n as Gateway;
    routes.push({
      gateway: gw.id,
      name: gw.name,
      type: gw.type,
      direction: gw.direction,
      branches: (ctx.g.outEdges.get(gw.id) ?? []).map((e) => {
        const b: GatewayRoute["branches"][number] = { edge: e.id, to: e.to };
        if (e.condition) b.condition = e.condition.expression;
        if (e.is_default) b.is_default = true;
        return b;
      })
    });
  }
  return routes;
}

export function generateGraphPlan(ir: ProcessIR): GraphPlan {
  const ctx = buildContext(ir);
  const loops = loopsOf(ctx);
  const plan: GraphPlan = {
    process: { id: ir.process.id, name: ir.process.name },
    build_order: [...ctx.order],
    packets: ctx.order
      .map((id) => ctx.g.nodesById.get(id))
      .filter((n): n is Task => !!n && isTask(n))
      .map((t) => packetFor(ctx, t, loops)),
    loops,
    routing: routingOf(ctx)
  };
  if (ir.process.goal) plan.process.goal = ir.process.goal;
  return plan;
}

/**
 * Human-readable rendering of the same plan, for the bundle's graph-plan.md.
 * Every free-text interpolation (names, conditions, integration fields) is
 * one-lined: sanitisation is a rendering concern — the JSON plan above keeps
 * the IR's text verbatim.
 */
export function renderGraphPlanMarkdown(ir: ProcessIR): string {
  const ctx = buildContext(ir);
  const plan = generateGraphPlan(ir);
  const blocks: Block[] = [];
  blocks.push([banner(ir)]);
  blocks.push([`# ${oneLine(ir.process.name)} — graph plan`]);
  blocks.push([
    "One work packet per task, in build order. Each packet is self-contained:",
    "an implementing agent needs only the packet plus the data schemas it embeds",
    "— not the whole document — so packets fit small context windows."
  ]);
  if (plan.build_order.length > 0) {
    blocks.push(["## Build order"]);
    blocks.push(plan.build_order.map((id, i) => `${i + 1}. ${nodeLabel(ctx, id)}`));
  }
  if (plan.loops.length > 0) {
    blocks.push(["## Loops"]);
    for (const loop of plan.loops) {
      blocks.push([
        `### ${loop.id}`,
        "",
        `Members (in build order): ${loop.members.map((m) => nodeLabel(ctx, m)).join(" → ")}`,
        "",
        ...loop.exits.map((x) => `- exits to ${nodeLabel(ctx, x.to)} when: ${x.condition ? oneLine(x.condition) : `${nodeLabel(ctx, x.from)} completes`}`)
      ]);
    }
  }
  if (plan.packets.length > 0) blocks.push(["## Work packets"]);
  for (const p of plan.packets) {
    const lines: string[] = [`### ${oneLine(p.name)} (${p.id})`, "", `- Type: ${p.type} · Lane: ${p.lane} (${p.lane_kind})`];
    for (const f of p.inputs) {
      lines.push(`- In from ${f.work.map((w) => nodeLabel(ctx, w)).join(", ")}: carries ${f.carries.join(", ") || "nothing"}`);
    }
    for (const f of p.outputs) {
      lines.push(
        `- Out to ${f.work.map((w) => nodeLabel(ctx, w)).join(", ")}: carries ${f.carries.join(", ") || "nothing"}${f.condition ? ` (when ${oneLine(f.condition)})` : ""}`
      );
    }
    if (p.loop) lines.push(`- Part of ${p.loop.id}`);
    if (p.integration) {
      lines.push(`- Integration: ${oneLine(p.integration.system)}${p.integration.operation ? ` — ${oneLine(p.integration.operation)}` : ""}`);
    }
    blocks.push(lines);
    if (p.acceptance_criteria.length > 0) {
      blocks.push(table(["ID", "Given", "When", "Then"], p.acceptance_criteria.map((c) => [c.id, c.given, c.when, c.then])));
    }
  }
  if (plan.routing.length > 0) {
    blocks.push(["## Routing (owned by the orchestrator, not by tasks)"]);
    for (const r of plan.routing) {
      blocks.push([
        `### ${oneLine(r.name)} (${r.gateway}) — ${r.type}, ${r.direction}`,
        "",
        ...(r.branches.length > 0
          ? r.branches.map((b) => `- → ${nodeLabel(ctx, b.to)}${b.condition ? ` when: ${oneLine(b.condition)}` : b.is_default ? " (default)" : ""}`)
          : ["- (join: single outgoing flow)"])
      ]);
    }
  }
  return renderDoc(blocks);
}

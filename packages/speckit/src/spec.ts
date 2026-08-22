/**
 * spec.md — what to build. One section per task (events and gateways are not
 * units of work) in the IR package's loop-aware topological order, so the
 * document reads in execution order and two runs always agree. Decisions and
 * events get their own sections: routing logic and process boundaries are
 * part of the spec even though nobody "builds" a gateway.
 */
import { isEvent, isSplit, type Edge, type Gateway, type Node, type Task } from "@vibestudio/ir";
import { banner, kindWithDetail, laneLabel, dataLabel, nodeLabel, nodesInOrder, tasksInOrder, workLabels, type SpecContext } from "./context.js";
import { inlineCode, oneLine, renderDoc, table, type Block } from "./markdown.js";

export function renderSpec(ctx: SpecContext): string {
  const blocks: Block[] = [[banner(ctx.ir)], [`# ${oneLine(ctx.ir.process.name)} — specification`]];
  for (const task of tasksInOrder(ctx)) blocks.push(...taskBlocks(ctx, task));
  blocks.push(...decisionsBlocks(ctx));
  blocks.push(eventsBlock(ctx));
  return renderDoc(blocks);
}

// ---- tasks -----------------------------------------------------------------

function taskBlocks(ctx: SpecContext, task: Task): Block[] {
  const blocks: Block[] = [[`## ${oneLine(task.name)} (${task.id})`]];

  const meta = [`- Lane: ${laneLabel(ctx, task.lane)}`, `- Type: ${task.type}`];
  blocks.push(meta);
  // The description is its own paragraph, so it keeps its newlines;
  // renderDoc normalises whatever whitespace it embeds.
  if (task.description) blocks.push([task.description]);

  const io: string[] = [];
  const reads = task.data?.reads ?? [];
  const writes = task.data?.writes ?? [];
  if (reads.length > 0) io.push(`- Reads: ${reads.map((id) => dataLabel(ctx, id)).join(", ")}`);
  if (writes.length > 0) io.push(`- Writes: ${writes.map((id) => dataLabel(ctx, id)).join(", ")}`);
  blocks.push(io);

  blocks.push(criteriaBlock(task));
  blocks.push(integrationBlock(task));
  return blocks;
}

function criteriaBlock(task: Task): Block {
  const criteria = task.acceptance_criteria ?? [];
  if (criteria.length === 0) return [];
  // The Tags column only exists when some criterion is tagged; an all-empty
  // column would just be noise.
  const tagged = criteria.some((c) => (c.tags?.length ?? 0) > 0);
  const header = tagged ? ["ID", "Given", "When", "Then", "Tags"] : ["ID", "Given", "When", "Then"];
  const rows = criteria.map((c) => {
    const base = [c.id, c.given, c.when, c.then];
    return tagged ? [...base, (c.tags ?? []).join(", ")] : base;
  });
  return ["### Acceptance criteria", "", ...table(header, rows)];
}

function integrationBlock(task: Task): Block {
  const integration = task.integration;
  if (!integration) return [];
  const lines = ["### Integration", "", `- System: ${oneLine(integration.system)}`];
  if (integration.operation) lines.push(`- Operation: ${oneLine(integration.operation)}`);
  if (integration.direction) lines.push(`- Direction: ${integration.direction}`);
  if (integration.protocol) lines.push(`- Protocol: ${oneLine(integration.protocol)}`);
  if (integration.description) lines.push(`- Notes: ${oneLine(integration.description)}`);
  return lines;
}

// ---- decisions -------------------------------------------------------------

/** Exclusive/inclusive splits are the routing decisions an implementer must encode. */
function decisionsBlocks(ctx: SpecContext): Block[] {
  const splits = nodesInOrder(ctx).filter(
    (n): n is Gateway => isSplit(n) && (n.type === "exclusiveGateway" || n.type === "inclusiveGateway")
  );
  const blocks: Block[] = [];
  for (const gw of splits) {
    const out = ctx.g.outEdges.get(gw.id) ?? [];
    if (out.length === 0) continue;
    const kind = gw.type === "exclusiveGateway" ? "Exclusive decision" : "Inclusive decision";
    const lines = [`### ${oneLine(gw.name)} (${gw.id})`, "", `${kind} in lane ${laneLabel(ctx, gw.lane)}.`, ""];
    for (const edge of out) lines.push(branchLine(ctx, edge));
    blocks.push(lines);
  }
  if (blocks.length === 0) return [];
  return [["## Decisions"], ...blocks];
}

function branchLine(ctx: SpecContext, edge: Edge): string {
  const parts: string[] = [];
  if (edge.condition) {
    const lang = edge.condition.language ? ` (${edge.condition.language})` : "";
    parts.push(`condition: ${inlineCode(oneLine(edge.condition.expression))}${lang}`);
  }
  if (edge.is_default === true) parts.push("default");
  if (parts.length === 0) parts.push("unconditional");
  const name = edge.name ? `**${oneLine(edge.name)}** — ` : "";
  // Branches lead to work, not to plumbing: a target gateway is looked
  // through to the nearest task/event so the reader knows where flow lands.
  return `- ${name}${parts.join(", ")} → ${workLabels(ctx, edge.to, "forward")}`;
}

// ---- events ----------------------------------------------------------------

function eventsBlock(ctx: SpecContext): Block {
  const events = nodesInOrder(ctx).filter(isEvent);
  if (events.length === 0) return [];
  const lines = ["## Events", ""];
  for (const n of events) lines.push(eventLine(ctx, n));
  return lines;
}

function eventLine(ctx: SpecContext, n: Node): string {
  const label = `- **${oneLine(n.name)}** (${n.id})`;
  switch (n.type) {
    case "startEvent": {
      const trigger = n.trigger ? `; trigger: ${kindWithDetail(n.trigger)}` : "";
      return `${label} — start event${trigger}`;
    }
    case "endEvent": {
      const result = n.result ? `; result: ${kindWithDetail(n.result)}` : "";
      return `${label} — end event${result}`;
    }
    case "intermediateCatchEvent":
      return `${label} — intermediate catch event; trigger: ${kindWithDetail(n.trigger)}`;
    case "boundaryEvent": {
      // interrupting defaults to true in the IR; the distinction matters (an
      // interrupting event aborts its host task) so it is always spelled out.
      const mode = n.interrupting === false ? "non-interrupting" : "interrupting";
      return `${label} — ${mode} boundary event on ${nodeLabel(ctx, n.attached_to)}; trigger: ${kindWithDetail(n.trigger)}`;
    }
    default:
      // Gateways are filtered out above; this arm keeps the switch exhaustive
      // without asserting, so a future node type degrades to a plain entry.
      return label;
  }
}

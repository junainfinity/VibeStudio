/**
 * plan.md — how to build it. The build order is the topological order of the
 * task nodes (loop-aware, from the IR package), with each task's input and
 * output contracts spelled out as "data — from/to work node": upstream and
 * downstream gateways are looked through to the nearest task/event, because a
 * contract with a gateway is not something anyone can implement against.
 * Integrations, NFRs and unanswered open questions follow — the last section
 * exists precisely because unanswered questions block implementation.
 */
import type { Task } from "@vibestudio/ir";
import { anyLabel, banner, dataLabel, nodeLabel, tasksInOrder, workLabels, type SpecContext } from "./context.js";
import { oneLine, renderDoc, type Block } from "./markdown.js";

export function renderPlan(ctx: SpecContext): string {
  const blocks: Block[] = [[banner(ctx.ir)], [`# ${oneLine(ctx.ir.process.name)} — build plan`]];
  blocks.push(buildOrderBlock(ctx));
  blocks.push(integrationsBlock(ctx));
  blocks.push(nfrBlock(ctx));
  blocks.push(openQuestionsBlock(ctx));
  return renderDoc(blocks);
}

function buildOrderBlock(ctx: SpecContext): Block {
  const tasks = tasksInOrder(ctx);
  if (tasks.length === 0) return [];
  const lines = ["## Build order", ""];
  tasks.forEach((task, i) => {
    lines.push(`${i + 1}. **${oneLine(task.name)}** (${task.id})`);
    lines.push(...contractLines(ctx, task));
  });
  return lines;
}

/**
 * One line per incoming/outgoing sequence flow. A task in a valid IR has
 * exactly one of each, but the generator does not assume that — a draft with
 * odd cardinality still renders every edge it finds. Empty `carries` renders
 * as "none": the flow exists, it just transports no data.
 */
function contractLines(ctx: SpecContext, task: Task): string[] {
  const lines: string[] = [];
  for (const edge of ctx.g.inEdges.get(task.id) ?? []) {
    lines.push(`    - Input from ${workLabels(ctx, edge.from, "back")}: ${carriesLabel(ctx, edge.data_contract.carries)}`);
  }
  for (const edge of ctx.g.outEdges.get(task.id) ?? []) {
    lines.push(`    - Output to ${workLabels(ctx, edge.to, "forward")}: ${carriesLabel(ctx, edge.data_contract.carries)}`);
  }
  return lines;
}

function carriesLabel(ctx: SpecContext, carries: readonly string[]): string {
  if (carries.length === 0) return "none";
  return carries.map((id) => dataLabel(ctx, id)).join(", ");
}

function integrationsBlock(ctx: SpecContext): Block {
  const entries: string[] = [];
  // Ordered by the build order so the integrations read in the sequence they
  // are first needed.
  for (const task of tasksInOrder(ctx)) {
    const integration = task.integration;
    if (!integration) continue;
    const details: string[] = [];
    if (integration.operation) details.push(`operation: ${oneLine(integration.operation)}`);
    if (integration.direction) details.push(`direction: ${integration.direction}`);
    if (integration.protocol) details.push(`protocol: ${oneLine(integration.protocol)}`);
    const detail = details.length > 0 ? ` — ${details.join("; ")}` : "";
    entries.push(`- **${oneLine(integration.system)}**${detail} — used by ${nodeLabel(ctx, task.id)}`);
  }
  if (entries.length === 0) return [];
  return ["## Integrations", "", ...entries];
}

function nfrBlock(ctx: SpecContext): Block {
  const nfrs = ctx.ir.requirements?.non_functional ?? [];
  if (nfrs.length === 0) return [];
  const lines = ["## Non-functional requirements", ""];
  for (const nfr of nfrs) {
    lines.push(`- **${nfr.id}** (${nfr.category}) — ${oneLine(nfr.statement)}`);
    const applies = nfr.applies_to ?? [];
    if (applies.length > 0) {
      lines.push(`    - Applies to: ${applies.map((id) => anyLabel(ctx, id)).join(", ")}`);
    }
  }
  return lines;
}

function openQuestionsBlock(ctx: SpecContext): Block {
  // Only questions that are still open belong here; an answered question is
  // already folded into the IR and would be stale noise in the plan.
  const open = (ctx.ir.requirements?.open_questions ?? []).filter((q) => q.answered !== true);
  if (open.length === 0) return [];
  const lines = ["## Open questions", "", "Unanswered questions that block implementation:", ""];
  for (const q of open) {
    lines.push(`- **${q.id}** — ${oneLine(q.question)}`);
    const affects = q.affects ?? [];
    if (affects.length > 0) {
      lines.push(`    - Affects: ${affects.map((id) => anyLabel(ctx, id)).join(", ")}`);
    }
  }
  return lines;
}

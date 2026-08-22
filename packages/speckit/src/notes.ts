/**
 * Human-readable notes for the person who OWNS the process, not the person
 * who codes it: a codebase map and a symptom-driven troubleshooting guide.
 *
 * Both files are scaffolds generated from the IR alone. Structural facts
 * (what feeds what, what must hold, what repeating means, who writes which
 * data) are filled in deterministically; what only the built code can know —
 * file paths, function names — is left as SELF-IDENTIFYING markers of the
 * form `[TO FILL <owner-id> …]`. The owner id names the work packet whose
 * build sitting must fill the marker, so a small-context harness completes
 * each marker right after building that packet and never needs the whole
 * codebase in view (see the kick-off prompt's documentation duty).
 *
 * Judged in adversarial review by an owner lens and a 27B/32k-harness lens;
 * the structure below (triage section, hand-off rows and markers, per-owner
 * loop markers, parallel-split wording, builder-editable banner) exists to
 * satisfy those reviews — see the session notes before "simplifying" it away.
 */
import {
  isGateway,
  isTask,
  type Edge,
  type Gateway,
  type Node,
  type ProcessIR,
  type Task
} from "@vibestudio/ir";
import { buildContext, laneLabel, nodeLabel, tasksInOrder, workLabels, type SpecContext } from "./context.js";
import { generateGraphPlan, type GraphPlan } from "./graphplan.js";
import { oneLine, renderDoc, table, type Block } from "./markdown.js";

export interface ProcessNotes {
  /** notes/troubleshooting.md — symptom → where to look. */
  troubleshooting: string;
  /** notes/codebase.md — plain-words map of the built code, filled by the builder. */
  codebase: string;
}

/**
 * Unlike every other kit file, the notes are MEANT to be edited — by the
 * builder agent, marker by marker. The banner must say so, or a literal
 * builder reading "do not edit by hand" will refuse the duty.
 */
export function notesBanner(ir: ProcessIR): string {
  return `<!-- generated from Process IR '${ir.process.id}' v${ir.ir_version} — BUILDER: you are the intended editor of this file. Replace every [TO FILL …] marker as you build; keep the generated prose around the markers. -->`;
}

function fill(owner: string, what: string): string {
  return `[TO FILL ${owner}: ${what}]`;
}

/** Soften the join between our prose and user-authored fragments. */
function clause(text: string): string {
  const t = oneLine(text);
  return t.length > 1 && t[1] === t[1]!.toLowerCase() ? t[0]!.toLowerCase() + t.slice(1) : t;
}

/**
 * Names the packet sitting that wires the routing around a gateway/exit node:
 * the nearest upstream work step. Mandatory on every routing marker — a
 * literal builder must never have to infer which sitting owns a marker.
 */
function routingSittingClause(ctx: SpecContext, nodeId: string): string {
  const upstream = workLabels(ctx, nodeId, "back") || "the previous step";
  return `filled in the same sitting that wires the routing after ${upstream}`;
}

/** "neither X nor Y" / "none of X, Y, Z" for 2 / 3+ successors. */
function noneOf(list: string): string {
  const parts = list.split(", ");
  if (parts.length === 2) return `neither ${parts[0]} nor ${parts[1]}`;
  return `none of ${list}`;
}

function conditionPhrase(e: Edge): string {
  if (e.is_default) return "when nothing else matches (the default)";
  if (e.condition) return `when ${clause(e.condition.expression)}`;
  return e.name ? `on "${oneLine(e.name)}"` : "always";
}

function dataName(ctx: SpecContext, id: string): string {
  return ctx.dataById.get(id)?.name ?? id;
}

/** The step's real successors, looking through gateways. */
function successors(ctx: SpecContext, id: string): string[] {
  const targets = (ctx.g.outEdges.get(id) ?? []).map((e) => e.to);
  return [...new Set(targets.map((t) => workLabels(ctx, t, "forward")))].filter(Boolean);
}

/** True when every direct predecessor is a start event (nothing hands over to it). */
function isEntryStep(ctx: SpecContext, id: string): boolean {
  const preds = (ctx.g.inEdges.get(id) ?? []).map((e) => ctx.g.nodesById.get(e.from));
  return preds.length > 0 && preds.every((p) => p?.type === "startEvent");
}

function splitBlocks(ctx: SpecContext, gw: Gateway): Block {
  const out = ctx.g.outEdges.get(gw.id) ?? [];
  const lines: string[] = [
    `### The wrong thing happens after "${oneLine(gw.name)}"`,
    "",
    `This is a ${gw.type === "parallelGateway" ? "fan-out point" : "decision point"} (id \`${gw.id}\`).`,
    ""
  ];
  for (const e of out) {
    lines.push(`- goes to ${workLabels(ctx, e.to, "forward")} ${conditionPhrase(e)}`);
  }
  lines.push("");
  if (gw.type === "parallelGateway") {
    lines.push(
      "Both branches are supposed to start together — there is no condition to get wrong. If one branch never starts, the fan-out itself is broken.",
      `The fan-out lives in: ${fill(gw.id, `orchestrator file and function that starts both branches — ${routingSittingClause(ctx, gw.id)}`)}.`
    );
  } else {
    lines.push(
      `If the flow takes the wrong branch, the check is implemented in: ${fill(gw.id, `file and function of this check — ${routingSittingClause(ctx, gw.id)}`)}.`,
      "Before suspecting the check itself, make sure the information it looks at is actually set at this point (see the Data section below)."
    );
  }
  return lines;
}

function loopBlocks(ctx: SpecContext, plan: GraphPlan, loopIndex: number): Block {
  const loop = plan.loops[loopIndex]!;
  const chain = loop.members.map((m) => nodeLabel(ctx, m)).join(" → ");
  const lines: string[] = [
    `### "${chain}" repeats forever (or never repeats when it should)`,
    "",
    `These steps form a deliberate loop (\`${loop.id}\`). Each pass, the process decides whether to go around again or move on:`,
    ""
  ];
  for (const x of loop.exits) {
    lines.push(
      `- it leaves the loop toward ${nodeLabel(ctx, x.to)} ${x.condition ? `when ${clause(x.condition)}` : `when ${nodeLabel(ctx, x.from)} completes normally`}`
    );
  }
  lines.push(
    "",
    "Stuck forever means the leave-condition never becomes true — usually because the value it checks is never updated inside the loop.",
    `The leave-condition is evaluated in: ${fill(`loop ${loop.id}`, `file and function — ${routingSittingClause(ctx, loop.exits[0]?.from ?? loop.members[0]!)}`)}.`
  );
  // Split the "where is the value updated" duty by its real owner: each loop
  // member that writes data gets its own marker, fillable in that packet's sitting.
  for (const m of loop.members) {
    const n = ctx.g.nodesById.get(m);
    if (n && isTask(n) && (n.data?.writes?.length ?? 0) > 0) {
      const writes = n.data!.writes!.map((d) => oneLine(dataName(ctx, d))).join(", ");
      lines.push(`- ${nodeLabel(ctx, m)} updates ${writes} during the loop — where: ${fill(m, "file and function that updates it")}.`);
    }
  }
  return lines;
}

function taskBlocks(ctx: SpecContext, t: Task): Block {
  const inbound = ctx.g.inEdges.get(t.id) ?? [];
  const receives = [...new Set(inbound.flatMap((e) => e.data_contract.carries))];
  const downstream = successors(ctx, t.id).join(", ");
  const lines: string[] = [
    `### "${oneLine(t.name)}" fails, hangs, or produces the wrong result`,
    "",
    `Step id \`${t.id}\`, done by ${laneLabel(ctx, t.lane)}. Implemented in: ${fill(t.id, "file path(s) and function name")}.`,
    ""
  ];
  if (receives.length > 0) {
    lines.push(
      `- It expects to receive: ${receives.map((d) => oneLine(dataName(ctx, d))).join(", ")}. If any of those are missing or empty, the problem happened in an earlier step — see the Data section.`
    );
  }
  for (const c of t.acceptance_criteria ?? []) {
    lines.push(`- It is only correct if: given ${clause(c.given)}, when ${clause(c.when)}, then ${clause(c.then)}.`);
  }
  if (t.integration) {
    lines.push(
      `- It talks to an outside system (${oneLine(t.integration.system)}${t.integration.operation ? `: ${oneLine(t.integration.operation)}` : ""}). If that system is down or slow, this step is where you'll see it.`
    );
  }
  if (isEntryStep(ctx, t.id)) {
    const start = (ctx.g.inEdges.get(t.id) ?? [])
      .map((e) => ctx.g.nodesById.get(e.from))
      .find((n): n is Node => n?.type === "startEvent");
    lines.push(
      `- This is the first step. If it never runs, the process is never being started when "${oneLine(start?.name ?? "the start trigger")}" happens. That start wiring is made by: ${fill(`${t.id} start-wiring`, "file and function that starts the process")}.`
    );
  } else {
    lines.push(`- If this step silently never runs, the step before it never handed over — see "Hand-offs" in the Quick map.`);
  }
  if (downstream) {
    const viaParallel = (ctx.g.outEdges.get(t.id) ?? []).some((e) => ctx.g.nodesById.get(e.to)?.type === "parallelGateway");
    const phrase = downstream.includes(", ")
      ? `${noneOf(downstream)} follows${viaParallel ? " (and if only ONE follows, see the fan-out in Decisions & fan-outs)" : " (and if the WRONG one follows instead, see Decisions & fan-outs)"}`
      : `${downstream} never follows`;
    lines.push(
      `- If it runs fine but ${phrase}, the hand-off out of this step is broken. That hand-off is made by: ${fill(`${t.id} hand-off`, "file and function that advances the process — usually the orchestrator")}.`
    );
  }
  return lines;
}

export function renderTroubleshootingNotes(ir: ProcessIR): string {
  const ctx = buildContext(ir);
  const plan = generateGraphPlan(ir);
  const tasks = tasksInOrder(ctx);
  const splits = ctx.order
    .map((id) => ctx.g.nodesById.get(id))
    .filter((n): n is Gateway => !!n && isGateway(n) && n.direction === "split" && (ctx.g.outEdges.get(n.id)?.length ?? 0) > 1);

  const blocks: Block[] = [];
  blocks.push([notesBanner(ir)]);
  blocks.push([`# ${oneLine(ir.process.name)} — where to look when something goes wrong`]);
  blocks.push([
    "This guide maps symptoms to the exact place to investigate. It was generated from the confirmed process map,",
    "and the builder fills in every `[TO FILL …]` marker with real file and function names while building.",
    "**If any marker below is still unfilled, the build is not finished.**",
    "",
    "How to use it: find the symptom in the Quick map (or start at Triage if you're not sure), read that section,",
    "and hand the pointer (step id + file) to whoever is fixing it — or to your AI tool.",
    "Your plain-words map of the code itself is the companion file, notes/codebase.md."
  ]);

  // Quick map: observable symptoms, including the hand-off gaps between steps.
  const rows: string[][] = [["Something is broken, not sure where", "start at Triage", "just below"]];
  for (const t of tasks) rows.push([`"${t.name}" goes wrong or gets stuck`, `step \`${t.id}\``, "Steps below"]);
  for (const t of tasks) {
    const succ = successors(ctx, t.id);
    // Multiple successors always arrive via a gateway (tasks are 1-out by construction);
    // parallel fan-outs and conditional decisions fail differently, so phrase them differently.
    const viaParallel = (ctx.g.outEdges.get(t.id) ?? []).some((e) => ctx.g.nodesById.get(e.to)?.type === "parallelGateway");
    for (const s of succ) {
      if (s.includes(", ")) {
        if (viaParallel) {
          rows.push([`"${t.name}" finished but only one of ${s} started`, `the fan-out after \`${t.id}\``, "Decisions & fan-outs below"]);
          rows.push([`"${t.name}" finished but ${noneOf(s)} happens`, `hand-off after \`${t.id}\``, "end of that step's section"]);
        } else {
          rows.push([`"${t.name}" finished but ${noneOf(s)} happens`, `hand-off after \`${t.id}\``, "end of that step's section"]);
          rows.push([`"${t.name}" finished and the WRONG one of those followed`, "the decision after it", "Decisions & fan-outs below"]);
        }
      } else {
        rows.push([`"${t.name}" finished but ${s} never happens`, `hand-off after \`${t.id}\``, "end of that step's section"]);
      }
    }
  }
  for (const gw of splits) {
    rows.push(
      gw.type === "parallelGateway"
        ? [`After "${gw.name}", one branch never starts`, `\`${gw.id}\``, "Decisions & fan-outs below"]
        : [`After "${gw.name}", the wrong branch runs`, `\`${gw.id}\``, "Decisions & fan-outs below"]
    );
  }
  plan.loops.forEach((l) => rows.push([`Steps repeat forever, or a retry never happens`, `loop \`${l.id}\``, "Loops below"]));
  for (const d of ir.data_objects) rows.push([`"${d.name}" is missing or wrong somewhere`, `data \`${d.id}\``, "Data below"]);
  blocks.push(["## Quick map", "", ...table(["What you're seeing", "Where to look", "Details"], rows)]);

  // Triage: walk the pipeline using the codebase map's "works when" signs.
  const triage: string[] = [
    "## Triage: something is broken but you don't know where",
    "",
    "Check the steps in the order the process runs them. For each, notes/codebase.md has a \"works when\" sign",
    "— one observable thing that is true when the step is healthy. **The first step whose sign fails is your culprit**;",
    "open its section below and hand the pointer to your AI tool.",
    ""
  ];
  if (splits.length > 0) {
    triage.push(
      "One caveat: this process takes branches (see Decisions & fan-outs). A step on a branch your case didn't take",
      "will legitimately show no sign — skip it, and if you suspect the WRONG branch was taken, go straight to that",
      "decision's row instead.",
      ""
    );
  }
  triage.push(...tasks.map((t, i) => `${i + 1}. ${oneLine(t.name)} (\`${t.id}\`)`));
  blocks.push(triage);

  blocks.push(["## Steps"]);
  for (const t of tasks) blocks.push(taskBlocks(ctx, t));

  if (splits.length > 0) {
    blocks.push(["## Decisions & fan-outs"]);
    for (const gw of splits) blocks.push(splitBlocks(ctx, gw));
  }

  if (plan.loops.length > 0) {
    blocks.push(["## Loops"]);
    plan.loops.forEach((_, i) => blocks.push(loopBlocks(ctx, plan, i)));
  }

  if (ir.data_objects.length > 0) {
    blocks.push(["## Data"]);
    for (const d of ir.data_objects) {
      const writers = ir.nodes.filter((n) => isTask(n) && (n.data?.writes ?? []).includes(d.id)).map((n) => nodeLabel(ctx, n.id));
      const readers = ir.nodes.filter((n) => isTask(n) && (n.data?.reads ?? []).includes(d.id)).map((n) => nodeLabel(ctx, n.id));
      const lines = [`### "${oneLine(d.name)}" is missing, empty, or wrong`, ""];
      const props = d.schema && typeof d.schema === "object" ? Object.keys((d.schema as { properties?: Record<string, unknown> }).properties ?? {}) : [];
      if (props.length > 0) lines.push(`- Its parts: ${props.map(oneLine).join(", ")}.`);
      if (writers.length > 0 && writers.length <= 3) {
        lines.push(`- It is created/updated by: ${writers.join(", ")}. Bad values start there.`);
      } else if (writers.length > 3) {
        lines.push(
          `- Most steps touch this record, so "who wrote it" doesn't narrow things down. Which step sets which part: ${fill(`data ${d.id} field-owners (finishing step)`, "after the final packet, assemble one line per part — naming the step and file that sets it — from the per-step sections of notes/codebase.md")}.`
        );
      }
      if (readers.length > 0) lines.push(`- It is used by: ${readers.join(", ")}. Those steps break first when it's wrong.`);
      lines.push(`- Where it lives in the code: ${fill(`data ${d.id}`, "file path and model/table/store name")}.`);
      blocks.push(lines);
    }
  }

  return renderDoc(blocks);
}

export function renderCodebaseNotes(ir: ProcessIR): string {
  const ctx = buildContext(ir);
  const tasks = tasksInOrder(ctx);
  const blocks: Block[] = [];
  blocks.push([notesBanner(ir)]);
  blocks.push([`# ${oneLine(ir.process.name)} — codebase map in plain words`]);
  blocks.push([
    "One section per step of the process, written by the builder immediately after building that step.",
    "Each section says, in everyday language: what the module does, which files belong to it, and how to",
    "tell that it is working. **A section left as a placeholder means that step is not built yet.**"
  ]);
  blocks.push([
    "## How it all runs",
    "",
    fill(
      "run-overview (after the final packet)",
      "3–6 sentences assembled from the per-step sections below plus the routing you wired: the entry point file first, then how the pieces start, talk to each other, and where the routing/orchestration lives"
    )
  ]);
  for (const t of tasks) {
    blocks.push([
      `## ${oneLine(t.name)} (\`${t.id}\`)`,
      "",
      fill(
        t.id,
        "right after building this packet, replace this whole marker with: (1) what it does in one or two everyday sentences; (2) Files: every file that belongs to this step; (3) Works when: one observable sign this step is functioning; (4) Watch out for: anything fragile or surprising"
      )
    ]);
  }
  return renderDoc(blocks);
}

export function generateProcessNotes(ir: ProcessIR): ProcessNotes {
  return { troubleshooting: renderTroubleshootingNotes(ir), codebase: renderCodebaseNotes(ir) };
}

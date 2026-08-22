/**
 * constitution.md — the non-negotiables of the system: who the actors are
 * (and therefore what needs a UI, what is automated, and what is somebody
 * else's system), the ground rules (non-functional requirements grouped by
 * category), and the standing assumptions the whole design rests on.
 *
 * Everything optional degrades by omission: a section with nothing to say is
 * not rendered at all, so a minimal IR yields a short but complete document.
 */
import type { LaneKind, NfrCategory, NonFunctionalRequirement } from "@vibestudio/ir";
import { banner, type SpecContext } from "./context.js";
import { oneLine, renderDoc, type Block } from "./markdown.js";

/**
 * Fixed category order (the IR's canonical enum order) rather than
 * first-appearance order, so reordering the NFR array never reorders the
 * document's rule groups.
 */
const NFR_CATEGORY_ORDER: readonly NfrCategory[] = [
  "performance",
  "security",
  "compliance",
  "reliability",
  "scalability",
  "usability",
  "observability",
  "cost",
  "other"
];

/**
 * The lane kind decides what building its tasks means, so each actor entry
 * spells that out instead of leaving the reader to decode "human/system/external".
 */
const LANE_KIND_NOTE: Readonly<Record<LaneKind, string>> = {
  human: "Tasks in this lane are performed by people and need a user interface.",
  system: "Tasks in this lane are automated and run without human interaction.",
  external: "Tasks in this lane belong to an external party — integrations we call or receive from, not systems we own."
};

export function renderConstitution(ctx: SpecContext): string {
  const { ir } = ctx;
  const blocks: Block[] = [[banner(ir)], [`# ${oneLine(ir.process.name)}`]];

  // The goal is a paragraph of its own, so it may keep its newlines —
  // renderDoc normalises trailing whitespace and blank-line runs inside it.
  if (ir.process.goal) blocks.push([ir.process.goal]);
  if (ir.process.domain) blocks.push([`Domain: ${oneLine(ir.process.domain)}`]);

  blocks.push(actorsBlock(ctx));
  blocks.push(...groundRulesBlocks(ctx));
  blocks.push(assumptionsBlock(ctx));

  return renderDoc(blocks);
}

function actorsBlock(ctx: SpecContext): Block {
  if (ctx.ir.lanes.length === 0) return [];
  const lines = ["## Actors and systems", ""];
  for (const lane of ctx.ir.lanes) {
    const desc = lane.description ? `${oneLine(lane.description)} ` : "";
    lines.push(`- **${oneLine(lane.name)}** (${lane.id}, ${lane.kind}) — ${desc}${LANE_KIND_NOTE[lane.kind]}`);
  }
  return lines;
}

/** Returns the "Ground rules" heading plus one sub-block per category that actually has rules. */
function groundRulesBlocks(ctx: SpecContext): Block[] {
  const nfrs = ctx.ir.requirements?.non_functional ?? [];
  if (nfrs.length === 0) return [];
  const byCategory = new Map<NfrCategory, NonFunctionalRequirement[]>();
  for (const nfr of nfrs) {
    const list = byCategory.get(nfr.category);
    if (list) list.push(nfr);
    else byCategory.set(nfr.category, [nfr]);
  }
  const blocks: Block[] = [["## Ground rules"]];
  for (const category of NFR_CATEGORY_ORDER) {
    const list = byCategory.get(category);
    if (!list) continue;
    const lines = [`### ${category.charAt(0).toUpperCase()}${category.slice(1)}`, ""];
    for (const nfr of list) lines.push(`- ${oneLine(nfr.statement)} (${nfr.id})`);
    blocks.push(lines);
  }
  return blocks;
}

function assumptionsBlock(ctx: SpecContext): Block {
  const assumptions = ctx.ir.requirements?.assumptions ?? [];
  if (assumptions.length === 0) return [];
  const lines = ["## Standing assumptions", ""];
  for (const a of assumptions) {
    // Confirmation state is the point of this section: an unconfirmed
    // assumption is a risk the implementer must know they are building on.
    const state = a.confirmed === true ? "confirmed" : "unconfirmed";
    lines.push(`- **${a.id}** (${state}) — ${oneLine(a.statement)}`);
  }
  return lines;
}

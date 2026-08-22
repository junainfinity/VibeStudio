/**
 * contracts/edge-<edge-id>.md — one file per edge. Every edge in the IR
 * carries a data contract, and these files are what a task implementer codes
 * against: which data objects are guaranteed present at the target, their
 * schemas, and the invariants that hold at that point in the flow. Gateway
 * endpoints are annotated with the nearest work node(s) so the contract
 * always names two pieces of work, never just plumbing.
 */
import { isGateway, type DataObject, type Edge } from "@vibestudio/ir";
import { banner, dataLabel, nodeLabel, workLabels, type SpecContext } from "./context.js";
import { inlineCode, oneLine, renderDoc, type Block } from "./markdown.js";
import type { SpecFile } from "./types.js";

/** Path of the per-edge contract file. The `edge-` prefix exists so no schema-valid
 * edge id (lowercase kebab-case, e.g. 'readme') can ever collide with the
 * generated contracts/README.md index on a case-insensitive filesystem. */
function contractPath(edgeId: string): string {
  return `contracts/edge-${edgeId}.md`;
}

/**
 * All contract files plus the contracts/README.md index, sorted by path
 * (code-unit order — locale-independent). The index is the fourth core file
 * of every kit: it exists even for a process with no edges, and because
 * "README.md" (uppercase R) sorts before the lowercase "edge-" prefix it
 * always leads the contracts/ listing without a special case in the ordering
 * contract.
 */
export function renderContracts(ctx: SpecContext): SpecFile[] {
  const seen = new Set<string>();
  const files: SpecFile[] = [];
  for (const edge of ctx.ir.edges) {
    // A duplicate edge id is invalid IR, but a generator that silently
    // overwrites a file would hide it; keep the first occurrence only.
    if (seen.has(edge.id)) continue;
    seen.add(edge.id);
    files.push({ path: contractPath(edge.id), content: renderContract(ctx, edge) });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  files.unshift({ path: "contracts/README.md", content: renderContractsIndex(ctx, files) });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

/** Index of the per-edge contracts, in the same sorted order as the files themselves. */
function renderContractsIndex(ctx: SpecContext, sortedFiles: readonly SpecFile[]): string {
  const blocks: Block[] = [[banner(ctx.ir)], ["# Data contracts"]];
  if (sortedFiles.length === 0) {
    blocks.push(["This process defines no sequence flows, so there are no data contracts."]);
    return renderDoc(blocks);
  }
  blocks.push([
    "One file per sequence-flow edge. Each contract lists the data objects guaranteed present at the target of the edge and the invariants that hold there."
  ]);
  const entries: string[] = [];
  for (const file of sortedFiles) {
    const edgeId = file.path.slice("contracts/edge-".length, -".md".length);
    const edge = ctx.g.edgesById.get(edgeId);
    if (!edge) continue;
    const carries = edge.data_contract.carries;
    const cargo = carries.length > 0 ? `carries ${carries.map((id) => dataLabel(ctx, id)).join(", ")}` : "carries nothing";
    entries.push(`- [${edge.id}](./edge-${edge.id}.md) — ${nodeLabel(ctx, edge.from)} -> ${nodeLabel(ctx, edge.to)}; ${cargo}`);
  }
  blocks.push(entries);
  return renderDoc(blocks);
}

function renderContract(ctx: SpecContext, edge: Edge): string {
  const blocks: Block[] = [
    [banner(ctx.ir)],
    [`# Contract: ${nodeLabel(ctx, edge.from)} -> ${nodeLabel(ctx, edge.to)}`]
  ];
  blocks.push(endpointsBlock(ctx, edge));
  blocks.push(edgeMetaBlock(edge));
  blocks.push(...carriesBlocks(ctx, edge));
  blocks.push(invariantsBlock(edge));
  return renderDoc(blocks);
}

/**
 * Present only when an endpoint is a gateway: the title already names work
 * nodes otherwise, and repeating them would say nothing new.
 */
function endpointsBlock(ctx: SpecContext, edge: Edge): Block {
  const lines: string[] = [];
  const from = ctx.g.nodesById.get(edge.from);
  const to = ctx.g.nodesById.get(edge.to);
  if (from && isGateway(from)) {
    lines.push(`- From work: ${workLabels(ctx, edge.from, "back")} — via gateway ${nodeLabel(ctx, edge.from)}`);
  }
  if (to && isGateway(to)) {
    lines.push(`- To work: ${workLabels(ctx, edge.to, "forward")} — via gateway ${nodeLabel(ctx, edge.to)}`);
  }
  return lines;
}

function edgeMetaBlock(edge: Edge): Block {
  const lines: string[] = [];
  if (edge.name) lines.push(`- Name: ${oneLine(edge.name)}`);
  if (edge.condition) {
    const lang = edge.condition.language ? ` (${edge.condition.language})` : "";
    lines.push(`- Condition: ${inlineCode(oneLine(edge.condition.expression))}${lang}`);
  }
  if (edge.is_default === true) lines.push("- Default branch: yes");
  return lines;
}

function carriesBlocks(ctx: SpecContext, edge: Edge): Block[] {
  const carries = edge.data_contract.carries;
  if (carries.length === 0) {
    // The section still exists so the reader learns the edge is deliberately
    // empty — an absent section would look like a generation gap.
    return [["## Carries"], ["This edge carries no data objects."]];
  }
  const blocks: Block[] = [["## Carries"]];
  for (const id of carries) {
    blocks.push(...dataObjectBlocks(ctx, id));
  }
  return blocks;
}

function dataObjectBlocks(ctx: SpecContext, id: string): Block[] {
  const blocks: Block[] = [[`### ${dataLabel(ctx, id)}`]];
  const d: DataObject | undefined = ctx.dataById.get(id);
  if (!d) {
    // Dangling reference: the validator's territory, but the contract file
    // must still say something rather than render an empty heading.
    blocks.push(["This data object is not defined in the document."]);
    return blocks;
  }
  if (d.description) blocks.push([d.description]);
  const facts: string[] = [];
  if (d.sensitivity) facts.push(`- Sensitivity: ${d.sensitivity}`);
  if (d.states && d.states.length > 0) facts.push(`- States: ${d.states.map((s) => oneLine(s)).join(", ")}`);
  blocks.push(facts);
  if (d.schema) {
    // JSON.stringify preserves the document's own key order, so identical
    // input schemas serialize identically on every run and machine.
    blocks.push(["Schema:", "", "```json", ...JSON.stringify(d.schema, null, 2).split("\n"), "```"]);
  }
  if (!d.description && facts.length === 0 && !d.schema) {
    blocks.push(["No further detail is recorded for this data object."]);
  }
  return blocks;
}

function invariantsBlock(edge: Edge): Block {
  const invariants = edge.data_contract.invariants ?? [];
  if (invariants.length === 0) return [];
  return ["## Invariants", "", ...invariants.map((inv) => `- ${oneLine(inv)}`)];
}

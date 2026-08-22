/**
 * @vibestudio/speckit — Process IR -> spec kit generator.
 *
 * Turns a validated ProcessIR into four kinds of markdown files: the
 * constitution (actors, ground rules, assumptions), the specification (one
 * section per task plus decisions and events), the build plan (topological
 * build order with input/output contracts, integrations, NFRs, open
 * questions) and one data-contract file per edge.
 *
 * The input is assumed to have passed `validate(ir, { mode: "final" })` —
 * this package never re-validates. It does degrade gracefully: optional IR
 * fields that are absent simply omit their section, and nothing ever renders
 * as 'undefined' or an empty list. Generation is fully deterministic: the
 * same document produces byte-identical files on every run.
 */
import type { ProcessIR } from "@vibestudio/ir";
import { buildContext } from "./context.js";
import { renderConstitution } from "./constitution.js";
import { renderContracts } from "./contracts.js";
import { renderPlan } from "./plan.js";
import { renderSpec } from "./spec.js";
import type { SpecFile, SpecKit } from "./types.js";

export type { SpecFile, SpecKit } from "./types.js";
export { generateProcessNotes, renderCodebaseNotes, renderTroubleshootingNotes, type ProcessNotes } from "./notes.js";
export {
  generateGraphPlan,
  renderGraphPlanMarkdown,
  type GraphPlan,
  type WorkPacket,
  type PacketFlow,
  type LoopInfo,
  type GatewayRoute
} from "./graphplan.js";

export function generateSpecKit(ir: ProcessIR): SpecKit {
  const ctx = buildContext(ir);
  const files: SpecFile[] = [
    { path: "constitution.md", content: renderConstitution(ctx) },
    { path: "spec.md", content: renderSpec(ctx) },
    { path: "plan.md", content: renderPlan(ctx) },
    ...renderContracts(ctx)
  ];
  return { files };
}

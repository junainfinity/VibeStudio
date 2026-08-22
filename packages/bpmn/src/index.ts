/**
 * @vibestudio/bpmn — Process IR → BPMN 2.0 XML.
 *
 * Two entry points, both pure functions of the IR (same input →
 * byte-identical output; no clock, no randomness, no object-key iteration):
 *
 * - {@link toBpmnXml}: the semantic layer only (`bpmn:definitions` +
 *   `bpmn:process`) — valid BPMN 2.0 without DI, for export/interchange.
 * - {@link irToBpmn}: the same document plus a `bpmndi:BPMNDiagram` computed
 *   by a deterministic layered layout, ready for bpmn-js
 *   `NavigatedViewer.importXML`. Async only to honour the agreed public
 *   signature (drop-in for layouters that are async); the work is synchronous.
 *
 * Layout decision: `bpmn-auto-layout` (route a) was probed first and found to
 * drop lane shapes entirely, so the DI comes from our own layered layout
 * (route b) and bpmn-auto-layout is never imported — see src/layout.ts for
 * the full rationale and geometry.
 */
import type { ProcessIR } from "@vibestudio/ir";
import { computeLayout, writeDi } from "./layout.js";
import { writeProcess } from "./semantic.js";
import { XmlWriter } from "./xml.js";

export interface BpmnOptions {
  /**
   * Also emit `bpmn:dataObject` / `bpmn:dataObjectReference` plus
   * dataInput/OutputAssociations from each node's `data.reads`/`writes`
   * (and DI shapes for them in {@link irToBpmn}). Default false: the
   * associations visually clutter the layout, so they are opt-in.
   */
  includeDataObjects?: boolean;
}

export type { DiagramLayout, Point, Rect } from "./layout.js";
export { computeLayout } from "./layout.js";

function render(ir: ProcessIR, opts: BpmnOptions | undefined, withDi: boolean): string {
  const includeDataObjects = opts?.includeDataObjects ?? false;
  const w = new XmlWriter();
  w.open("bpmn:definitions", [
    ["xmlns:bpmn", "http://www.omg.org/spec/BPMN/20100524/MODEL"],
    ["xmlns:bpmndi", "http://www.omg.org/spec/BPMN/20100524/DI"],
    ["xmlns:dc", "http://www.omg.org/spec/DD/20100524/DC"],
    ["xmlns:di", "http://www.omg.org/spec/DD/20100524/DI"],
    ["xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance"],
    ["id", `${ir.process.id}_definitions`],
    ["targetNamespace", "http://vibestudio.dev/process-ir"],
    ["exporter", "@vibestudio/bpmn"]
  ]);
  writeProcess(w, ir, { includeDataObjects });
  if (withDi) writeDi(w, ir, computeLayout(ir, includeDataObjects));
  w.close("bpmn:definitions");
  return w.toString();
}

/**
 * Transform a Process IR into BPMN 2.0 XML — semantic layer only (no DI).
 * The IR is assumed schema-valid (`validate()` it first); ids are used as-is
 * because IR ids are already NCNames.
 */
export function toBpmnXml(ir: ProcessIR, opts?: BpmnOptions): string {
  return render(ir, opts, false);
}

/**
 * Transform a Process IR into BPMN 2.0 XML *including* BPMNDI (lane shapes,
 * a shape per node — boundary events on their host's bottom border — and
 * waypointed edges), ready for bpmn-js `NavigatedViewer.importXML`.
 */
export async function irToBpmn(ir: ProcessIR, opts?: BpmnOptions): Promise<string> {
  return render(ir, opts, true);
}

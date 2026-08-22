/**
 * IR → semantic BPMN 2.0 (the `bpmn:process` subtree, no DI).
 *
 * The mapping is 1:1 by design of the IR (docs/process-ir-v1.md §5): IR node
 * `type` values ARE the BPMN element names, IR ids are kebab-case NCNames and
 * are used as-is. Everything generated on top of the IR (event-definition ids,
 * the laneSet id, data-association ids …) contains an underscore, which the
 * IR's kebab-case id grammar forbids — so generated ids can never collide
 * with document ids, without needing a registry.
 *
 * Element order inside each parent follows the BPMN 2.0 XSD content model
 * (documentation first, data associations before event definitions, …) so
 * strict parsers accept the output; within a class of siblings the IR array
 * order is preserved, which is what makes the output deterministic.
 */
import {
  isGateway,
  isTask,
  type Edge,
  type EndResultKind,
  type Node,
  type ProcessIR,
  type TriggerKind
} from "@vibestudio/ir";
import type { AttrList, XmlWriter } from "./xml.js";

export interface SemanticOptions {
  includeDataObjects: boolean;
}

/** One `bpmn:dataInputAssociation` / `bpmn:dataOutputAssociation` to emit. */
export interface DataAssociation {
  /** Generated id (contains `_`, so it cannot collide with any IR id). */
  id: string;
  /** Relative to the node: "in" reads the object, "out" writes it. */
  direction: "in" | "out";
  /** Id of the `bpmn:dataObjectReference` (same id as the IR data object). */
  dataObjectId: string;
}

/**
 * The data associations a node contributes when data objects are included.
 * Tasks may read and write. Catch events (start, intermediate catch,
 * boundary) only have data OUTPUTS in BPMN (`tCatchEvent` has
 * dataOutputAssociation and no input side), so an intermediateCatchEvent's
 * `reads` intentionally stay IR-only rather than producing invalid XML.
 *
 * Shared with the layout module so the DI edges match the semantic layer
 * association-for-association.
 */
export function dataAssociationsOf(node: Node): DataAssociation[] {
  let reads: readonly string[] = [];
  let writes: readonly string[] = [];
  if (isTask(node)) {
    reads = node.data?.reads ?? [];
    writes = node.data?.writes ?? [];
  } else if (
    node.type === "startEvent" ||
    node.type === "boundaryEvent" ||
    node.type === "intermediateCatchEvent"
  ) {
    writes = node.data?.writes ?? [];
  }
  const out: DataAssociation[] = [];
  reads.forEach((dataObjectId, index) => {
    out.push({ id: `${node.id}_din_${index}`, direction: "in", dataObjectId });
  });
  writes.forEach((dataObjectId, index) => {
    out.push({ id: `${node.id}_dout_${index}`, direction: "out", dataObjectId });
  });
  return out;
}

interface EventDefinitionSpec {
  readonly element: string;
  readonly id: string;
}

/**
 * IR trigger/result kinds → BPMN event-definition elements. `none` (and an
 * absent trigger/result) maps to no event definition at all, per the mapping
 * table: a plain start/end event carries nothing.
 */
function eventDefinitionFor(node: Node): EventDefinitionSpec | undefined {
  let kind: TriggerKind | EndResultKind | undefined;
  switch (node.type) {
    case "startEvent":
      kind = node.trigger?.kind;
      break;
    case "intermediateCatchEvent":
    case "boundaryEvent":
      kind = node.trigger.kind;
      break;
    case "endEvent":
      kind = node.result?.kind;
      break;
    default:
      return undefined;
  }
  if (kind === undefined || kind === "none") return undefined;
  const element = {
    message: "bpmn:messageEventDefinition",
    timer: "bpmn:timerEventDefinition",
    signal: "bpmn:signalEventDefinition",
    error: "bpmn:errorEventDefinition",
    terminate: "bpmn:terminateEventDefinition"
  }[kind];
  return { element, id: `${node.id}_def` };
}

/**
 * Edge contract → human-readable documentation, so the contract survives into
 * XML exports viewed outside VibeStudio (e.g. "carries: order, receipt").
 */
function contractDocumentation(edge: Edge): string | undefined {
  const contract = edge.data_contract;
  const parts: string[] = [];
  if (contract.description !== undefined && contract.description !== "") {
    parts.push(contract.description);
  }
  if (contract.carries.length > 0) {
    parts.push(`carries: ${contract.carries.join(", ")}`);
  }
  for (const invariant of contract.invariants ?? []) {
    parts.push(`invariant: ${invariant}`);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function writeFlowNode(
  w: XmlWriter,
  node: Node,
  defaultFlowByGateway: ReadonlyMap<string, string>,
  opts: SemanticOptions
): void {
  const tag = `bpmn:${node.type}`;
  const attrs: AttrList = [
    ["id", node.id],
    ["name", node.name]
  ];
  if (isGateway(node)) {
    attrs.push(["gatewayDirection", node.direction === "split" ? "Diverging" : "Converging"]);
    const defaultFlow = defaultFlowByGateway.get(node.id);
    // `default` exists on exclusive/inclusive gateways only; the validator
    // already rejects is_default on parallel splits, the guard is belt+braces.
    if (defaultFlow !== undefined && node.type !== "parallelGateway") {
      attrs.push(["default", defaultFlow]);
    }
  }
  if (node.type === "boundaryEvent") {
    attrs.push(["attachedToRef", node.attached_to]);
    // BPMN's default is cancelActivity="true", so only an explicitly
    // non-interrupting IR event needs the attribute.
    if (node.interrupting === false) attrs.push(["cancelActivity", "false"]);
  }

  const associations = opts.includeDataObjects ? dataAssociationsOf(node) : [];
  const eventDefinition = eventDefinitionFor(node);
  const hasDescription = node.description !== undefined && node.description !== "";
  if (!hasDescription && associations.length === 0 && eventDefinition === undefined) {
    w.leaf(tag, attrs);
    return;
  }

  w.open(tag, attrs);
  if (hasDescription && node.description !== undefined) {
    w.textElement("bpmn:documentation", node.description);
  }
  if (isTask(node)) {
    // XSD order on activities: property* → dataInputAssociation* →
    // dataOutputAssociation*. The property is the same placeholder trick
    // bpmn-js uses: a data input association needs an ItemAwareElement
    // targetRef, and a task-local property is the smallest one.
    if (associations.some((a) => a.direction === "in")) {
      w.leaf("bpmn:property", [
        ["id", `${node.id}_prop`],
        ["name", "__targetRef_placeholder"]
      ]);
    }
    for (const association of associations) {
      if (association.direction !== "in") continue;
      w.open("bpmn:dataInputAssociation", [["id", association.id]]);
      w.textElement("bpmn:sourceRef", association.dataObjectId);
      w.textElement("bpmn:targetRef", `${node.id}_prop`);
      w.close("bpmn:dataInputAssociation");
    }
    for (const association of associations) {
      if (association.direction !== "out") continue;
      w.open("bpmn:dataOutputAssociation", [["id", association.id]]);
      w.textElement("bpmn:targetRef", association.dataObjectId);
      w.close("bpmn:dataOutputAssociation");
    }
  } else {
    // Catch events: outputs only, and per tCatchEvent they precede the
    // event definition.
    for (const association of associations) {
      w.open("bpmn:dataOutputAssociation", [["id", association.id]]);
      w.textElement("bpmn:targetRef", association.dataObjectId);
      w.close("bpmn:dataOutputAssociation");
    }
  }
  if (eventDefinition !== undefined) {
    w.leaf(eventDefinition.element, [["id", eventDefinition.id]]);
  }
  w.close(tag);
}

function writeSequenceFlow(w: XmlWriter, edge: Edge): void {
  const attrs: AttrList = [["id", edge.id]];
  if (edge.name !== undefined) attrs.push(["name", edge.name]);
  attrs.push(["sourceRef", edge.from], ["targetRef", edge.to]);

  const documentation = contractDocumentation(edge);
  const condition = edge.condition;
  if (documentation === undefined && condition === undefined) {
    w.leaf("bpmn:sequenceFlow", attrs);
    return;
  }
  w.open("bpmn:sequenceFlow", attrs);
  if (documentation !== undefined) w.textElement("bpmn:documentation", documentation);
  if (condition !== undefined) {
    const conditionAttrs: AttrList = [["xsi:type", "bpmn:tFormalExpression"]];
    // Formal languages are machine-readable and get the language attribute;
    // `natural` (the default) is prose and stays a plain text body.
    if (condition.language === "cel" || condition.language === "javascript") {
      conditionAttrs.push(["language", condition.language]);
    }
    w.textElement("bpmn:conditionExpression", condition.expression, conditionAttrs);
  }
  w.close("bpmn:sequenceFlow");
}

/** Emit the whole `bpmn:process` subtree into `w`. */
export function writeProcess(w: XmlWriter, ir: ProcessIR, opts: SemanticOptions): void {
  // At most one default per gateway is guaranteed by the validator; Map
  // last-write-wins keeps this deterministic even for unvalidated input.
  const defaultFlowByGateway = new Map<string, string>();
  for (const edge of ir.edges) {
    if (edge.is_default === true) defaultFlowByGateway.set(edge.from, edge.id);
  }

  w.open("bpmn:process", [
    ["id", ir.process.id],
    ["name", ir.process.name],
    ["isExecutable", "false"]
  ]);
  if (ir.process.description !== undefined && ir.process.description !== "") {
    w.textElement("bpmn:documentation", ir.process.description);
  }

  w.open("bpmn:laneSet", [["id", `${ir.process.id}_laneSet`]]);
  for (const lane of ir.lanes) {
    w.open("bpmn:lane", [
      ["id", lane.id],
      ["name", lane.name]
    ]);
    if (lane.description !== undefined && lane.description !== "") {
      w.textElement("bpmn:documentation", lane.description);
    }
    // Boundary events keep their IR lane assignment here even though they are
    // drawn on their host's border; the IR validator already warns when the
    // two lanes differ (boundary.lane-mismatch).
    for (const node of ir.nodes) {
      if (node.lane === lane.id) w.textElement("bpmn:flowNodeRef", node.id);
    }
    w.close("bpmn:lane");
  }
  w.close("bpmn:laneSet");

  if (opts.includeDataObjects) {
    for (const dataObject of ir.data_objects) {
      // bpmn-js convention: an invisible bpmn:dataObject plus a visible
      // bpmn:dataObjectReference. The IR id goes on the REFERENCE because
      // that is what associations point at and what gets a DI shape.
      w.leaf("bpmn:dataObject", [["id", `${dataObject.id}_obj`]]);
      const referenceAttrs: AttrList = [
        ["id", dataObject.id],
        ["name", dataObject.name],
        ["dataObjectRef", `${dataObject.id}_obj`]
      ];
      if (dataObject.description !== undefined && dataObject.description !== "") {
        w.open("bpmn:dataObjectReference", referenceAttrs);
        w.textElement("bpmn:documentation", dataObject.description);
        w.close("bpmn:dataObjectReference");
      } else {
        w.leaf("bpmn:dataObjectReference", referenceAttrs);
      }
    }
  }

  for (const node of ir.nodes) writeFlowNode(w, node, defaultFlowByGateway, opts);
  for (const edge of ir.edges) writeSequenceFlow(w, edge);

  w.close("bpmn:process");
}

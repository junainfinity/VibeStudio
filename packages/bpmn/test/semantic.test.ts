import { describe, expect, it } from "vitest";
import { validate } from "@vibestudio/ir";
import { toBpmnXml } from "../src/index.js";
import { checkout, eventsIr, leaveRequest, loopIr } from "./fixtures.js";
import {
  byId,
  byType,
  documentationOf,
  flowElementsOf,
  parse,
  processOf,
  prop,
  type ModdleElement
} from "./helpers.js";

const FLOW_NODE_TYPES = new Set([
  "bpmn:StartEvent",
  "bpmn:EndEvent",
  "bpmn:IntermediateCatchEvent",
  "bpmn:BoundaryEvent",
  "bpmn:UserTask",
  "bpmn:ServiceTask",
  "bpmn:ScriptTask",
  "bpmn:SendTask",
  "bpmn:ReceiveTask",
  "bpmn:ManualTask",
  "bpmn:BusinessRuleTask",
  "bpmn:ExclusiveGateway",
  "bpmn:ParallelGateway",
  "bpmn:InclusiveGateway"
]);

describe("toBpmnXml(checkout) — semantic layer", () => {
  const ir = checkout();
  const xml = toBpmnXml(ir);

  it("parses with bpmn-moddle without a single warning", async () => {
    const { rootElement, warnings } = await parse(xml);
    expect(warnings).toEqual([]);
    expect(rootElement.$type).toBe("bpmn:Definitions");
  });

  it("emits one non-executable process with the IR's id and name", async () => {
    const { rootElement } = await parse(xml);
    const process = processOf(rootElement);
    expect(process.id).toBe("checkout");
    expect(prop<string>(process, "name")).toBe("Checkout");
    expect(prop<boolean>(process, "isExecutable")).toBe(false);
    expect(documentationOf(process)).toBe(ir.process.description);
  });

  it("has exactly the IR's flow nodes and sequence flows (counted from the file)", async () => {
    // Guard the expectations against silent example drift first.
    expect(ir.nodes).toHaveLength(18);
    expect(ir.edges).toHaveLength(18);

    const { rootElement } = await parse(xml);
    const elements = flowElementsOf(processOf(rootElement));
    const flowNodes = elements.filter((element) => FLOW_NODE_TYPES.has(element.$type));
    const flows = byType(elements, "bpmn:SequenceFlow");
    expect(flowNodes).toHaveLength(18);
    expect(flows).toHaveLength(18);
    expect(new Set(flowNodes.map((node) => node.id))).toEqual(new Set(ir.nodes.map((n) => n.id)));
    expect(new Set(flows.map((flow) => flow.id))).toEqual(new Set(ir.edges.map((e) => e.id)));
    // Node types map 1:1 (IR type value === BPMN element name).
    for (const node of ir.nodes) {
      expect(byId(flowNodes, node.id).$type).toBe(`bpmn:${node.type[0]!.toUpperCase()}${node.type.slice(1)}`);
    }
  });

  it("keeps sourceRef/targetRef and names on sequence flows", async () => {
    const { rootElement } = await parse(xml);
    const flows = byType(flowElementsOf(processOf(rootElement)), "bpmn:SequenceFlow");
    for (const edge of ir.edges) {
      const flow = byId(flows, edge.id);
      expect(prop<ModdleElement>(flow, "sourceRef").id).toBe(edge.from);
      expect(prop<ModdleElement>(flow, "targetRef").id).toBe(edge.to);
      if (edge.name !== undefined) expect(prop<string>(flow, "name")).toBe(edge.name);
    }

  });

  it("attaches the boundary event to the right task, interrupting by default", async () => {
    const { rootElement } = await parse(xml);
    const elements = flowElementsOf(processOf(rootElement));
    const boundary = byId(elements, "payment-provider-error");
    expect(boundary.$type).toBe("bpmn:BoundaryEvent");
    expect(prop<ModdleElement>(boundary, "attachedToRef").id).toBe("payment-init");
    // interrupting: true in the IR → attribute omitted → BPMN default true.
    expect(prop<boolean>(boundary, "cancelActivity")).toBe(true);
    expect(xml).not.toContain("cancelActivity");
    const definitions = prop<ModdleElement[]>(boundary, "eventDefinitions");
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.$type).toBe("bpmn:ErrorEventDefinition");
  });

  it("marks gateway directions and puts `default` on the source gateway", async () => {
    const { rootElement } = await parse(xml);
    const elements = flowElementsOf(processOf(rootElement));
    expect(prop<string>(byId(elements, "gw-valid"), "gatewayDirection")).toBe("Diverging");
    expect(prop<string>(byId(elements, "gw-retry-merge"), "gatewayDirection")).toBe("Converging");
    expect(prop<string>(byId(elements, "gw-fulfil-join"), "gatewayDirection")).toBe("Converging");
    expect(prop<ModdleElement>(byId(elements, "gw-valid"), "default").id).toBe("e-valid-no");
    expect(prop<ModdleElement>(byId(elements, "gw-paid"), "default").id).toBe("e-paid-no");
    expect(prop<ModdleElement | undefined>(byId(elements, "gw-fulfil-split"), "default")).toBeUndefined();
  });

  it("renders conditions as tFormalExpression with language only when formal", async () => {
    const { rootElement } = await parse(xml);
    const flows = byType(flowElementsOf(processOf(rootElement)), "bpmn:SequenceFlow");
    const validYes = prop<ModdleElement>(byId(flows, "e-valid-yes"), "conditionExpression");
    expect(prop<string>(validYes, "body")).toBe("order.status == 'validated'");
    expect(prop<string>(validYes, "language")).toBe("javascript");
    const retry = prop<ModdleElement>(byId(flows, "e-paid-retry"), "conditionExpression");
    expect(prop<string>(retry, "body")).toBe(
      "payment_result.status == 'declined' && order.payment_attempts < 3"
    );
    // Default flows carry no condition.
    expect(prop<ModdleElement | undefined>(byId(flows, "e-valid-no"), "conditionExpression")).toBeUndefined();
  });

  it("maps the message start trigger and error end result to event definitions", async () => {
    const { rootElement } = await parse(xml);
    const elements = flowElementsOf(processOf(rootElement));
    const start = prop<ModdleElement[]>(byId(elements, "start-checkout"), "eventDefinitions");
    expect(start.map((d) => d.$type)).toEqual(["bpmn:MessageEventDefinition"]);
    const errorEnd = prop<ModdleElement[]>(byId(elements, "end-payment-error"), "eventDefinitions");
    expect(errorEnd.map((d) => d.$type)).toEqual(["bpmn:ErrorEventDefinition"]);
    // `none` results stay bare.
    const plainEnd = prop<ModdleElement[] | undefined>(byId(elements, "end-order-placed"), "eventDefinitions") ?? [];
    expect(plainEnd).toHaveLength(0);
  });

  it("emits one laneSet with 3 lanes and the exact flowNodeRefs from the IR", async () => {
    const { rootElement } = await parse(xml);
    const process = processOf(rootElement);
    const laneSets = prop<ModdleElement[]>(process, "laneSets");
    expect(laneSets).toHaveLength(1);
    const lanes = prop<ModdleElement[]>(laneSets[0]!, "lanes");
    expect(lanes.map((lane) => lane.id)).toEqual(ir.lanes.map((lane) => lane.id));
    for (const lane of ir.lanes) {
      const expected = ir.nodes.filter((node) => node.lane === lane.id).map((node) => node.id);
      const actual = (prop<ModdleElement[] | undefined>(byId(lanes, lane.id), "flowNodeRef") ?? []).map(
        (node) => node.id
      );
      expect(actual).toEqual(expected);
    }
    // The boundary event keeps its IR lane assignment.
    const providerRefs = prop<ModdleElement[]>(byId(lanes, "payment-provider"), "flowNodeRef");
    expect(providerRefs.map((node) => node.id)).toContain("payment-provider-error");
  });

  it("surfaces the edge data contract in the sequence flow documentation", async () => {
    const { rootElement } = await parse(xml);
    const flows = byType(flowElementsOf(processOf(rootElement)), "bpmn:SequenceFlow");
    const doc = documentationOf(byId(flows, "e-join-end"));
    expect(doc).toContain("carries: order, receipt, inventory-reservation");
    const withInvariant = documentationOf(byId(flows, "e-review-validate"));
    expect(withInvariant).toContain("carries: cart");
    expect(withInvariant).toContain("invariant: cart.status == 'locked'");
  });

  it("omits data objects and BPMNDI by default", async () => {
    const { rootElement } = await parse(xml);
    const elements = flowElementsOf(processOf(rootElement));
    expect(byType(elements, "bpmn:DataObjectReference")).toHaveLength(0);
    expect(byType(elements, "bpmn:DataObject")).toHaveLength(0);
    expect(prop<ModdleElement[] | undefined>(rootElement, "diagrams") ?? []).toHaveLength(0);
  });
});

describe("toBpmnXml(leave-request) — draft example", () => {
  const ir = leaveRequest();

  it("transforms cleanly: zero warnings, all nodes and flows present", async () => {
    const { rootElement, warnings } = await parse(toBpmnXml(ir));
    expect(warnings).toEqual([]);
    const elements = flowElementsOf(processOf(rootElement));
    expect(byType(elements, "bpmn:SequenceFlow")).toHaveLength(ir.edges.length);
    for (const node of ir.nodes) expect(byId(elements, node.id).id).toBe(node.id);
  });

  it("keeps natural-language conditions as plain text bodies without a language", async () => {
    const { rootElement } = await parse(toBpmnXml(ir));
    const flows = byType(flowElementsOf(processOf(rootElement)), "bpmn:SequenceFlow");
    const condition = prop<ModdleElement>(byId(flows, "e4"), "conditionExpression");
    expect(prop<string>(condition, "body")).toBe("decision is approved");
    expect(prop<string | undefined>(condition, "language")).toBeUndefined();
  });
});

describe("event definition coverage beyond the examples", () => {
  it("fixtures are well-formed IR (no draft-mode errors)", () => {
    expect(validate(eventsIr(), { mode: "draft" }).counts.error).toBe(0);
    expect(validate(loopIr(), { mode: "draft" }).counts.error).toBe(0);
  });

  it("maps timer start, signal catch and terminate end", async () => {
    const { rootElement, warnings } = await parse(toBpmnXml(eventsIr()));
    expect(warnings).toEqual([]);
    const elements = flowElementsOf(processOf(rootElement));
    const start = prop<ModdleElement[]>(byId(elements, "ev-start"), "eventDefinitions");
    expect(start.map((d) => d.$type)).toEqual(["bpmn:TimerEventDefinition"]);
    const wait = byId(elements, "ev-wait");
    expect(wait.$type).toBe("bpmn:IntermediateCatchEvent");
    expect(prop<ModdleElement[]>(wait, "eventDefinitions").map((d) => d.$type)).toEqual([
      "bpmn:SignalEventDefinition"
    ]);
    const terminate = prop<ModdleElement[]>(byId(elements, "ev-done"), "eventDefinitions");
    expect(terminate.map((d) => d.$type)).toEqual(["bpmn:TerminateEventDefinition"]);
  });
});

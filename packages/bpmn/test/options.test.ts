import { describe, expect, it } from "vitest";
import { irToBpmn, toBpmnXml } from "../src/index.js";
import {
  checkout,
  nastyIr,
  NASTY_DESCRIPTION,
  NASTY_EDGE_NAME,
  NASTY_TASK_NAME
} from "./fixtures.js";
import {
  byId,
  byType,
  diOf,
  documentationOf,
  flowElementsOf,
  parse,
  processOf,
  prop,
  type ModdleElement
} from "./helpers.js";

describe("XML escaping", () => {
  it("escapes &, <, >, quotes in names and documentation, and round-trips them", async () => {
    const xml = toBpmnXml(nastyIr());
    // The raw metacharacters must not survive into markup...
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&quot;");
    expect(xml).toContain("&apos;");
    expect(xml).not.toContain(`name="Review & `);
    // ...and parsing must restore the exact original strings.
    const { rootElement, warnings } = await parse(xml);
    expect(warnings).toEqual([]);
    const elements = flowElementsOf(processOf(rootElement));
    expect(prop<string>(byId(elements, "nasty-task"), "name")).toBe(NASTY_TASK_NAME);
    expect(documentationOf(byId(elements, "nasty-task"))).toBe(NASTY_DESCRIPTION);
    expect(prop<string>(byId(elements, "ne-2"), "name")).toBe(NASTY_EDGE_NAME);
    expect(prop<string>(byId(elements, "nasty-start"), "name")).toBe("<go>");
  });
});

describe("XML 1.0 well-formedness hardening (adversarial review)", () => {
  it("strips control characters the XML 1.0 Char production forbids (e.g. BEL from a JSON round-trip)", async () => {
    const ir = nastyIr();
    const task = ir.nodes.find((node) => node.id === "nasty-task")!;
    (task as { description?: string }).description = "Ding\u0007! now\u0000 \u000B\u000C\u001Fdone";
    (task as { name: string }).name = "Bell\u0007 name";
    const xml = toBpmnXml(ir);
    // No XML-1.0-illegal character may survive into the document...
    // eslint-disable-next-line no-control-regex
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    // ...and the reference parser accepts it without a single warning.
    const { rootElement, warnings } = await parse(xml);
    expect(warnings).toEqual([]);
    const elements = flowElementsOf(processOf(rootElement));
    expect(prop<string>(byId(elements, "nasty-task"), "name")).toBe("Bell name");
    expect(documentationOf(byId(elements, "nasty-task"))).toBe("Ding! now done");
  });

  it("numerically escapes newline/tab/CR in attributes so multi-line names survive attribute-value normalization", async () => {
    const ir = nastyIr();
    const task = ir.nodes.find((node) => node.id === "nasty-task")!;
    (task as { name: string }).name = "line one\nline two";
    const edge = ir.edges.find((candidate) => candidate.id === "ne-2")!;
    (edge as { name?: string }).name = "tab\there\rcr";
    const xml = toBpmnXml(ir);
    // The attribute value must carry character references, not raw whitespace
    // (a conforming parser normalizes raw \n \r \t in attributes to spaces).
    expect(xml).toContain('name="line one&#10;line two"');
    expect(xml).toContain('name="tab&#9;here&#13;cr"');
    const { rootElement, warnings } = await parse(xml);
    expect(warnings).toEqual([]);
    const elements = flowElementsOf(processOf(rootElement));
    expect(prop<string>(byId(elements, "nasty-task"), "name")).toBe("line one\nline two");
    expect(prop<string>(byId(elements, "ne-2"), "name")).toBe("tab\there\rcr");
  });

  it("keeps literal newlines in text nodes (documentation)", async () => {
    const ir = nastyIr();
    const task = ir.nodes.find((node) => node.id === "nasty-task")!;
    (task as { description?: string }).description = "first line\nsecond line";
    const xml = toBpmnXml(ir);
    expect(xml).toContain(">first line\nsecond line</bpmn:documentation>");
    const { rootElement, warnings } = await parse(xml);
    expect(warnings).toEqual([]);
    const elements = flowElementsOf(processOf(rootElement));
    expect(documentationOf(byId(elements, "nasty-task"))).toBe("first line\nsecond line");
  });
});

describe("includeDataObjects", () => {
  it("false (default) emits no data objects or associations", async () => {
    const { rootElement } = await parse(toBpmnXml(checkout()));
    const elements = flowElementsOf(processOf(rootElement));
    expect(byType(elements, "bpmn:DataObjectReference")).toHaveLength(0);
    const task = byId(elements, "cart-review");
    expect(prop<ModdleElement[] | undefined>(task, "dataInputAssociations") ?? []).toHaveLength(0);
    expect(prop<ModdleElement[] | undefined>(task, "dataOutputAssociations") ?? []).toHaveLength(0);
  });

  it("true emits dataObject + dataObjectReference per IR data object, with zero warnings", async () => {
    const ir = checkout();
    const { rootElement, warnings } = await parse(toBpmnXml(ir, { includeDataObjects: true }));
    expect(warnings).toEqual([]);
    const elements = flowElementsOf(processOf(rootElement));
    const references = byType(elements, "bpmn:DataObjectReference");
    expect(references.map((ref) => ref.id)).toEqual(ir.data_objects.map((d) => d.id));
    expect(byType(elements, "bpmn:DataObject")).toHaveLength(ir.data_objects.length);
    for (const reference of references) {
      expect(prop<ModdleElement>(reference, "dataObjectRef").$type).toBe("bpmn:DataObject");
    }
  });

  it("true wires reads → dataInputAssociation and writes → dataOutputAssociation", async () => {
    const { rootElement } = await parse(toBpmnXml(checkout(), { includeDataObjects: true }));
    const elements = flowElementsOf(processOf(rootElement));

    // Task with reads+writes: cart-review reads [cart], writes [cart].
    const task = byId(elements, "cart-review");
    const inputs = prop<ModdleElement[]>(task, "dataInputAssociations");
    expect(inputs).toHaveLength(1);
    expect(prop<ModdleElement[]>(inputs[0]!, "sourceRef").map((s) => s.id)).toEqual(["cart"]);
    const outputs = prop<ModdleElement[]>(task, "dataOutputAssociations");
    expect(outputs).toHaveLength(1);
    expect(prop<ModdleElement>(outputs[0]!, "targetRef").id).toBe("cart");

    // Catch event with writes: the start event's trigger payload.
    const start = byId(elements, "start-checkout");
    const startOutputs = prop<ModdleElement[]>(start, "dataOutputAssociations");
    expect(startOutputs).toHaveLength(1);
    expect(prop<ModdleElement>(startOutputs[0]!, "targetRef").id).toBe("cart");
  });

  it("irToBpmn adds DI shapes for data object references and edges for associations", async () => {
    const ir = checkout();
    const { rootElement, warnings } = await parse(await irToBpmn(ir, { includeDataObjects: true }));
    expect(warnings).toEqual([]);
    const di = diOf(rootElement);
    for (const dataObject of ir.data_objects) {
      expect(di.shapes.has(dataObject.id), `shape for ${dataObject.id}`).toBe(true);
    }
    // cart-review's read association got an edge with 2 waypoints.
    const association = di.edges.get("cart-review_din_0");
    expect(association).toBeDefined();
    expect(prop<ModdleElement[]>(association!, "waypoint")).toHaveLength(2);
  });
});

describe("determinism", () => {
  it("two independent runs produce byte-identical strings", async () => {
    // Fresh JSON.parse per call: identical content, distinct object identity.
    expect(toBpmnXml(checkout())).toBe(toBpmnXml(checkout()));
    expect(await irToBpmn(checkout())).toBe(await irToBpmn(checkout()));
    expect(await irToBpmn(checkout(), { includeDataObjects: true })).toBe(
      await irToBpmn(checkout(), { includeDataObjects: true })
    );
  });

  it("semantic layer is a prefix decision, not a different document: no DI in toBpmnXml", () => {
    expect(toBpmnXml(checkout())).not.toContain("BPMNDiagram");
  });
});

import { describe, expect, it } from "vitest";
import { createAjv, loadSchema, schemaValidator } from "../src/schema.js";
import { validate } from "../src/validate.js";
import { loadCheckout, mutate } from "./helpers.js";

describe("Process IR JSON Schema", () => {
  it("compiles under strict Ajv (2020-12) with the discriminator", () => {
    expect(() => createAjv().compile(loadSchema())).not.toThrow();
  });

  it("accepts the checkout example", () => {
    const v = schemaValidator();
    expect(v(loadCheckout())).toBe(true);
  });

  it("rejects an unknown node type with a discriminator hint", () => {
    const doc = mutate((ir) => {
      (ir.nodes[1] as { type: string }).type = "weirdTask";
    });
    const r = validate(doc);
    const f = r.findings.filter((x) => x.rule === "schema.invalid");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]!.message).toMatch(/weirdTask|tag/);
    expect(f[0]!.path).toBe("/nodes/1");
    expect(f[0]!.fix).toMatch(/startEvent, endEvent/);
  });

  it("rejects unknown fields and names the field", () => {
    const doc = mutate((ir) => {
      (ir.nodes[1] as unknown as Record<string, unknown>).owner = "bob";
    });
    const r = validate(doc);
    const f = r.findings.find((x) => x.rule === "schema.invalid");
    expect(f?.message).toContain("'owner'");
    expect(f?.message).toContain("in node 'cart-review'");
  });

  it("rejects non-kebab-case ids", () => {
    const doc = mutate((ir) => {
      ir.lanes[0]!.id = "Customer_Lane";
    });
    const r = validate(doc);
    expect(r.schema_valid).toBe(false);
    expect(r.findings.some((f) => f.rule === "schema.invalid" && f.path === "/lanes/0/id")).toBe(true);
  });

  it("requires a data_contract on every edge", () => {
    const doc = mutate((ir) => {
      delete (ir.edges[0] as Partial<(typeof ir.edges)[0]>).data_contract;
    });
    const r = validate(doc);
    expect(r.findings.some((f) => f.rule === "schema.invalid" && f.path === "/edges/0" && f.message.includes("data_contract"))).toBe(true);
  });

  it("requires attached_to on boundary events and direction on gateways", () => {
    const doc = mutate((ir) => {
      delete (ir.nodes.find((n) => n.id === "payment-provider-error") as Partial<{ attached_to: string }>).attached_to;
      delete (ir.nodes.find((n) => n.id === "gw-valid") as Partial<{ direction: string }>).direction;
    });
    const r = validate(doc);
    const msgs = r.findings.filter((f) => f.rule === "schema.invalid").map((f) => f.message);
    expect(msgs.some((m) => m.includes("attached_to"))).toBe(true);
    expect(msgs.some((m) => m.includes("direction"))).toBe(true);
  });

  it("forbids reads on start events (payload only)", () => {
    const doc = mutate((ir) => {
      (ir.nodes[0] as { data: unknown }).data = { reads: ["cart"] };
    });
    const r = validate(doc);
    expect(r.findings.some((f) => f.rule === "schema.invalid" && f.path.startsWith("/nodes/0/data"))).toBe(true);
  });

  it("validates data-object schemas against the 2020-12 metaschema (via compile)", () => {
    const doc = mutate((ir) => {
      ir.data_objects[0]!.schema = { type: "object", required: "id" }; // required must be an array
    });
    const r = validate(doc);
    expect(r.schema_valid).toBe(true); // the outer schema only demands an object
    const f = r.findings.find((x) => x.rule === "data.schema-invalid" && x.path === "/data_objects/0/schema");
    expect(f).toBeDefined();
    expect(f!.message).toMatch(/required must be array/);
    const bool = mutate((ir) => {
      (ir.data_objects[0] as { schema: unknown }).schema = true; // boolean schemas are not accepted
    });
    expect(validate(bool).findings.some((x) => x.rule === "schema.invalid" && x.path === "/data_objects/0/schema")).toBe(true);
  });

  it("only reports schema findings for documents that are not IR-shaped", () => {
    const r = validate({ hello: "world" });
    expect(r.ok).toBe(false);
    expect(r.findings.every((f) => f.rule === "schema.invalid")).toBe(true);
    const r2 = validate("nope");
    expect(r2.ok).toBe(false);
  });

  it("still runs semantic rules when the schema fails but the shape is sane", () => {
    const doc = mutate((ir) => {
      (ir.nodes[1] as unknown as Record<string, unknown>).owner = "bob"; // schema error
      delete (ir.nodes.find((n) => n.id === "gw-fulfil-join") as Partial<{ pairs_with: string }>).pairs_with; // semantic error
    });
    const r = validate(doc);
    const rules = new Set(r.findings.map((f) => f.rule));
    expect(rules.has("schema.invalid")).toBe(true);
    expect(rules.has("gw.join-missing")).toBe(true);
  });
});

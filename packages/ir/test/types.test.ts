import { describe, expect, it } from "vitest";
import { loadSchema, schemaValidator } from "../src/schema.js";
import { GATEWAY_TYPES, TASK_TYPES, type ProcessIR } from "../src/types.js";
import { validate } from "../src/validate.js";

type Defs = Record<string, { properties?: Record<string, { enum?: string[]; const?: string }> }>;

describe("types.ts stays in sync with the JSON Schema", () => {
  const defs = (loadSchema() as { $defs: Defs }).$defs;

  it("task and gateway type enums match the exported constants", () => {
    expect(defs.Task!.properties!.type!.enum).toEqual([...TASK_TYPES]);
    expect(defs.Gateway!.properties!.type!.enum).toEqual([...GATEWAY_TYPES]);
    for (const [def, t] of [
      ["StartEvent", "startEvent"],
      ["EndEvent", "endEvent"],
      ["IntermediateCatchEvent", "intermediateCatchEvent"],
      ["BoundaryEvent", "boundaryEvent"]
    ] as const) {
      expect(defs[def]!.properties!.type!.const).toBe(t);
    }
  });

  it("a minimal IR written against the TypeScript types passes the schema and the validator", () => {
    // Compile-time: this literal must satisfy ProcessIR. Runtime: it must satisfy the schema.
    const doc: ProcessIR = {
      ir_version: "1.0",
      process: { id: "hello", name: "Hello" },
      lanes: [{ id: "user", name: "User", kind: "human" }],
      data_objects: [{ id: "greeting", name: "Greeting", schema: { type: "object", properties: { text: { type: "string" } } } }],
      nodes: [
        { id: "start", type: "startEvent", name: "Start", lane: "user", data: { writes: ["greeting"] } },
        {
          id: "say-hello",
          type: "userTask",
          name: "Say hello",
          lane: "user",
          data: { reads: ["greeting"], writes: ["greeting"] },
          acceptance_criteria: [{ id: "AC-1", given: "a greeting", when: "the user says it", then: "it is said" }]
        },
        { id: "end", type: "endEvent", name: "End", lane: "user", result: { kind: "none" } }
      ],
      edges: [
        { id: "e1", from: "start", to: "say-hello", data_contract: { carries: ["greeting"] } },
        { id: "e2", from: "say-hello", to: "end", data_contract: { carries: ["greeting"], invariants: ["greeting.text != ''"] } }
      ],
      requirements: { assumptions: [{ id: "asm-1", statement: "One user only.", confirmed: true }] }
    };
    expect(schemaValidator()(doc)).toBe(true);
    const r = validate(doc, { mode: "final" });
    expect(r.ok, r.summary).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("every node variant lists the same base fields", () => {
    const base = ["id", "type", "name", "lane", "description", "provenance", "extensions"];
    for (const v of ["StartEvent", "EndEvent", "IntermediateCatchEvent", "BoundaryEvent", "Task", "Gateway"]) {
      const props = Object.keys(defs[v]!.properties!);
      for (const b of base) expect(props, `${v} lacks ${b}`).toContain(b);
    }
  });
});

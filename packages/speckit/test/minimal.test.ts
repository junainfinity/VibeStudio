/**
 * A hand-built minimal IR — one task, no data objects, no optional fields
 * anywhere — is the floor the generator must never fall through: all core
 * files exist, every optional section is omitted, and nothing renders empty.
 */
import { describe, expect, it } from "vitest";
import type { ProcessIR } from "@vibestudio/ir";
import { generateSpecKit } from "../src/index.js";
import { expectKitInvariants, fileByPath } from "./helpers.js";

function minimalIR(): ProcessIR {
  return {
    ir_version: "1.0",
    process: { id: "mini", name: "Mini process" },
    lanes: [{ id: "ops", name: "Ops", kind: "human" }],
    data_objects: [],
    nodes: [
      { id: "start", type: "startEvent", name: "Started", lane: "ops" },
      { id: "do-work", type: "userTask", name: "Do the work", lane: "ops" },
      { id: "end", type: "endEvent", name: "Done", lane: "ops" }
    ],
    edges: [
      { id: "e-a", from: "start", to: "do-work", data_contract: { carries: [] } },
      { id: "e-b", from: "do-work", to: "end", data_contract: { carries: [] } }
    ]
  };
}

describe("minimal IR", () => {
  const ir = minimalIR();
  const kit = generateSpecKit(ir);

  it("produces all four core files plus one contract per edge", () => {
    expect(kit.files.map((f) => f.path)).toEqual([
      "constitution.md",
      "spec.md",
      "plan.md",
      "contracts/README.md",
      "contracts/edge-e-a.md",
      "contracts/edge-e-b.md"
    ]);
    expectKitInvariants(ir, kit);
  });

  it("constitution keeps the actors and omits everything optional", () => {
    const constitution = fileByPath(kit, "constitution.md").content;
    expect(constitution).toContain("# Mini process");
    expect(constitution).toContain("**Ops** (ops, human)");
    expect(constitution).not.toContain("Domain:");
    expect(constitution).not.toContain("## Ground rules");
    expect(constitution).not.toContain("## Standing assumptions");
  });

  it("spec has the task section and events, and omits decisions/criteria", () => {
    const spec = fileByPath(kit, "spec.md").content;
    expect(spec).toContain("# Mini process — specification");
    expect(spec).toContain("## Do the work (do-work)");
    expect(spec).toContain("- Lane: Ops (human)");
    expect(spec).toContain("- Type: userTask");
    expect(spec).not.toContain("### Acceptance criteria");
    expect(spec).not.toContain("## Decisions");
    expect(spec).toContain("**Started** (start) — start event");
    expect(spec).toContain("**Done** (end) — end event");
  });

  it("plan has the build order with empty contracts spelled out as none", () => {
    const plan = fileByPath(kit, "plan.md").content;
    expect(plan).toContain("1. **Do the work** (do-work)");
    expect(plan).toContain("- Input from Started (start): none");
    expect(plan).toContain("- Output to Done (end): none");
    expect(plan).not.toContain("## Integrations");
    expect(plan).not.toContain("## Non-functional requirements");
    expect(plan).not.toContain("## Open questions");
  });

  it("contracts state that nothing is carried", () => {
    for (const path of ["contracts/edge-e-a.md", "contracts/edge-e-b.md"]) {
      const contract = fileByPath(kit, path).content;
      expect(contract).toContain("This edge carries no data objects.");
      expect(contract).not.toContain("## Invariants");
    }
  });
});

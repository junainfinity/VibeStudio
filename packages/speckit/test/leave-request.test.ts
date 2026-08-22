/**
 * The leave-request draft is the sparse case: tasks without acceptance
 * criteria or integrations, data objects without schemas, an empty carries
 * list, no NFRs and no assumptions. The generator must degrade by omission —
 * never crash, never print an empty section or a junk value.
 */
import { describe, expect, it } from "vitest";
import { generateSpecKit } from "../src/index.js";
import { countOccurrences, expectKitInvariants, fileByPath, loadExample } from "./helpers.js";

const ir = loadExample("leave-request.draft.ir.json");
const kit = generateSpecKit(ir);

describe("leave-request draft", () => {
  it("generates the full file set without crashing", () => {
    expect(kit.files.length).toBe(4 + ir.edges.length);
    expectKitInvariants(ir, kit);
  });

  it("emits an acceptance-criteria section only for the one task that has criteria", () => {
    const spec = fileByPath(kit, "spec.md").content;
    expect(countOccurrences(spec, "### Acceptance criteria")).toBe(1);
    expect(spec).toContain("## Submit leave request (submit-request)");
    expect(spec).toContain("## Record leave in HR system (record-leave)");
  });

  it("omits ground rules and assumptions (none exist) but keeps actors", () => {
    const constitution = fileByPath(kit, "constitution.md").content;
    expect(constitution).not.toContain("## Ground rules");
    expect(constitution).not.toContain("## Standing assumptions");
    expect(constitution).toContain("**HR System** (hr-system, system)");
  });

  it("surfaces the unanswered open question as blocking", () => {
    const plan = fileByPath(kit, "plan.md").content;
    expect(plan).toContain("## Open questions");
    expect(plan).toContain("**q-balance**");
    expect(plan).toContain("Affects: Submit leave request (submit-request), Review request (review-request)");
  });

  it("omits the integrations section (no task declares one)", () => {
    const plan = fileByPath(kit, "plan.md").content;
    expect(plan).not.toContain("## Integrations");
  });

  it("says explicitly when an edge carries nothing", () => {
    const contract = fileByPath(kit, "contracts/edge-e6.md").content;
    expect(contract).toContain("## Carries");
    expect(contract).toContain("This edge carries no data objects.");
  });

  it("renders a natural-language decision with name, condition and default", () => {
    const spec = fileByPath(kit, "spec.md").content;
    expect(spec).toContain("### Approved? (gw-decision)");
    expect(spec).toContain("**approved** — condition: `decision is approved` (natural) → Record leave in HR system (record-leave)");
    expect(spec).toContain("**rejected** — default → Leave rejected (end-rejected)");
  });
});

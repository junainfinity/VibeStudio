/**
 * Regressions for the adversarial-review findings: IR free text is only
 * length-constrained (Name has no pattern), so names, statements, conditions
 * and criteria can legally contain newlines, backslash-pipe sequences and
 * trailing whitespace. None of that may break the markdown structure of the
 * generated kit, and no pair of generated paths may collide on a
 * case-insensitive filesystem.
 */
import { describe, expect, it } from "vitest";
import type { ProcessIR } from "@vibestudio/ir";
import { generateSpecKit } from "../src/index.js";
import { cell, oneLine, renderDoc } from "../src/markdown.js";
import { expectKitInvariants, fileByPath } from "./helpers.js";

/** A final-shaped IR whose every free-text slot carries hostile but schema-valid text. */
function hostileIR(): ProcessIR {
  return {
    ir_version: "1.0",
    process: {
      id: "hostile",
      name: "Check out\nProcess",
      goal: "goal with trailing spaces   \nsecond",
      domain: "e-\ncommerce"
    },
    lanes: [{ id: "ops", name: "Ops\nTeam", kind: "human", description: "Line one.\n\nSecond paragraph." }],
    data_objects: [{ id: "cart", name: "Cart\nData", description: "desc", states: ["a\nb", "locked"] }],
    nodes: [
      { id: "start", type: "startEvent", name: "Start\nHere", lane: "ops", trigger: { kind: "message", detail: "de\ntail" } },
      {
        id: "do-work",
        type: "userTask",
        name: "Do\nWork",
        lane: "ops",
        description: "desc\n\n",
        data: { reads: ["cart"], writes: ["cart"] },
        acceptance_criteria: [{ id: "AC-1", given: "a", when: "c \\| d", then: "e", tags: ["tag|x"] }],
        integration: { system: "Sys\ntem", operation: "op", description: "note\nline2" }
      },
      { id: "gw", type: "exclusiveGateway", direction: "split", name: "Which\nway?", lane: "ops" },
      { id: "end-a", type: "endEvent", name: "Done\nA", lane: "ops" },
      { id: "end-b", type: "endEvent", name: "Done B", lane: "ops" }
    ],
    edges: [
      { id: "e-start", from: "start", to: "do-work", name: "kick\noff", data_contract: { carries: ["cart"], invariants: ["inv\nwith newline"] } },
      { id: "e-work-gw", from: "do-work", to: "gw", data_contract: { carries: [] } },
      {
        id: "e-yes",
        from: "gw",
        to: "end-a",
        name: "branch\nname",
        condition: { expression: "x ==\n'y'", language: "javascript" },
        data_contract: { carries: [] }
      },
      { id: "e-no", from: "gw", to: "end-b", is_default: true, data_contract: { carries: [] } }
    ],
    requirements: {
      non_functional: [{ id: "nfr-1", category: "security", statement: "state\nment" }],
      assumptions: [{ id: "as-1", statement: "assumption\nwith newline" }],
      open_questions: [{ id: "q-1", question: "why\n\nnot?" }]
    }
  };
}

const ir = hostileIR();
const kit = generateSpecKit(ir);

describe("hostile text: whole-kit invariants", () => {
  it("keeps every file invariant despite newlines, trailing spaces and blank lines in free text", () => {
    // Covers finding 4 end-to-end: goal has trailing spaces before a newline,
    // the task description ends in a double newline.
    expectKitInvariants(ir, kit);
  });
});

describe("hostile text: headings stay single-line (finding: newlines break ATX headings)", () => {
  it("collapses newlines in the process name H1", () => {
    expect(fileByPath(kit, "constitution.md").content).toContain("# Check out Process\n");
    expect(fileByPath(kit, "spec.md").content).toContain("# Check out Process — specification");
    expect(fileByPath(kit, "plan.md").content).toContain("# Check out Process — build plan");
  });

  it("collapses newlines in task section headings and gateway headings", () => {
    const spec = fileByPath(kit, "spec.md").content;
    expect(spec).toContain("## Do Work (do-work)");
    expect(spec).toContain("### Which way? (gw)");
    expect(spec).not.toContain("Do\nWork");
  });

  it("collapses newlines in contract titles and data-object headings", () => {
    const contract = fileByPath(kit, "contracts/edge-e-start.md").content;
    expect(contract).toContain("# Contract: Start Here (start) -> Do Work (do-work)");
    expect(contract).toContain("### Cart Data (cart)");
    expect(contract).not.toContain("Start\nHere");
  });

  it("collapses newlines in event bullets and the contracts index", () => {
    const spec = fileByPath(kit, "spec.md").content;
    expect(spec).toContain("- **Start Here** (start) — start event; trigger: message (de tail)");
    expect(spec).toContain("- **Done A** (end-a) — end event");
    const index = fileByPath(kit, "contracts/README.md").content;
    expect(index).toContain("- [e-start](./edge-e-start.md) — Start Here (start) -> Do Work (do-work); carries Cart Data (cart)");
  });
});

describe("hostile text: single-line list items stay single-line (finding: multi-line free text breaks list items)", () => {
  it("keeps a multi-paragraph lane description inside its actor bullet", () => {
    const constitution = fileByPath(kit, "constitution.md").content;
    expect(constitution).toContain(
      "- **Ops Team** (ops, human) — Line one. Second paragraph. Tasks in this lane are performed by people and need a user interface."
    );
  });

  it("keeps nfr statements, assumptions and open questions on one line", () => {
    const constitution = fileByPath(kit, "constitution.md").content;
    expect(constitution).toContain("- state ment (nfr-1)");
    expect(constitution).toContain("- **as-1** (unconfirmed) — assumption with newline");
    const plan = fileByPath(kit, "plan.md").content;
    expect(plan).toContain("- **nfr-1** (security) — state ment");
    expect(plan).toContain("- **q-1** — why not?");
  });

  it("keeps edge names, conditions, invariants and integration notes on one line", () => {
    const spec = fileByPath(kit, "spec.md").content;
    expect(spec).toContain("- **branch name** — condition: `x == 'y'` (javascript) → Done A (end-a)");
    expect(spec).toContain("- Notes: note line2");
    expect(spec).toContain("- System: Sys tem");
    const start = fileByPath(kit, "contracts/edge-e-start.md").content;
    expect(start).toContain("- Name: kick off");
    expect(start).toContain("- inv with newline");
    expect(start).toContain("- States: a b, locked");
    const yes = fileByPath(kit, "contracts/edge-e-yes.md").content;
    expect(yes).toContain("- Name: branch name");
    expect(yes).toContain("- Condition: `x == 'y'` (javascript)");
  });

  it("keeps multi-line free-text paragraphs (goal, descriptions) but normalised", () => {
    const constitution = fileByPath(kit, "constitution.md").content;
    // Paragraph fields keep their newlines but lose the trailing whitespace.
    expect(constitution).toContain("goal with trailing spaces\nsecond");
    expect(constitution).toContain("Domain: e- commerce");
  });
});

describe("hostile text: table cells (finding: cell() misses backslash escaping)", () => {
  it("escapes backslashes before pipes in cell()", () => {
    expect(cell("a\\b")).toBe("a\\\\b");
    expect(cell("a|b")).toBe("a\\|b");
    expect(cell("c \\| d")).toBe("c \\\\\\| d");
    expect(cell("line1\nline2")).toBe("line1 line2");
  });

  it("keeps a backslash-pipe criterion inside its own column", () => {
    const spec = fileByPath(kit, "spec.md").content;
    expect(spec).toContain("| AC-1 | a | c \\\\\\| d | e | tag\\|x |");
  });
});

describe("hostile text: renderDoc invariants (finding: invariants fail on multi-line block strings)", () => {
  it("strips trailing whitespace on every physical line, not just the last", () => {
    expect(renderDoc([["a   \nb"], ["c"]])).toBe("a\nb\n\nc\n");
  });

  it("collapses runs of blank lines introduced by embedded newlines", () => {
    expect(renderDoc([["desc\n\n"], ["x"]])).toBe("desc\n\nx\n");
    expect(renderDoc([["a\n\n\n\nb"]])).toBe("a\n\nb\n");
  });

  it("still ends with exactly one newline", () => {
    expect(renderDoc([["tail\n"]])).toBe("tail\n");
  });
});

describe("oneLine sanitiser", () => {
  it("collapses any newline run (with surrounding spaces) to a single space and trims", () => {
    expect(oneLine("a\nb")).toBe("a b");
    expect(oneLine("a \r\n b")).toBe("a b");
    expect(oneLine("a\n\n\nb")).toBe("a b");
    expect(oneLine("  a  ")).toBe("a");
    expect(oneLine("a\r b")).toBe("a b");
  });
});

describe("contracts path collision (finding: contracts/readme.md vs contracts/README.md)", () => {
  const collisionIR: ProcessIR = {
    ir_version: "1.0",
    process: { id: "coll", name: "Collision" },
    lanes: [{ id: "ops", name: "Ops", kind: "human" }],
    data_objects: [],
    nodes: [
      { id: "start", type: "startEvent", name: "Started", lane: "ops" },
      { id: "do-work", type: "userTask", name: "Do the work", lane: "ops" },
      { id: "end", type: "endEvent", name: "Done", lane: "ops" }
    ],
    edges: [
      { id: "readme", from: "start", to: "do-work", data_contract: { carries: [] } },
      { id: "e-b", from: "do-work", to: "end", data_contract: { carries: [] } }
    ]
  };
  const collisionKit = generateSpecKit(collisionIR);

  it("emits edge contracts under the edge- prefix so no path can collide with README.md", () => {
    const paths = collisionKit.files.map((f) => f.path);
    expect(paths).toContain("contracts/README.md");
    expect(paths).toContain("contracts/edge-readme.md");
    expect(paths).toContain("contracts/edge-e-b.md");
  });

  it("has no two paths equal under case folding", () => {
    const folded = new Set(collisionKit.files.map((f) => f.path.toLowerCase()));
    expect(folded.size).toBe(collisionKit.files.length);
  });

  it("keeps the ordering contract: README.md still leads the contracts listing", () => {
    expect(collisionKit.files.map((f) => f.path)).toEqual([
      "constitution.md",
      "spec.md",
      "plan.md",
      "contracts/README.md",
      "contracts/edge-e-b.md",
      "contracts/edge-readme.md"
    ]);
  });

  it("links index entries to the prefixed files", () => {
    const index = fileByPath(collisionKit, "contracts/README.md").content;
    expect(index).toContain("[readme](./edge-readme.md)");
    expect(index).toContain("[e-b](./edge-e-b.md)");
    expectKitInvariants(collisionIR, collisionKit);
  });
});

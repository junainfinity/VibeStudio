/**
 * The notes generator: coverage (every task, split, loop, data object gets a
 * section), fill-marker discipline (structural facts are filled in, code
 * locations are explicit TO FILL markers), and the same whole-file invariants
 * as every other kit file.
 */
import { describe, expect, it } from "vitest";
import { generateProcessNotes, renderTroubleshootingNotes } from "../src/index.js";
import { loadExample } from "./helpers.js";

/** The notes banner names the builder as editor (unlike other kit files). */
function notesBannerFor(ir: { process: { id: string }; ir_version: string }): string {
  return `<!-- generated from Process IR '${ir.process.id}' v${ir.ir_version} — BUILDER: you are the intended editor of this file.`;
}

describe("process notes (checkout)", () => {
  const ir = loadExample("checkout.ir.json");
  const notes = generateProcessNotes(ir);

  it("troubleshooting covers every task, split decision, loop, and data object", () => {
    const t = notes.troubleshooting;
    for (const n of ir.nodes) {
      const isTask = !n.type.endsWith("Gateway") && !n.type.endsWith("Event");
      if (isTask) expect(t, n.id).toContain(`\`${n.id}\``);
    }
    expect(t).toContain("gw-valid");      // split decisions by id
    expect(t).toContain("gw-paid");
    expect(t).toContain("loop-1");        // the payment retry loop
    for (const d of ir.data_objects) expect(t).toContain(`\`${d.id}\``);
  });

  it("loop sections state the exit conditions, not just the membership", () => {
    expect(notes.troubleshooting).toMatch(/leaves the loop toward .+ when /);
  });

  it("structural facts are filled; only code locations are TO FILL", () => {
    const t = notes.troubleshooting;
    expect(t).toMatch(/\[TO FILL [a-z0-9-]+/i);
    // no marker where the IR already knows the answer
    expect(t).not.toMatch(/receives?: \[TO FILL/);
    expect(t).not.toMatch(/when \[TO FILL/);
  });

  it("codebase map has one section per task plus the run overview", () => {
    const c = notes.codebase;
    const tasks = ir.nodes.filter((n) => !n.type.endsWith("Gateway") && !n.type.endsWith("Event"));
    for (const t of tasks) expect(c).toContain(`(\`${t.id}\`)`);
    expect(c).toContain("## How it all runs");
  });

  it("kit invariants: builder-editable banner, single trailing newline, no junk", () => {
    for (const f of [notes.troubleshooting, notes.codebase]) {
      expect(f.startsWith(notesBannerFor(ir))).toBe(true);
      expect(f.endsWith("\n")).toBe(true);
      expect(f.endsWith("\n\n")).toBe(false);
      for (const junk of ["undefined", "[object Object]", "NaN"]) expect(f).not.toContain(junk);
    }
  });

  it("hand-off sentences point at real successors, never the step itself", () => {
    const sections = notes.troubleshooting.split(/\n### /).slice(1);
    for (const sec of sections) {
      const m = /Step id `([^`]+)`[\s\S]*?if it runs but (.+?) never follows/.exec(sec);
      if (m) expect(m[2], m[1]).not.toContain(`(${m[1]})`);
    }
  });

  it("every TO FILL marker is self-identifying and unique", () => {
    for (const f of [notes.troubleshooting, notes.codebase]) {
      const markers = (f.match(/\[TO FILL [^\]]+\]/g) ?? []).filter((m) => /^\[TO FILL [a-z0-9]/i.test(m));
      expect(markers.length).toBeGreaterThan(0);
      expect(new Set(markers).size, "duplicate markers").toBe(markers.length);
    }
  });

  it("parallel splits get fan-out wording, never a condition-check marker", () => {
    const t = notes.troubleshooting;
    const fulfil = t.split("### ").find((s) => s.startsWith("The wrong thing happens") && s.includes("gw-fulfil-split"))!;
    expect(fulfil).toContain("fan-out");
    expect(fulfil).toContain("Both branches are supposed to start together");
    expect(fulfil).not.toContain("wrong branch, the check");
  });

  it("loop value-update markers are owned by the member packet that writes", () => {
    const t = notes.troubleshooting;
    const loop = t.split("## Loops")[1]!;
    expect(loop).toMatch(/\[TO FILL loop loop-1:/);
    expect(loop).toMatch(/\[TO FILL payment-(init|authorize):/); // per-owner update marker
  });

  it("quick map has hand-off rows and a triage entry, and a triage section exists", () => {
    const t = notes.troubleshooting;
    expect(t).toContain("Something is broken, not sure where");
    expect(t).toMatch(/finished but .+ never happens/);
    expect(t).toContain("## Triage");
    expect(t).toContain("works when");
  });

  it("round-3 refinements: start wiring marker, branching triage caveat, fan-out phrasing, field-owner timing", () => {
    const t = notes.troubleshooting;
    expect(t).toMatch(/\[TO FILL cart-review start-wiring:/);
    expect(t).toContain("takes branches (see Decisions & fan-outs)");
    expect(t).toMatch(/finished but neither .+ nor .+ happens/);
    expect(t).toContain("the WRONG one of those followed");
    // field-owners timing appears only when >3 steps write one record — force it
    const crowded = loadExample("checkout.ir.json");
    for (const n of crowded.nodes) {
      if (!n.type.endsWith("Gateway") && !n.type.endsWith("Event")) {
        const task = n as { data?: { reads?: string[]; writes?: string[] } };
        task.data = { ...task.data, writes: [...new Set([...(task.data?.writes ?? []), "order"])] };
      }
    }
    const crowdedNotes = renderTroubleshootingNotes(crowded);
    expect(crowdedNotes).toContain("after the final packet, assemble one line per part");
    expect(crowdedNotes).toContain("field-owners");
  });

  it("round-4: every routing marker names its owning sitting; finishing-step markers exist; 3-way phrasing", () => {
    const t = notes.troubleshooting;
    // every decision/fan-out/loop marker carries the sitting clause
    for (const m of t.match(/\[TO FILL (gw-[^:]+|loop [^:]+):[^\]]+\]/g) ?? []) {
      expect(m, m).toContain("filled in the same sitting that wires the routing after");
    }
    // 3+ successors render as "none of …", never a garbled "neither A nor B, C happens"
    expect(t).not.toMatch(/neither [^\n)]+\), [^\n]+\) (happens|follows)/);
    expect(t).toMatch(/none of .+, .+ happens/);
    // crowded-record marker is a finishing-step task
    const crowded = loadExample("checkout.ir.json");
    for (const n of crowded.nodes) {
      if (!n.type.endsWith("Gateway") && !n.type.endsWith("Event")) {
        const task = n as { data?: { reads?: string[]; writes?: string[] } };
        task.data = { ...task.data, writes: [...new Set([...(task.data?.writes ?? []), "order"])] };
      }
    }
    expect(renderTroubleshootingNotes(crowded)).toContain("field-owners (finishing step)");
  });

  it("round-5 polish: parallel fan-outs get only-one-started rows, not wrong-branch rows", () => {
    const t = notes.troubleshooting;
    expect(t).toMatch(/finished but only one of .+ started/);
    expect(t).toContain('After "Fulfilment", one branch never starts');
    // the WRONG-branch companion row must not be attributed to the parallel fan-out
    const fulfilRow = t.split("\n").find((l) => l.includes("only one of"))!;
    expect(fulfilRow).toContain("fan-out after");
  });

  it("is deterministic", () => {
    const again = generateProcessNotes(loadExample("checkout.ir.json"));
    expect(again.troubleshooting).toBe(notes.troubleshooting);
    expect(again.codebase).toBe(notes.codebase);
  });
});

describe("process notes (draft example degrades gracefully)", () => {
  it("generates without crashing and never prints empty sections", () => {
    const ir = loadExample("leave-request.draft.ir.json");
    const notes = generateProcessNotes(ir);
    expect(notes.troubleshooting).toContain("Quick map");
    expect(notes.troubleshooting).not.toMatch(/\n(#{2,3}) [^\n]+\n\n\1 /); // same-level heading with nothing between = empty section
  });
});

/**
 * Adversarial block/loop shapes. Each case is a small hand-built IR; we assert
 * both that unsound shapes are rejected and that sound shapes are NOT flagged.
 */
import { describe, expect, it } from "vitest";
import { buildIndex, topologicalOrder } from "../src/graph.js";
import { validate } from "../src/validate.js";
import { boundary, cond, dflt, e, end, ir, oj, os, pj, ps, start, task, xj, xs } from "./builder.js";
import { fired } from "./helpers.js";

const leaks = (doc: unknown) => validate(doc).findings.filter((f) => f.rule === "gw.region-leak");

describe("paired blocks — sound shapes are accepted", () => {
  it("skip edge straight from split to join (optional step) — exclusive, inclusive and parallel", () => {
    const xor = ir([start(), xs("xs"), task("a"), xj("xj", "xs"), end()], [e("s", "xs"), cond("xs", "a"), dflt("xs", "xj"), e("a", "xj"), e("xj", "end")]);
    expect(leaks(xor)).toEqual([]);
    expect(validate(xor).ok).toBe(true);
    const par = ir([start(), ps("ps"), task("a"), pj("pj", "ps"), end()], [e("s", "ps"), e("ps", "a"), e("ps", "pj"), e("a", "pj"), e("pj", "end")]);
    expect(leaks(par)).toEqual([]);
    const inc = ir([start(), os("os"), task("a"), oj("oj", "os"), end()], [e("s", "os"), cond("os", "a"), dflt("os", "oj"), e("a", "oj"), e("oj", "end")]);
    expect(leaks(inc)).toEqual([]);
  });

  it("nested parallel blocks", () => {
    const doc = ir(
      [start(), ps("p1"), task("a"), ps("p2"), task("b"), task("c"), pj("j2", "p2"), pj("j1", "p1"), end()],
      [e("s", "p1"), e("p1", "a"), e("p1", "p2"), e("p2", "b"), e("p2", "c"), e("b", "j2"), e("c", "j2"), e("a", "j1"), e("j2", "j1"), e("j1", "end")]
    );
    expect(validate(doc).ok).toBe(true);
  });

  it("XOR decision inside a parallel branch, merged before the join", () => {
    const doc = ir(
      [start(), ps("ps"), task("a"), xs("xs"), task("b"), task("c"), xj("xj"), task("other"), pj("pj", "ps"), end()],
      [e("s", "ps"), e("ps", "a"), e("a", "xs"), cond("xs", "b"), dflt("xs", "c"), e("b", "xj"), e("c", "xj"), e("xj", "pj"), e("ps", "other"), e("other", "pj"), e("pj", "end")]
    );
    expect(validate(doc).ok).toBe(true);
  });

  it("interrupting boundary path merged back into its branch before the join", () => {
    const doc = ir(
      [start(), ps("ps"), task("a"), boundary("ba", "a"), task("fix"), xj("m"), task("b"), pj("pj", "ps"), end()],
      [e("s", "ps"), e("ps", "a"), e("a", "m"), e("ba", "fix"), e("fix", "m"), e("m", "pj"), e("ps", "b"), e("b", "pj"), e("pj", "end")]
    );
    expect(validate(doc).ok).toBe(true);
  });

  it("non-interrupting boundary reminder that ends on its own inside a parallel block", () => {
    const doc = ir(
      [start(), ps("ps"), task("a", "hum", "userTask"), boundary("remind", "a", "timer", false, "hum"), task("nudge"), end("end-nudged"), task("b"), pj("pj", "ps"), end()],
      [e("s", "ps"), e("ps", "a"), e("a", "pj"), e("remind", "nudge"), e("nudge", "end-nudged"), e("ps", "b"), e("b", "pj"), e("pj", "end")]
    );
    expect(leaks(doc)).toEqual([]);
  });

  it("two start events merging into the main flow", () => {
    const doc = ir([start("s1"), start("s2"), xj("m"), task("a"), end()], [e("s1", "m"), e("s2", "m"), e("m", "a"), e("a", "end")]);
    expect(validate(doc).ok).toBe(true);
  });

  it("loop around a whole parallel block", () => {
    const doc = ir(
      [start(), xj("m"), ps("ps"), task("a"), task("b"), pj("pj", "ps"), xs("again"), end()],
      [e("s", "m"), e("m", "ps"), e("ps", "a"), e("ps", "b"), e("a", "pj"), e("b", "pj"), e("pj", "again"), cond("again", "m", "retry"), dflt("again", "end")]
    );
    expect(validate(doc).ok).toBe(true);
  });
});

describe("paired blocks — deadlocking shapes are rejected", () => {
  it("XOR arms wired straight into the parallel join (only one arm ever delivers)", () => {
    const doc = ir(
      [start(), ps("ps"), task("a"), xs("xs"), task("b"), task("c"), task("other"), pj("pj", "ps"), end()],
      [e("s", "ps"), e("ps", "a"), e("a", "xs"), cond("xs", "b"), dflt("xs", "c"), e("b", "pj"), e("c", "pj"), e("ps", "other"), e("other", "pj"), e("pj", "end")]
    );
    const f = leaks(doc);
    expect(f.length).toBe(1);
    expect(f[0]!.message).toMatch(/delivers 2 flows/);
    expect(f[0]!.fix).toMatch(/exclusiveGateway join inside the branch/);
  });

  it("interrupting boundary path wired directly into the parallel join", () => {
    const doc = ir(
      [start(), ps("ps"), task("a"), boundary("ba", "a"), task("b"), pj("pj", "ps"), end()],
      [e("s", "ps"), e("ps", "a"), e("a", "pj"), e("ba", "pj"), e("ps", "b"), e("b", "pj"), e("pj", "end")]
    );
    const f = leaks(doc);
    expect(f.length).toBe(1);
    expect(f[0]!.message).toMatch(/starting at 'a' delivers 2 flows/);
  });

  it("interrupting boundary path that ends without passing the join", () => {
    const doc = ir(
      [start(), ps("ps"), task("a"), boundary("ba", "a"), end("end-fail"), task("b"), pj("pj", "ps"), end()],
      [e("s", "ps"), e("ps", "a"), e("a", "pj"), e("ba", "end-fail"), e("ps", "b"), e("b", "pj"), e("pj", "end")]
    );
    const f = leaks(doc);
    expect(f.length).toBe(1);
    expect(f[0]!.message).toMatch(/reaches endEvent 'end-fail'/);
    expect(f[0]!.fix).toMatch(/exclusiveGateway join before the parallel join/);
  });

  it("two branches merged by an XOR join before the parallel join", () => {
    const doc = ir(
      [start(), ps("ps"), task("a"), task("b"), xj("m"), task("c"), pj("pj", "ps"), end()],
      [e("s", "ps"), e("ps", "a"), e("ps", "b"), e("a", "m"), e("b", "m"), e("m", "pj"), e("ps", "c"), e("c", "pj"), e("pj", "end")]
    );
    const f = leaks(doc);
    expect(f.length).toBe(1);
    expect(f[0]!.message).toMatch(/fed by 2 branches/);
  });

  it("re-entering a branch from after the join (loop into the middle of the block)", () => {
    const doc = ir(
      [start(), ps("ps"), xj("m"), task("a"), task("b"), pj("pj", "ps"), xs("again"), end()],
      [e("s", "ps"), e("ps", "m"), e("m", "a"), e("a", "pj"), e("ps", "b"), e("b", "pj"), e("pj", "again"), cond("again", "m", "retry a"), dflt("again", "end")]
    );
    const f = leaks(doc);
    expect(f.some((x) => x.message.includes("enters the block") && x.message.includes("'again'"))).toBe(true);
  });

  it("a second start event feeding a branch", () => {
    const doc = ir(
      [start("s1"), start("s2"), ps("ps"), xj("m"), task("a"), task("b"), pj("pj", "ps"), end()],
      [e("s1", "ps"), e("ps", "m"), e("s2", "m"), e("m", "a"), e("a", "pj"), e("ps", "b"), e("b", "pj"), e("pj", "end")]
    );
    expect(leaks(doc).some((x) => x.message.includes("enters the block"))).toBe(true);
  });

  it("a loop re-entry merge wrongly paired with its downstream split", () => {
    const doc = ir(
      [start(), xj("m", "again"), task("a"), xs("again"), end()],
      [e("s", "m"), e("m", "a"), e("a", "again"), cond("again", "m", "retry"), dflt("again", "end")]
    );
    const f = leaks(doc);
    expect(f.length).toBe(1);
    expect(f[0]!.message).toMatch(/comes BEFORE .*loop re-entry merge/);
    expect(f[0]!.fix).toMatch(/Remove pairs_with/);
  });
});

describe("loops", () => {
  it("accepts a retry loop whose exit is the host task's normal completion (error boundary loops back)", () => {
    const doc = ir(
      [start(), xj("m"), task("call"), boundary("err", "call"), end()],
      [e("s", "m"), e("m", "call"), e("call", "end"), e("err", "m")]
    );
    const rules = fired(doc);
    expect(rules).not.toContain("loop.no-exit");
    expect(validate(doc).ok).toBe(true);
  });

  it("rejects an unconditional loop", () => {
    const doc = ir([start(), xj("m"), task("a"), task("b"), end()], [e("s", "m"), e("m", "a"), e("a", "b"), e("b", "m")]);
    const r = validate(doc);
    const f = r.findings.find((x) => x.rule === "loop.no-exit")!;
    expect(f).toBeDefined();
    expect(f.message).toContain("m -> a -> b -> m");
    expect(fired(doc)).toContain("graph.no-path-to-end");
  });

  it("orders loop members merge → body → exit split in topologicalOrder", () => {
    const doc = ir(
      [start(), xs("again"), task("t2"), task("t1"), xj("m"), end()],
      [e("s", "m"), e("m", "t1"), e("t1", "t2"), e("t2", "again"), cond("again", "m", "retry"), dflt("again", "end")]
    );
    const order = topologicalOrder(buildIndex(doc));
    expect(order).toEqual(["s", "m", "t1", "t2", "again", "end"]);
  });
});

describe("conditions and defaults", () => {
  it("single bare branch without a default is a deterministic fix, not a user question", () => {
    const doc = ir([start(), xs("x"), task("a"), task("b"), xj("m"), end()], [e("s", "x"), cond("x", "a", "ok"), e("x", "b"), e("a", "m"), e("b", "m"), e("m", "end")]);
    const rules = fired(doc, { mode: "draft" });
    expect(rules).toContain("gw.default-implicit");
    expect(rules).not.toContain("gw.condition-missing");
    expect(validate(doc, { mode: "draft" }).ok).toBe(false);
  });

  it("two bare branches with no default are a real gap", () => {
    const doc = ir([start(), xs("x"), task("a"), task("b"), xj("m"), end()], [e("s", "x"), e("x", "a"), e("x", "b"), e("a", "m"), e("b", "m"), e("m", "end")]);
    const rules = fired(doc, { mode: "draft" }, "gap");
    expect(rules).toContain("gw.condition-missing");
    expect(fired(doc, { mode: "draft" })).not.toContain("gw.default-implicit");
  });

  it("default flow with a condition is rejected", () => {
    const doc = ir([start(), xs("x"), task("a"), task("b"), xj("m"), end()], [e("s", "x"), cond("x", "a", "ok"), dflt("x", "b", { condition: { expression: "else" } }), e("a", "m"), e("b", "m"), e("m", "end")]);
    expect(fired(doc)).toContain("gw.default-conditional");
  });

  it("formal conditions may only reference data carried into the split", () => {
    const doc = ir(
      [start(), task("a"), xs("x"), task("b"), task("c"), xj("m"), end()],
      [e("s", "a"), e("a", "x"), e("x", "b", { condition: { expression: "d.ok && other_thing.flag", language: "javascript" } }), dflt("x", "c"), e("b", "m"), e("c", "m"), e("m", "end")],
      { data_objects: [{ id: "d", name: "D", schema: { type: "object" } }, { id: "other-thing", name: "Other", schema: { type: "object" } }] }
    );
    const r = validate(doc);
    const f = r.findings.filter((x) => x.rule === "gw.condition-unbound");
    expect(f.length).toBe(1);
    expect(f[0]!.message).toContain("'other_thing' (data object 'other-thing')");
    // natural-language conditions are never checked
    const nat = ir(
      [start(), task("a"), xs("x"), task("b"), task("c"), xj("m"), end()],
      [e("s", "a"), e("a", "x"), cond("x", "b", "other thing flag is set"), dflt("x", "c"), e("b", "m"), e("c", "m"), e("m", "end")]
    );
    expect(fired(nat)).not.toContain("gw.condition-unbound");
  });
});

import { describe, expect, it } from "vitest";
import { formatFeedback, toClarifyingQuestions } from "../src/feedback.js";
import { validate } from "../src/validate.js";
import { edge, gateway, loadCheckout, mutate, task } from "./helpers.js";

describe("formatFeedback", () => {
  it("reports a clean pass", () => {
    const text = formatFeedback(validate(loadCheckout()));
    expect(text).toContain("PASSED");
    expect(text).toContain("No findings");
  });

  it("orders errors, warnings and gaps and includes fixes/questions", () => {
    const doc = mutate((ir) => {
      delete gateway(ir, "gw-fulfil-join").pairs_with; // error
      ir.lanes.push({ id: "warehouse", name: "Warehouse", kind: "human" }); // warning
      delete task(ir, "cart-review").acceptance_criteria; // gap (draft)
    });
    const text = formatFeedback(validate(doc, { mode: "draft" }));
    const iErr = text.indexOf("ERRORS");
    const iWarn = text.indexOf("WARNINGS");
    const iGap = text.indexOf("OPEN GAPS");
    expect(iErr).toBeGreaterThan(-1);
    expect(iWarn).toBeGreaterThan(iErr);
    expect(iGap).toBeGreaterThan(iWarn);
    expect(text).toContain("[gw.join-missing]");
    expect(text).toContain("pairs_with \"gw-fulfil-split\"");
    expect(text).toContain("[lane.unused]");
    expect(text).toMatch(/\[task\.criteria-missing\].*What must be true/);
    expect(text).toContain("(at /nodes/");
  });

  it("caps findings per rule and total size deterministically", () => {
    const doc = mutate((ir) => {
      for (const e of ir.edges) e.data_contract.carries = [];
    });
    const report = validate(doc, { mode: "final" });
    const text = formatFeedback(report, { maxPerRule: 3 });
    expect(text).toContain("… +");
    const short = formatFeedback(report, { maxPerRule: 50, maxChars: 500 });
    expect(short.length).toBeLessThanOrEqual(600);
    expect(short).toContain("truncated");
    expect(formatFeedback(report)).toBe(formatFeedback(report));
  });

  it("can drop warnings and gaps", () => {
    const doc = mutate((ir) => {
      ir.lanes.push({ id: "warehouse", name: "Warehouse", kind: "human" });
    });
    const text = formatFeedback(validate(doc), { includeWarnings: false });
    expect(text).not.toContain("WARNINGS");
  });
});

describe("toClarifyingQuestions", () => {
  it("groups gaps by theme and dedupes", () => {
    const doc = mutate((ir) => {
      delete task(ir, "cart-review").acceptance_criteria;
      delete task(ir, "payment-init").integration;
      delete edge(ir, "e-paid-yes").condition;
      delete ir.data_objects.find((d) => d.id === "receipt")!.schema;
      task(ir, "order-confirm").provenance = { status: "assumed" };
      ir.requirements!.open_questions!.push({ id: "q-tax", question: "Is tax computed at checkout or upstream?", affects: ["checkout-validate"] });
    });
    const qs = toClarifyingQuestions(validate(doc, { mode: "draft" }));
    const themes = qs.map((q) => q.theme);
    expect(themes).toEqual([...themes].sort((a, b) => ["process", "tasks", "decisions", "data", "integrations", "assumptions", "other"].indexOf(a) - ["process", "tasks", "decisions", "data", "integrations", "assumptions", "other"].indexOf(b)));
    expect(new Set(themes)).toEqual(new Set(["tasks", "decisions", "data", "integrations", "assumptions", "other"]));
    expect(qs.find((q) => q.rule === "question.open")!.affects).toEqual(["checkout-validate"]);
    expect(qs.find((q) => q.rule === "task.criteria-missing")!.affects).toEqual(["cart-review"]);
    expect(new Set(qs.map((q) => q.question)).size).toBe(qs.length);
  });

  it("returns nothing in final mode for a clean IR", () => {
    expect(toClarifyingQuestions(validate(loadCheckout()))).toEqual([]);
  });
});

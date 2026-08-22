import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toClarifyingQuestions } from "../src/feedback.js";
import { validate } from "../src/validate.js";

const EXAMPLES = new URL("../examples/", import.meta.url);
const INVALID = new URL("../examples/invalid/", import.meta.url);

function load(dir: URL, name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, dir), "utf8"));
}

describe("shipped examples", () => {
  const finals = readdirSync(EXAMPLES).filter((f) => f.endsWith(".ir.json") && !f.endsWith(".draft.ir.json"));
  const drafts = readdirSync(EXAMPLES).filter((f) => f.endsWith(".draft.ir.json"));
  const invalids = readdirSync(INVALID).filter((f) => f.endsWith(".ir.json"));

  it.each(finals)("%s is a clean final IR", (name) => {
    const r = validate(load(EXAMPLES, name), { mode: "final" });
    expect(r.ok, r.summary).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it.each(drafts)("%s has no errors in draft mode but yields clarifying questions", (name) => {
    const r = validate(load(EXAMPLES, name), { mode: "draft" });
    expect(r.ok, r.summary).toBe(true);
    expect(r.counts.gap).toBeGreaterThan(0);
    const qs = toClarifyingQuestions(r);
    expect(qs.length).toBe(r.counts.gap);
    // the same document is NOT ready for rendering
    expect(validate(load(EXAMPLES, name), { mode: "final" }).ok).toBe(false);
  });

  it.each(invalids)("%s fails with errors that all carry fix hints", (name) => {
    const r = validate(load(INVALID, name), { mode: "final" });
    expect(r.ok).toBe(false);
    expect(r.counts.error).toBeGreaterThan(0);
    for (const f of r.findings) expect(f.fix || f.question).toBeTruthy();
  });
});

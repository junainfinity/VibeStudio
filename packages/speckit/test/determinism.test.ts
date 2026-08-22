/**
 * Determinism is a product promise: the kit is a build artifact of the IR, so
 * the same document must yield byte-identical files on every run (and running
 * the generator must never mutate its input).
 */
import { describe, expect, it } from "vitest";
import { generateSpecKit } from "../src/index.js";
import { loadExample } from "./helpers.js";

describe("determinism", () => {
  for (const example of ["checkout.ir.json", "leave-request.draft.ir.json"]) {
    it(`two runs over ${example} produce byte-identical output`, () => {
      // Parse twice so object identity cannot mask a hidden dependence on
      // shared state; then run twice on one object to catch input mutation.
      const first = generateSpecKit(loadExample(example));
      const second = generateSpecKit(loadExample(example));
      expect(first.files.map((f) => f.path)).toEqual(second.files.map((f) => f.path));
      for (let i = 0; i < first.files.length; i++) {
        expect(first.files[i]!.content === second.files[i]!.content, `${first.files[i]!.path} must be byte-identical`).toBe(true);
      }
      expect(first).toEqual(second);

      const ir = loadExample(example);
      const before = JSON.stringify(ir);
      const third = generateSpecKit(ir);
      const fourth = generateSpecKit(ir);
      expect(JSON.stringify(ir)).toBe(before);
      expect(third).toEqual(fourth);
      expect(third).toEqual(first);
    });
  }
});

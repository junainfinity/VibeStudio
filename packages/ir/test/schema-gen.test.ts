import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROCESS_IR_SCHEMA } from "../src/schema.gen.js";
import { SCHEMA_URL } from "../src/schema.js";

describe("generated schema module", () => {
  it("matches schema/process-ir.v1.schema.json exactly (run `npm run gen-schema` after editing the JSON)", () => {
    const canonical = JSON.parse(readFileSync(SCHEMA_URL, "utf8"));
    expect(PROCESS_IR_SCHEMA).toEqual(canonical);
  });
});

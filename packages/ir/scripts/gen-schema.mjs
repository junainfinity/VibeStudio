#!/usr/bin/env node
/**
 * Regenerates src/schema.gen.ts from schema/process-ir.v1.schema.json.
 * The JSON file is the source of truth; the generated module exists so the
 * library has no runtime fs dependency and bundles cleanly for the browser.
 * test/schema-gen.test.ts fails if the two drift apart.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schemaPath = fileURLToPath(new URL("../schema/process-ir.v1.schema.json", import.meta.url));
const outPath = fileURLToPath(new URL("../src/schema.gen.ts", import.meta.url));

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const body = `/**
 * AUTO-GENERATED from ../schema/process-ir.v1.schema.json — do not edit by hand.
 * Regenerate with: npm run gen-schema
 */
export const PROCESS_IR_SCHEMA: Record<string, unknown> = ${JSON.stringify(schema, null, 2)} as Record<string, unknown>;
`;
writeFileSync(outPath, body);
console.log(`wrote ${outPath}`);

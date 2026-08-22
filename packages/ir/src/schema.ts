/**
 * JSON Schema loading/compilation and normalisation of Ajv errors into findings.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { RawFinding } from "./rules/catalog.js";
import { PROCESS_IR_SCHEMA } from "./schema.gen.js";

/**
 * Path of the canonical schema JSON inside the published package. The library
 * itself never reads it (so it bundles for the browser without node:fs); the
 * generated copy in schema.gen.ts is kept in sync by test/schema-gen.test.ts.
 */
export const SCHEMA_URL = new URL("../schema/process-ir.v1.schema.json", import.meta.url);

let cachedValidator: ValidateFunction | undefined;

/** The raw Process IR JSON Schema object (draft 2020-12). */
export function loadSchema(): Record<string, unknown> {
  return PROCESS_IR_SCHEMA;
}

export function createAjv(): Ajv2020 {
  return new Ajv2020({
    strict: true,
    allErrors: true,
    discriminator: true,
    allowUnionTypes: true
  });
}

/** Compiled validator for the top-level IR document (cached). */
export function schemaValidator(): ValidateFunction {
  if (!cachedValidator) cachedValidator = createAjv().compile(loadSchema());
  return cachedValidator;
}

interface Located {
  kind: string;
  id?: string;
}

/** Best-effort: turn "/nodes/3/lane" into "node 'checkout-validate'" using the document. */
function locate(doc: unknown, instancePath: string): Located | undefined {
  const parts = instancePath.split("/").filter(Boolean);
  const top = parts[0];
  const idx = parts[1];
  const collections: Record<string, string> = {
    nodes: "node",
    edges: "edge",
    lanes: "lane",
    data_objects: "data object"
  };
  if (!top || !(top in collections)) return top === "process" ? { kind: "process" } : undefined;
  const arr = (doc as Record<string, unknown> | undefined)?.[top];
  const item = Array.isArray(arr) && idx !== undefined ? (arr[Number(idx)] as Record<string, unknown> | undefined) : undefined;
  const id = typeof item?.id === "string" ? item.id : undefined;
  return { kind: collections[top]!, id };
}

function paramsSummary(err: ErrorObject): string {
  const p = err.params as Record<string, unknown>;
  switch (err.keyword) {
    case "additionalProperties":
      return ` ('${String(p.additionalProperty)}' is not a known field here)`;
    case "enum":
      return ` (allowed: ${(p.allowedValues as unknown[]).map(String).join(", ")})`;
    case "const":
      return ` (must be ${JSON.stringify(p.allowedValue)})`;
    case "required":
      return "";
    case "pattern":
      return ` (pattern ${String(p.pattern)})`;
    case "discriminator":
      return p.tagValue !== undefined ? ` (unknown node type '${String(p.tagValue)}')` : "";
    case "type":
      return ` (expected ${String(p.type)})`;
    default:
      return "";
  }
}

function fixHint(err: ErrorObject): string {
  switch (err.keyword) {
    case "additionalProperties":
      return "Remove the unknown field, or move it under `extensions` with an `x-` prefix.";
    case "required":
      return "Add the missing property.";
    case "enum":
    case "const":
      return "Use one of the allowed values.";
    case "pattern":
      return "Ids are kebab-case: lowercase letters, digits and single hyphens, starting with a letter (e.g. 'checkout-validate'). Acceptance criteria ids look like 'AC-1'.";
    case "discriminator":
      return "Set `type` to one of: startEvent, endEvent, intermediateCatchEvent, boundaryEvent, userTask, serviceTask, scriptTask, sendTask, receiveTask, manualTask, businessRuleTask, exclusiveGateway, parallelGateway, inclusiveGateway.";
    case "minItems":
      return "Provide at least the minimum number of items.";
    case "uniqueItems":
      return "Remove the duplicate entry.";
    default:
      return "Adjust the value to satisfy the schema.";
  }
}

/** Convert Ajv errors into schema.invalid findings, dropping noise (`if`/`oneOf` wrappers) and duplicates. */
export function schemaFindings(doc: unknown, errors: ErrorObject[] | null | undefined): RawFinding[] {
  const out: RawFinding[] = [];
  const seen = new Set<string>();
  for (const err of errors ?? []) {
    if (err.keyword === "if" || err.keyword === "oneOf" || err.keyword === "anyOf" || err.keyword === "allOf") continue;
    // The metaschema $ref for data-object schemas can produce deep, repetitive errors; collapse to the schema root.
    let path = err.instancePath || "/";
    const m = /^(\/data_objects\/\d+\/schema)(\/.*)?$/.exec(path);
    let message = `${path}: ${err.message ?? "invalid"}${paramsSummary(err)}`;
    if (m) {
      path = m[1]!;
      message = `${path}: not a valid JSON Schema 2020-12 document (${err.instancePath.slice(m[1]!.length) || "/"} ${err.message ?? "invalid"})`;
    }
    const key = `${path}|${err.keyword}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const loc = locate(doc, path);
    out.push({
      rule: "schema.invalid",
      message: loc?.id ? `${message} — in ${loc.kind} '${loc.id}'` : message,
      path,
      element: loc?.id ? { kind: loc.kind === "data object" ? "data_object" : (loc.kind as "node" | "edge" | "lane" | "process"), id: loc.id } : undefined,
      fix: fixHint(err),
      data: { keyword: err.keyword, params: err.params }
    });
  }
  return out;
}

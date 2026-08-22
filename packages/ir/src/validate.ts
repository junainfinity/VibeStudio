/**
 * The deterministic IR validator: JSON Schema first, then the semantic rule set.
 * Same input → same report (findings are sorted, ids are stable), so a
 * generating model can be retried against identical feedback.
 */
import { buildIndex } from "./graph.js";
import { RULES, SEVERITY_RANK, type Finding, type Mode, type RawFinding, type RuleId, type Severity } from "./rules/catalog.js";
import type { RuleContext, RuleFn } from "./rules/context.js";
import * as data from "./rules/data.js";
import * as gateways from "./rules/gateways.js";
import * as structural from "./rules/structural.js";
import * as topology from "./rules/topology.js";
import { schemaFindings, schemaValidator } from "./schema.js";
import type { ProcessIR } from "./types.js";

export interface ValidateOptions {
  /** draft = intake/clarification (missing detail → gaps); final = pre-render (default). */
  mode?: Mode;
}

export interface ValidationReport {
  ok: boolean;
  mode: Mode;
  schema_valid: boolean;
  counts: Record<Severity, number>;
  findings: Finding[];
  summary: string;
}

/** Semantic rules in evaluation order. Order does not affect results (findings are sorted) but is kept stable for debugging. */
export const SEMANTIC_RULES: readonly RuleFn[] = [
  structural.idDuplicate,
  structural.refUnknown,
  topology.graphNoStartOrEnd,
  topology.graphOrphan,
  topology.cardMismatch,
  topology.graphUnreachable,
  topology.graphNoPathToEnd,
  topology.edgeSelfLoop,
  topology.edgeDuplicate,
  gateways.gwConditionMissing,
  gateways.gwConditionMisplaced,
  gateways.gwDefaultMultiple,
  gateways.gwDefaultMissing,
  gateways.gwDefaultImplicit,
  gateways.gwDefaultConditional,
  gateways.gwConditionUnbound,
  gateways.gwPairingRequired,
  gateways.gwPairingInvalid,
  gateways.gwJoinMissing,
  gateways.gwRegionLeak,
  gateways.loopNoExit,
  data.edgeContractEmpty,
  data.dataNotAvailable,
  data.dataReadUnavailable,
  structural.dataUnused,
  structural.dataSchemaMissing,
  structural.dataSchemaInvalid,
  structural.taskCriteriaMissing,
  structural.taskCriteriaDuplicateId,
  structural.taskIntegrationMissing,
  structural.taskLaneKind,
  structural.laneUnused,
  structural.boundaryHostInvalid,
  structural.boundaryLaneMismatch,
  structural.eventTriggerKind,
  structural.provenanceAssumed,
  structural.assumptionUnconfirmed,
  structural.questionOpen
];

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Enough shape to run semantic rules without crashing, even if the schema check failed. */
export function looksLikeIR(doc: unknown): doc is ProcessIR {
  if (!isObj(doc)) return false;
  const arrs = ["lanes", "data_objects", "nodes", "edges"] as const;
  if (!arrs.every((k) => Array.isArray(doc[k]))) return false;
  if (!isObj(doc.process)) return false;
  const nodes = doc.nodes as unknown[];
  const edges = doc.edges as unknown[];
  const lanes = doc.lanes as unknown[];
  const dobjs = doc.data_objects as unknown[];
  return (
    nodes.every((n) => isObj(n) && typeof n.id === "string" && typeof n.type === "string") &&
    edges.every((e) => isObj(e) && typeof e.id === "string" && typeof e.from === "string" && typeof e.to === "string") &&
    lanes.every((l) => isObj(l) && typeof l.id === "string") &&
    dobjs.every((d) => isObj(d) && typeof d.id === "string")
  );
}

/** Locale-independent string order (code units), so reports are identical across machines. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pathKey(p: string): (string | number)[] {
  return p.split("/").filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

/** JSON-pointer order with numeric segments compared as numbers (/nodes/2 before /nodes/10). */
export function comparePaths(a: string, b: string): number {
  const ka = pathKey(a);
  const kb = pathKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const x = ka[i];
    const y = kb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else {
      const c = compareStrings(String(x), String(y));
      if (c !== 0) return c;
    }
  }
  return 0;
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      compareStrings(a.rule, b.rule) ||
      comparePaths(a.path, b.path) ||
      compareStrings(a.message, b.message)
  );
}

function assignSeverity(raw: RawFinding[], mode: Mode): Finding[] {
  const out: Finding[] = [];
  for (const f of raw) {
    const sev = RULES[f.rule as RuleId].severity[mode];
    if (sev === "off") continue;
    out.push({ ...f, severity: sev });
  }
  return out;
}

export function validate(doc: unknown, opts: ValidateOptions = {}): ValidationReport {
  const mode: Mode = opts.mode ?? "final";
  const validateFn = schemaValidator();
  const schemaOk = validateFn(doc) as boolean;
  const raw: RawFinding[] = schemaOk ? [] : schemaFindings(doc, validateFn.errors);

  if (looksLikeIR(doc)) {
    const ctx: RuleContext = { ir: doc, g: buildIndex(doc), mode };
    for (const rule of SEMANTIC_RULES) {
      try {
        raw.push(...rule(ctx));
      } catch (err) {
        // A schema-invalid document may have shapes the rules do not expect. Once the
        // schema errors are fixed the rules run for real; a crash on a valid document is a bug.
        if (schemaOk) throw new Error(`IR validator rule '${rule.name}' crashed: ${(err as Error).message}`, { cause: err });
      }
    }
  }

  const findings = sortFindings(assignSeverity(raw, mode));
  const counts: Record<Severity, number> = { error: 0, warning: 0, gap: 0 };
  for (const f of findings) counts[f.severity]++;
  const ok = counts.error === 0;
  const summary = `${ok ? "PASSED" : "FAILED"} (${counts.error} error${counts.error === 1 ? "" : "s"}, ${counts.warning} warning${counts.warning === 1 ? "" : "s"}, ${counts.gap} gap${counts.gap === 1 ? "" : "s"}) [mode=${mode}]`;
  return { ok, mode, schema_valid: schemaOk, counts, findings, summary };
}

/** Convenience: throws if the document has errors; returns the typed IR otherwise. */
export function assertValid(doc: unknown, opts: ValidateOptions = {}): ProcessIR {
  const report = validate(doc, opts);
  if (!report.ok) {
    const first = report.findings.filter((f) => f.severity === "error").slice(0, 5);
    throw new Error(`Invalid Process IR: ${report.summary}\n${first.map((f) => `- [${f.rule}] ${f.message}`).join("\n")}`);
  }
  return doc as ProcessIR;
}

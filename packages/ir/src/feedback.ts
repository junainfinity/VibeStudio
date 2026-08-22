/**
 * Turns a ValidationReport into (a) compact, deterministic feedback text for the
 * generating model's self-correction loop, and (b) themed clarifying questions
 * for the user-facing clarifying loop.
 */
import type { Finding, RuleId } from "./rules/catalog.js";
import { comparePaths, type ValidationReport } from "./validate.js";

export interface FeedbackOptions {
  /** Max findings listed per rule (the rest are summarised as "+N more"). Default 6. */
  maxPerRule?: number;
  /** Hard cap on output characters (trimmed at a line boundary). Default 6000. */
  maxChars?: number;
  /** Include warnings (default true) and gaps (default true). */
  includeWarnings?: boolean;
  includeGaps?: boolean;
}

function groupByRule(findings: Finding[]): Map<RuleId, Finding[]> {
  const m = new Map<RuleId, Finding[]>();
  for (const f of findings) {
    if (!m.has(f.rule)) m.set(f.rule, []);
    m.get(f.rule)!.push(f);
  }
  return m;
}

function section(title: string, findings: Finding[], maxPerRule: number, style: "fix" | "question"): string[] {
  if (findings.length === 0) return [];
  const lines: string[] = [title];
  let n = 0;
  for (const [, group] of groupByRule(findings)) {
    const shown = group.slice(0, maxPerRule);
    for (const f of shown) {
      n++;
      const tail = style === "question" ? f.question ?? f.fix : f.fix;
      lines.push(`${n}. [${f.rule}] ${f.message}${tail ? ` → ${tail}` : ""} (at ${f.path})`);
    }
    if (group.length > shown.length) lines.push(`   … +${group.length - shown.length} more [${group[0]!.rule}] like the above`);
  }
  return lines;
}

/**
 * Model-facing feedback. Errors first (must fix), then warnings, then gaps
 * (which the model must NOT invent answers to — they go to the user).
 */
export function formatFeedback(report: ValidationReport, opts: FeedbackOptions = {}): string {
  const maxPerRule = opts.maxPerRule ?? 6;
  const maxChars = opts.maxChars ?? 6000;
  const errors = report.findings.filter((f) => f.severity === "error");
  const warnings = opts.includeWarnings === false ? [] : report.findings.filter((f) => f.severity === "warning");
  const gaps = opts.includeGaps === false ? [] : report.findings.filter((f) => f.severity === "gap");

  const lines: string[] = [`Process IR validation: ${report.summary}`];
  if (!report.schema_valid) lines.push("The document does not match the Process IR JSON Schema; fix schema errors first — semantic checks may be incomplete until it does.");
  lines.push("");
  lines.push(...section("ERRORS — fix all of these, then re-emit the COMPLETE IR document:", errors, maxPerRule, "fix"));
  if (errors.length) lines.push("");
  lines.push(...section("WARNINGS — fix if you can without inventing facts:", warnings, maxPerRule, "fix"));
  if (warnings.length) lines.push("");
  lines.push(...section("OPEN GAPS — do NOT invent answers; the user will be asked these. Leave the affected elements as they are:", gaps, maxPerRule, "question"));
  if (errors.length === 0 && warnings.length === 0 && gaps.length === 0) lines.push("No findings. The IR is ready for rendering and confirmation.");

  let text = lines.join("\n").trimEnd();
  if (text.length > maxChars) {
    const cut = text.lastIndexOf("\n", maxChars - 40);
    text = `${text.slice(0, cut > 0 ? cut : maxChars - 40)}\n… (feedback truncated to ${maxChars} chars; fix the above and re-validate)`;
  }
  return text;
}

export type QuestionTheme = "process" | "tasks" | "decisions" | "data" | "integrations" | "assumptions" | "other";

export interface ClarifyingQuestion {
  theme: QuestionTheme;
  question: string;
  rule: RuleId;
  /** Element ids the answer will update. */
  affects: string[];
  path: string;
}

function themeOf(rule: RuleId): QuestionTheme {
  if (rule.startsWith("task.integration")) return "integrations";
  if (rule.startsWith("task.")) return "tasks";
  if (rule.startsWith("gw.")) return "decisions";
  if (rule.startsWith("data.") || rule.startsWith("edge.")) return "data";
  if (rule.startsWith("provenance.")) return "assumptions";
  if (rule.startsWith("question.")) return "other";
  return "process";
}

/**
 * Gaps → questions grouped by theme, deduplicated by text, in a stable order.
 * The clarifying loop batches these (2–3 rounds max) and writes answers back into the IR.
 */
export function toClarifyingQuestions(report: ValidationReport): ClarifyingQuestion[] {
  const seen = new Set<string>();
  const qs: ClarifyingQuestion[] = [];
  for (const f of report.findings) {
    if (f.severity !== "gap") continue;
    const q = f.question ?? f.message;
    if (seen.has(q)) continue;
    seen.add(q);
    const affects = Array.isArray(f.data?.affects) ? (f.data!.affects as string[]) : f.element ? [f.element.id] : [];
    qs.push({ theme: themeOf(f.rule), question: q, rule: f.rule, affects, path: f.path });
  }
  const order: QuestionTheme[] = ["process", "tasks", "decisions", "data", "integrations", "assumptions", "other"];
  return qs.sort((a, b) => order.indexOf(a.theme) - order.indexOf(b.theme) || comparePaths(a.path, b.path));
}

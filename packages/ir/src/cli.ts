#!/usr/bin/env node
/**
 * vibestudio-ir validate <file.json> [--mode draft|final] [--json] [--quiet]
 *
 * Exit codes: 0 = no errors, 1 = errors found, 2 = usage / read error.
 */
import { readFileSync } from "node:fs";
import { formatFeedback, toClarifyingQuestions } from "./feedback.js";
import { validate } from "./validate.js";

function usage(): never {
  process.stderr.write("usage: vibestudio-ir validate <file.json> [--mode draft|final] [--json] [--questions]\n");
  process.exit(2);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
if (cmd !== "validate" || !argv[1]) usage();

let mode: "draft" | "final" = "final";
let json = false;
let questions = false;
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--mode") {
    const m = argv[++i];
    if (m !== "draft" && m !== "final") usage();
    mode = m;
  } else if (a === "--json") json = true;
  else if (a === "--questions") questions = true;
  else usage();
}

let doc: unknown;
try {
  doc = JSON.parse(readFileSync(argv[1]!, "utf8"));
} catch (err) {
  process.stderr.write(`cannot read ${argv[1]}: ${(err as Error).message}\n`);
  process.exit(2);
}

const report = validate(doc, { mode });
if (json) {
  process.stdout.write(`${JSON.stringify(questions ? { report, questions: toClarifyingQuestions(report) } : report, null, 2)}\n`);
} else {
  process.stdout.write(`${formatFeedback(report)}\n`);
  if (questions) {
    const qs = toClarifyingQuestions(report);
    if (qs.length) {
      process.stdout.write("\nCLARIFYING QUESTIONS BY THEME:\n");
      for (const q of qs) process.stdout.write(`- (${q.theme}) ${q.question}  [${q.affects.join(", ")}]\n`);
    }
  }
}
process.exit(report.ok ? 0 : 1);

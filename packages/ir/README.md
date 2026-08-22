# @vibestudio/ir — Process IR v1

The single intermediate representation behind VibeStudio, plus the deterministic validator that gates everything generated from it.

- `schema/process-ir.v1.schema.json` — JSON Schema (draft 2020-12). Also the structured-output schema for the generating model.
- `src/types.ts` — TypeScript mirror of the schema (`ProcessIR`, `Node` union, `Edge`, …) with type guards.
- `src/validate.ts` — `validate(doc, { mode: "draft" | "final" })` → sorted, deterministic `ValidationReport`.
- `src/rules/` — the rule catalogue (`catalog.ts`: ids, per-mode severities) and implementations (structural, topology, gateways, data).
- `src/feedback.ts` — `formatFeedback(report)` for the model self-correction loop; `toClarifyingQuestions(report)` for the user-facing clarifying loop.
- `src/graph.ts` — graph index, reachability, SCCs, topological order (reused by the orchestrator later).
- `src/cli.ts` — `vibestudio-ir validate <file> [--mode draft|final] [--json] [--questions]`.
- `examples/` — `checkout.ir.json` (clean), `leave-request.draft.ir.json` (draft with gaps), `invalid/checkout-broken.ir.json`.

```ts
import { validate, formatFeedback, toClarifyingQuestions } from "@vibestudio/ir";

const report = validate(ir, { mode: "final" });
if (!report.ok) console.log(formatFeedback(report));         // feed back to the model
const questions = toClarifyingQuestions(validate(ir, { mode: "draft" }));
```

Design rationale, semantics and the full rule table: `../../docs/process-ir-v1.md`.

## Development

```bash
npm test          # vitest
npm run typecheck
npm run build     # dist/ (ESM + d.ts)
```

Every rule id has a mutation-based test in `test/rules.test.ts` that proves it can fire; `test/examples.test.ts` keeps the shipped examples honest.

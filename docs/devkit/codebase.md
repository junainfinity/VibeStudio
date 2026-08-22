# VibeStudio — codebase map in plain words

One section per module. Each says what it does in everyday language, which files belong to it, one observable sign it is working, and what to watch out for. Line references are avoided on purpose; function names are stable anchors.

## How it all runs

The product is a pipeline with one source of truth: a **Process IR** JSON document. `packages/ir` defines and judges it; `packages/bpmn` turns it into a diagram; `packages/speckit` turns it into documents; `apps/web` is a four-step wizard where an LLM writes the IR, the validator argues with it, the person answers questions and confirms, and everything is zipped into a hand-off folder. There is no backend service — the vite dev/preview server doubles as a key-injecting proxy for the model API (`apps/web/vite.config.ts`), and every generator runs in the browser.

- Entry point (app): `apps/web/index.html` → `src/main.tsx` → `src/App.tsx` (the wizard state machine).
- Entry point (libraries): each package's `src/index.ts` is its public API; everything else is internal.
- Build order: `ir` → `bpmn`, `speckit` (parallel) → `web`. Root `npm run build` encodes it.

## `packages/ir` — the Process IR: schema, validator, feedback (104 tests)

**What it does:** defines the process document every other part consumes, and judges documents deterministically: same input, byte-identical report, on any machine.

| File | Role |
| --- | --- |
| `schema/process-ir.v1.schema.json` | THE canonical JSON Schema (draft 2020-12). `oneOf` + `discriminator`, no `if/then`, no external `$ref`s — deliberately usable as an LLM tool/structured-output schema |
| `src/schema.gen.ts` | Generated TS copy of the schema (`npm run gen-schema`), so the library never touches `node:fs` and bundles for the browser. `test/schema-gen.test.ts` fails if it drifts |
| `src/schema.ts` | Ajv 2020 compilation (`schemaValidator`) and normalisation of Ajv errors into findings with fix hints (`schemaFindings`) |
| `src/types.ts` | 1:1 TypeScript mirror of the schema + type guards (`isTask`, `isGateway`, `isSplit`, `isJoin`). `test/types.test.ts` keeps schema and types in sync both directions |
| `src/graph.ts` | Graph index (`buildIndex`: sequence flows + implicit host→boundary edges), `stronglyConnectedComponents`, loop-aware `topologicalOrder`, `nearestWorkAncestors`/`Descendants` |
| `src/rules/catalog.ts` | The 40 rule ids with per-mode severities (`draft`/`final` × `error`/`warning`/`gap`/`off`) |
| `src/rules/structural.ts`, `topology.ts`, `gateways.ts`, `data.ts` | The rule implementations. `gateways.ts` is the deep end: token-soundness of parallel/inclusive blocks and loop-exit analysis |
| `src/rules/context.ts` | Shared `RuleContext`/`RuleFn` types plus the describe/path helpers every rule file uses |
| `src/validate.ts` | Orchestrates schema check + 39 semantic rules; sorts findings (code-unit compare, numeric path segments); `looksLikeIR` lets semantic rules run even when the schema fails |
| `src/feedback.ts` | `formatFeedback` (ERRORS/WARNINGS/OPEN GAPS text for the generating model) and `toClarifyingQuestions` (themed questions for the person) |
| `src/cli.ts` | `vibestudio-ir validate <file> [--mode] [--json] [--questions]` — the only file allowed to use `node:fs` |
| `examples/` | `checkout.ir.json` (clean, has a loop + parallel block + boundary event), `leave-request.draft.ir.json` (8 gaps), `invalid/checkout-broken.ir.json` (5 errors) |

**Works when:** `npx tsx src/cli.ts validate examples/checkout.ir.json` prints `PASSED (0 errors, 0 warnings, 0 gaps)` and exits 0.

**Watch out for:** severity semantics are the product's soul — `gap` means "ask the person, the model must not guess". Editing the schema without `npm run gen-schema` fails `schema-gen.test.ts`. Findings must stay deterministically sorted; never use `localeCompare`.

## `packages/bpmn` — IR → BPMN 2.0 XML + our own layout (36 tests)

**What it does:** turns an IR into standards-compliant BPMN XML that real tools (Camunda etc.) open, including diagram geometry (BPMNDI) computed by our own layered layout — `bpmn-auto-layout` was probed and rejected because it drops lane shapes.

| File | Role |
| --- | --- |
| `src/semantic.ts` | The 1:1 element mapping (lanes → `laneSet`, `direction` → `gatewayDirection`, `is_default` → `default` attr, boundary `attached_to` → `attachedToRef`, data objects opt-in) |
| `src/xml.ts` | Deterministic XML string builder; `escapeXml`/`escapeXmlAttribute` strip XML-1.0-illegal control chars and numerically escape attribute whitespace |
| `src/layout.ts` | `computeLayout(ir, includeDataObjects)`: longest-path layering for columns, lane bands for rows, boundary events half-on the host border (min pitch so siblings never overlap), exception edges confined to row/column gaps, loop edges routed in a track below all lanes. Exports `DiagramLayout`/`Rect`/`Point` for external renderers |
| `src/index.ts` | `toBpmnXml` (no DI), `irToBpmn` (with DI), `computeLayout` |

**Works when:** `npx vitest run` passes — including the DI invariants: a shape for every node, no overlaps except boundary-on-host, every node inside its lane band, every edge ≥ 2 finite waypoints.

**Watch out for:** the layout's documented cosmetic limits (forward edges skipping 2+ columns; 4+ boundary events overflowing the host's right edge). The no-overlap tests are the safety net — extend them before changing geometry. Runtime is dependency-free; `bpmn-moddle` is test-only.

## `packages/speckit` — IR → all human/agent documents (86 tests)

**What it does:** everything the output bundle says in words: spec kit, graph plan, and the notes scaffolds.

| File | Role |
| --- | --- |
| `src/context.ts` | Shared precomputed view (`buildContext`): loop-aware order, id→label helpers, `banner` |
| `src/markdown.ts` | Injection-hardened emission: `oneLine` (newline collapse), `cell` (backslash-then-pipe escape), `inlineCode` (backtick-run-proof), `renderDoc` (whole-file invariants: no trailing whitespace, single trailing newline, no empty sections) |
| `src/constitution.ts`, `spec.ts`, `plan.ts`, `contracts.ts` | The four spec-kit renderers. Contracts are `contracts/edge-<id>.md` (prefix prevents case-insensitive collision with `contracts/README.md`) |
| `src/graphplan.ts` | `generateGraphPlan`: machine-readable work packets (contracts in/out with embedded data schemas, acceptance criteria), loops with exits, gateway routing table; `renderGraphPlanMarkdown` for humans |
| `src/notes.ts` | `generateProcessNotes`: the troubleshooting + codebase scaffolds with self-identifying `[TO FILL <owner-id>]` markers, each owned by exactly one build sitting. Shaped by a 5-round adversarial review — read its header comment before restructuring |
| `src/types.ts` | `SpecFile`/`SpecKit` and the file-order contract |

**Works when:** `npx vitest run` passes — including `determinism.test.ts` (byte-identical output across runs) and `adversarial.test.ts` (hostile names can't break headings/tables).

**Watch out for:** every renderer must degrade gracefully (omit sections, never print `undefined` or empty lists) and route ALL free text through `oneLine`/`cell`. The notes marker grammar (`[TO FILL <owner-id>: …]`) is load-bearing — the builder commands in `apps/web/src/lib/prompts.ts` search by it.

## `apps/web` — the wizard (no unit tests; verified in-browser; libraries carry the test load)

**What it does:** Describe → Questions → Confirm → Download, for people who have never seen a flowchart. The brand is a `>` with a blinking `_` in matrix dark green; the site itself is deliberately light and friendly.

| File | Role |
| --- | --- |
| `src/App.tsx` | Wizard state machine (`describe → building → clarify → updating → confirm → feedback → output`), run-token cancellation, error surfacing. `FeedbackScreen` (what's wrong with the map) lives here too |
| `src/lib/agent.ts` | The in-app agent: OpenRouter chat completions through `/api/openrouter` (browser never holds a key). `MODELS` = primary + fallback (`z-ai/glm-5.2:free` → `poolside/laguna-s-2.1:free`); `extractJson` tolerantly pulls the document from fenced/prosey replies; `generateAndCorrect` runs the validator self-correction loop (max 3 fix rounds); `AgentError` maps failures to human sentences |
| `src/lib/prompts.ts` | `ANALYST_SYSTEM` (the IR-writing rules), `buildGeneratePrompt`/`buildUpdatePrompt`/`buildFixPrompt`, and `buildKickoffPrompt` — the bundle's builder instructions incl. the 7a–7d documentation duty |
| `src/lib/bundle.ts` | Assembles the output folder (README.html, IR, BPMN, SVG, speckit/, plan/, notes/) and zips it (jszip) |
| `src/lib/diagramSvg.ts` | Our own BPMN-style SVG renderer over `computeLayout` geometry (no bpmn-js: its license requires a watermark). Used live and for the bundle's `diagram.svg` |
| `src/lib/readmeHtml.ts` | The bundle's standalone plain-language cover page |
| `src/lib/download.ts` | Blob downloads (revoke deferred — sync revoke can abort downloads) |
| `src/components/` | `WizardSteps` (progress rail), `ProcessDiagram` (SVG host), `steps/` (Describe, Working, Clarify — typeform one-question-at-a-time with double-tap guard, Confirm with the "AI decided these" box, Output) |
| `src/index.css` | The whole theme and brand: light warm palette, typeform layout, the `>` + blinking `_` logo animation (`.brand-glyph .blink`) |
| `vite.config.ts` | The "backend": dev/preview proxy injecting `OPENROUTER_API_KEY` from `.env.local` (NOT `VITE_`-prefixed, so it can never enter the client bundle) |

**Works when:** `npm run dev` from the repo root, describe a process, and the wizard reaches the Download screen with a 30-file bundle (for the checkout example: 30 files incl. 2 notes).

**Watch out for:** the free models 429 and emit malformed JSON routinely — that is the normal path, not the error path; the fallback + fix rounds absorb it. After changing a library, the vite dep-optimizer may pin the stale dist: `rm -rf node_modules/.vite apps/web/node_modules/.vite` and restart. Skipped questions must become reviewable assumptions, never silent guesses.

## Root

`package.json` (workspaces + ordered build scripts), `docs/process-ir-v1.md` (the IR design rationale — read before touching rules), `docs/devkit/` (this kit), `.claude/launch.json` (dev-server launch with PATH wrapper for this machine).

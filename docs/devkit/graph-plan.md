# VibeStudio — graph plan (work packets + loops)

The build as a dependency graph, in the same shape VibeStudio's bundles use: one self-contained packet per unit of work — inputs (contracts from earlier packets), outputs (files + exported API), key decisions (the traps already paid for), and acceptance criteria (the tests). Follow `build_order`; no packet needs more than its own row plus its inputs in context.

`build_order`: P1 → P2 → P3 → P4 → P5 → (P6 → P7) ∥ (P8 → P9 → P10) → P11 → P12 → P13 → P14

## Packets

### P1 — IR schema + types (`packages/ir`: `schema/`, `src/types.ts`, `src/schema.ts`, `src/schema.gen.ts`, `scripts/gen-schema.mjs`)
- **In:** `docs/process-ir-v1.md` §2 (document shape).
- **Out:** canonical JSON Schema; TS mirror + guards; Ajv compilation + error normalisation (`schemaFindings` with per-keyword fix hints); generated schema module + `gen-schema` script.
- **Decisions:** portable schema constructs only (LLM-consumable); `oneOf`+`discriminator`; browser-safety via the generated module — never `readFileSync` in library code.
- **AC:** `test/types.test.ts`, `test/schema.test.ts`, `test/schema-gen.test.ts`.

### P2 — graph primitives (`src/graph.ts`)
- **In:** P1 types.
- **Out:** `buildIndex` (+ implicit host→boundary edges), `reachableFrom`, `stronglyConnectedComponents`, loop-aware `topologicalOrder`, `nearestWorkAncestors`/`Descendants`.
- **Decisions:** the analysis graph includes host→boundary so exception paths count as flow; topo order sorts loop members merge→body→exit (everything downstream depends on this).
- **AC:** `test/graph.test.ts`.

### P3 — the 40 rules (`src/rules/`)
- **In:** P1+P2.
- **Out:** catalog (ids × per-mode severities) + implementations across structural/topology/gateways/data; every finding with `fix`, gap rules with `question`.
- **Decisions:** severity = product semantics (gap ⇒ ask the person); token-soundness via region accounting around paired splits/joins; data availability local (∪ / ∩-at-XOR / host-incoming-at-boundary), no transitive inference; questions name work, not plumbing.
- **AC:** `test/rules.test.ts` (mutation per id + coverage assertion), `test/blocks.test.ts`.

### P4 — validate, feedback, CLI (`src/validate.ts`, `src/feedback.ts`, `src/cli.ts`, `src/index.ts`)
- **In:** P1–P3.
- **Out:** sorted deterministic reports; `formatFeedback` / `toClarifyingQuestions`; `assertValid`; CLI with `--mode/--json/--questions`, exit codes: 0 = no errors, 1 = errors found, 2 = usage or unreadable file.
- **Decisions:** semantic rules run even when the schema fails (one feedback round covers both layers); code-unit sorts only.
- **AC:** `test/feedback.test.ts`; determinism assertions.

### P5 — examples (`examples/`)
- **Out:** `checkout.ir.json` (clean; 18 nodes / 18 edges / 3 lanes; contains a retry loop, a parallel block and a boundary event — every downstream package tests against it), `leave-request.draft.ir.json` (draft, 8 gaps), `invalid/checkout-broken.ir.json` (5 errors, every one with a fix hint).
- **Note for rebuilders:** all fixture-relative numbers in this kit (8 gaps, 5 errors, "30 bundle files" = 12 fixed + 18 edge contracts for checkout, exact test counts) describe THESE fixtures. If you author equivalent examples instead of copying `packages/ir/examples/`, derive your own numbers and keep the properties (clean / draft-with-gaps / broken-with-fix-hints).
- **AC:** `test/examples.test.ts`.

### P6 — BPMN semantics + XML (`packages/bpmn`: `src/semantic.ts`, `src/xml.ts`)
- **In:** ir API (types, `buildIndex`); `docs/process-ir-v1.md` §5 mapping.
- **Out:** `toBpmnXml` — semantic BPMN 2.0, deterministic string builder, hardened escaping (illegal-char stripping; attribute `&#10;/&#13;/&#9;`).
- **Decisions:** hand-rolled XML keeps runtime dependency-free; `bpmn-moddle` test-only; generated ids carry an underscore so they can never collide with kebab-case document ids.
- **AC:** `test/semantic.test.ts` + escaping cases in `test/options.test.ts`.

### P7 — layout + DI (`src/layout.ts`, `src/index.ts`)
- **In:** P6; ir graph exports.
- **Out:** `computeLayout` (exported geometry: `DiagramLayout`/`Rect`/`Point`) + `irToBpmn` (BPMNDI).
- **Decisions:** probe `bpmn-auto-layout` first — it drops lane shapes; ship our own layered layout instead (tractable because tasks are 1-in/1-out and blocks well-nested). Boundary siblings need a minimum pitch (EVENT_SIZE+4). Exception edges route through gap bands, never through shapes. Loop edges get a below-lanes track. Document the two cosmetic limits honestly.
- **AC:** `test/di.test.ts` over `test/fixtures.ts` (multi-boundary, deep handlers, stacked rows, loops) with exact segment-vs-rect crossing checks.

### P8 — spec kit (`packages/speckit`: `context.ts`, `markdown.ts`, `constitution.ts`, `spec.ts`, `plan.ts`, `contracts.ts`, `types.ts`)
- **In:** ir API.
- **Out:** `generateSpecKit` → 4 core files + `contracts/edge-<id>.md` per edge, stable order.
- **Decisions:** all free text through `oneLine`/`cell`/`inlineCode`; `renderDoc` enforces whole-file invariants by construction; `edge-` prefix kills the case-insensitive `README.md` collision; degrade gracefully, never print `undefined`/empty sections.
- **AC:** `test/checkout.test.ts`, `leave-request.test.ts`, `minimal.test.ts`, `adversarial.test.ts`, `determinism.test.ts`.

### P9 — graph plan generator (`src/graphplan.ts`)
- **In:** P8 context/markdown; ir SCC + nearest-work exports.
- **Out:** `generateGraphPlan` (packets with embedded data schemas, loops with exits, routing table) + `renderGraphPlanMarkdown`.
- **Decisions:** packets embed every schema they touch (32k-window self-containment); routing belongs to the orchestrator, never tasks.
- **AC:** `test/graphplan.test.ts`.

### P10 — notes generator (`src/notes.ts`)
- **In:** P8+P9. (A **sitting** = the single work session in which one packet is built — the unit of the 27B/32k one-packet rule and of marker ownership.)
- **Out:** `generateProcessNotes` — the troubleshooting + codebase scaffolds (owner-language Quick map with hand-off/fan-out rows, Triage with branch caveat, self-identifying single-sitting `[TO FILL]` markers, sitting clauses on all routing markers, "(finishing step)" class, builder-editable banner). Marker grammar, verbatim: `[TO FILL record-order: file path(s) and function name]` — owner id first, colon, instructions; the matching 7a search string is `[TO FILL record-order`.
- **Decisions:** every structural rule here exists because a judge lens failed it — run the § Methodology judge loop when changing structure; unit tests alone are not the bar.
- **AC:** `test/notes.test.ts`.

### P11 — wizard shell + theme (`apps/web`: `vite.config.ts`, `index.html`, `src/main.tsx`, `src/index.css`, `src/App.tsx`, `src/components/WizardSteps.tsx`, `steps/DescribeStep.tsx`, `steps/WorkingScreen.tsx`, `steps/ClarifyStep.tsx`, `steps/ConfirmStep.tsx` sans diagram, `FeedbackScreen`)
- **In:** ir API only (validation runs client-side).
- **Out:** four-phase state machine with run-token cancellation; light friendly theme; `>` + blinking `_` logo (two glyphs); typeform clarify with double-tap guard and skip-means-reviewable-assumption; live-events working screen (no fake progress).
- **Decisions:** no JSON in the main path; errors as human sentences; the working screen shows only real agent events.
- **AC:** in-browser E2E with a mocked model API (all four phases, back-navigation, restart).

### P12 — agent + prompts (`src/lib/agent.ts`, `src/lib/prompts.ts`, proxy in `vite.config.ts`, `.env.local`)
- **In:** P11 shell; ir `loadSchema`/`validate`/`formatFeedback`/`toClarifyingQuestions`.
- **Out:** proxy-backed OpenRouter client (no client credential, no key UI); primary→fallback model rotation; tolerant `extractJson`; `generateAndCorrect` fix-round loop; analyst/update/fix prompts; `buildKickoffPrompt` — its numbered commands: (1) read README.html then plan/graph-plan.json as source of truth; (2) build one packet at a time in build_order, packets are self-contained; (3) consult speckit/spec.md and contracts/ for the packet at hand; (4) routing from routing[] lives in the orchestrator, never in tasks; (5) implement loop exits exactly, never loop unconditionally; (6) verify each packet's acceptance criteria before moving on; (7) documentation duty 7a–7d (marker search by owner id; routing incl. first-step start wiring is part of the packet sitting; data markers on store creation; bounded finishing incl. "(finishing step)" markers).
- **Decisions:** key server-side only; auth errors never trigger fallback; skipped questions → assumptions with provenance; every 7x command names a literal search string.
- **AC:** E2E with mocked 200/401/429/malformed responses; one live free-tier run (expect 429s and malformed JSON — the loop must absorb both).

### P13 — diagram renderer (`src/lib/diagramSvg.ts`, `src/components/ProcessDiagram.tsx`, diagram into ConfirmStep)
- **In:** bpmn `computeLayout`; P11.
- **Out:** `renderDiagramSvg` (live + standalone) — lanes with rotated headers, BPMN-ish glyphs, default-flow slashes, wrapped labels, edge labels, arrowheads.
- **Decisions:** no embedded viewer (bpmn-js license watermark) — same geometry as the exported `.bpmn` so screen and file can't disagree; pure SVG scales via viewBox (no fit/measure code at all).
- **AC:** E2E screenshot review on checkout (lanes, boundary ring, slash markers, no watermark); shared-geometry check against `irToBpmn`.

### P14 — bundle + hand-off (`src/lib/bundle.ts`, `src/lib/readmeHtml.ts`, `src/lib/download.ts`, `steps/OutputStep.tsx`)
- **In:** everything.
- **Out:** `buildBundle` (README.html cover; IR; BPMN; SVG; speckit/; plan/; notes/) + `zipBundle`; Output screen with per-file plain-language table and the kickoff-prompt copy button.
- **Decisions:** README.html is standalone (inline CSS, no scripts); deferred object-URL revoke; audience labels ("for you" / "for your AI builder" / "for diagram tools") drive both UI and cover page.
- **AC:** E2E — checkout bundle = 30 files incl. both notes; zip opens; README.html lists every file.

## Loops

### Runtime loops (in the product)
| Loop | Members | Exit condition | Where |
| --- | --- | --- | --- |
| Self-correction | model draft → validate(draft) → `formatFeedback` → model fix | draft errors = 0, or 3 rounds → human-sentence failure | `agent.ts` `generateAndCorrect` |
| Clarify | questions → person answers/skips → model update (answers worked in; skips become `assumed`) → validate → possibly more questions | final-mode ok → Confirm | `App.tsx` `submitAnswers` + `ClarifyStep` |
| Correction | Confirm → "Something's off" free text → model update → validate | person confirms the map | `App.tsx` `submitFeedback` + `FeedbackScreen` |
| Model fallback | primary call fails (non-auth) → same call on fallback model | success, or surfaced `AgentError` | `agent.ts` `callModel` |

### Methodology loops (how this repo was built — part of the recipe)
| Loop | Shape | Exit condition |
| --- | --- | --- |
| Regression-test-first fix | reproduce as a failing test → fix → test passes, suite green | the bug can never silently return |
| Adversarial review | build → independent reviewer lenses (correctness, spec-conformance, docs-accuracy) find; skeptics verify each finding with a reproduction → fix confirmed findings | no confirmed must-fix findings remain |
| Judge-lens loop (documents) | generate real samples → role-played judges (non-technical owner routing incidents; literal 27B/32k harness simulating the duty) → fix → re-judge with "verify each prior class is closed; hunt new problems" | every lens passes; nice-to-haves triaged |

The notes generator (P10) took five judge rounds; the layout engine (P7) and markdown hardening (P8) each took a full adversarial-review round. Budget for the loops when recreating — they are where the quality lives.

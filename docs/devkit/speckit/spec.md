# VibeStudio — specification

What each component must do. Acceptance criteria are the named test files — when rebuilding, write those tests as you build each component; they are the definition of done, not an afterthought.

## `@vibestudio/ir`

### Schema & types
- The canonical JSON Schema (`schema/process-ir.v1.schema.json`) expresses: process meta, lanes (human/system/external), data objects (optional embedded JSON Schema, states, sensitivity), six node families (start/end/intermediate-catch/boundary events, 7 task types, 3 gateway types × split/join), edges with mandatory `data_contract`, requirements (NFRs, assumptions, open questions), `x-` extensions. Kebab-case ids, one namespace. Portable constructs only: `oneOf`+`discriminator`, no `if/then`, no defaults, no external `$ref`s.
- TS types mirror it 1:1 with guards. **AC:** `test/types.test.ts` (typed literals pass the schema; schema enums equal exported constants), `test/schema.test.ts`, `test/schema-gen.test.ts` (generated module ≡ JSON).

### Graph
- `buildIndex` (flows + implicit host→boundary edges), `reachableFrom` (fwd/rev), Tarjan SCCs, loop-aware `topologicalOrder` (Kahn over the SCC DAG; loop members merge→body→exit), `nearestWorkAncestors`/`Descendants` (look through gateways). **AC:** `test/graph.test.ts`.

### Rules (40 ids)
- Per-mode severities per `src/rules/catalog.ts`. Structural (ids, refs, lanes, criteria, boundary hosts, provenance/assumption/question hygiene), topology (start/end presence, orphans, cardinality per node kind, reachability, self-loops, duplicate edges), gateways (condition placement/defaults, pairing, token-soundness of parallel/inclusive blocks: no branch escapes/re-enters, exactly one flow per branch into the join, nothing external enters; loop-exit existence), data (local availability: ∪ carries at most nodes, ∩ at XOR/OR joins, host-incoming at boundary events; reads covered; contracts non-empty; schemas compile).
- Every finding carries `fix` (for the model) and gap-capable rules carry `question` (for the person), phrased about work, not plumbing. **AC:** `test/rules.test.ts` (a mutation per rule id + table-covers-RULE_IDS assertion), `test/blocks.test.ts` (adversarial block/loop suite), `test/examples.test.ts` (clean/draft/broken examples behave as documented).

### Validate & feedback
- `validate(doc, {mode})` → sorted, counted report; semantic rules still run on schema-invalid-but-IR-shaped docs; rule crashes only propagate when the schema was valid. `formatFeedback` (capped per rule, truncated at line boundary, deterministic), `toClarifyingQuestions` (themed, deduplicated), `assertValid`, `loadSchema` (returns the canonical schema object — the wizard embeds it in the model's system prompt). CLI wraps it. **AC:** `test/feedback.test.ts`; the determinism assertions live in `test/rules.test.ts` ("is deterministic") and `test/feedback.test.ts` (caps deterministically).

## `@vibestudio/bpmn`

- `toBpmnXml`: the §5 mapping of `docs/process-ir-v1.md`; XML escaping strips XML-1.0-illegal control chars, attributes numerically escape newline/tab/CR; sequence-flow documentation carries the data contract; data objects opt-in. **AC:** `test/semantic.test.ts`, escaping/round-trip cases in `test/options.test.ts` (bpmn-moddle parses with zero warnings). Additionally, the output is xmllint-clean — a manually verified property, not asserted by the suite.
- `computeLayout`/`irToBpmn`: deterministic layered layout with the invariants: shape per node (incl. boundary events half-on the host border with ≥ EVENT_SIZE+4 sibling pitch), lane bands spanning the diagram, containment, no overlaps (boundary-on-host excepted), edges ≥ 2 integral waypoints, exception edges confined to row/column gap bands entering the target's left border, loop edges in a below-lanes track. Documented cosmetic limits: 2+-column forward skips; 4+ boundary overflow. **AC:** `test/di.test.ts` incl. segment-vs-shape crossing checks over the adversarial fixtures in `test/fixtures.ts`.

## `@vibestudio/speckit`

- Spec kit: `constitution.md` (actors+kinds, ground rules from NFRs, assumptions), `spec.md` (per-task sections in loop-aware order with G/W/T tables; Decisions; Events), `plan.md` (build order with contracts via nearest-work labels; integrations; NFR mapping; open questions), `contracts/edge-<id>.md` + `contracts/README.md` index. Banner on every file; graceful omission; injection-hardened. **AC:** `test/checkout.test.ts`, `leave-request.test.ts`, `minimal.test.ts`, `adversarial.test.ts`, `determinism.test.ts`.
- Graph plan: `generateGraphPlan` (packets: per-edge input/output flows with via/work/carries/condition, reads/writes, embedded data schemas, ACs, integration, loop membership+exits; loops: members in build order + exit edges; routing table per gateway) and `renderGraphPlanMarkdown`. **AC:** `test/graphplan.test.ts`.
- Notes: `generateProcessNotes` — troubleshooting scaffold (owner-language Quick map incl. hand-off and fan-out rows, Triage with branch caveat, per-step/decision/loop/data sections, every code location a self-identifying `[TO FILL <owner-id>]` marker whose owner is exactly one build sitting, routing markers naming their sitting, "(finishing step)" markers for cross-packet assembly) + codebase scaffold (per-packet placeholder with the 4-part fill instruction, "How it all runs"). Builder-editable banner. **AC:** `test/notes.test.ts` (coverage, marker uniqueness/self-identification, sitting clauses, parallel fan-out wording, phrasing regressions).

## `@vibestudio/web`

- Wizard state machine with cancellation; four steps; typeform clarify (Enter advances, Skip allowed, double-tap guarded, skipped→assumed); Confirm surfaces provenance-`assumed` + unconfirmed assumptions and offers free-text corrections; Output builds the 9-kind bundle (README.html cover, `process.ir.json`, `process.bpmn`, `diagram.svg`, `speckit/*`, `plan/graph-plan.{json,md}`, `notes/{troubleshooting,codebase}.md`) and zips it.
- Agent: OpenRouter chat completions via the proxy; models `["z-ai/glm-5.2:free", "poolside/laguna-s-2.1:free"]` primary→fallback on any non-auth failure; system prompt = analyst rules + canonical schema + JSON-only; tolerant `extractJson`; ≤ 3 validator fix rounds per phase; human-sentence `AgentError`s.
- Kickoff prompt: packet execution rules + documentation duty 7a–7d (marker search by owner id, routing-in-packet-sitting incl. first-step start wiring, data markers on store creation, bounded finishing incl. "(finishing step)" markers).
- Diagram: `renderDiagramSvg` over `computeLayout` — lane header strips with rotated names, BPMN-ish shapes/markers (thick end circles, double catch/boundary rings, gateway ×/+/○, default-flow slash), wrapped labels, edge labels on the longest segment, arrowheads; standalone mode for the bundle SVG.
- **AC:** libraries green; in-browser E2E of all four steps incl. error paths (bad key → human sentence; both-models-fail → rephrase suggestion); bundle contains all file kinds; no watermark; production build clean.

### Field shapes the schema pins (copy the canonical schema rather than re-deriving)
`sensitivity`: public | internal | confidential | pii | payment · `integration`: { system, lane?, operation?, direction? (outbound|inbound|both), protocol?, description? } · `condition.language`: natural | cel | javascript · `provenance`: { status: stated|inferred|assumed, source?, confidence? } · acceptance criterion ids: `AC-<n>`, unique per node · `ir_version`: literal "1.0".

## Cross-cutting
Root scripts build in dependency order; 226 tests green (`ir` 104, `bpmn` 36, `speckit` 86); `npm run typecheck` clean everywhere; the wizard runs with zero backend beyond the vite proxy.

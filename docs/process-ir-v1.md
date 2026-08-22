# VibeStudio — Process IR v1 and the deterministic validator

Status: **v1 draft for review** (closes open items 1 and 2 of the plan context). Reference implementation: `packages/ir` (`@vibestudio/ir`) — JSON Schema, TypeScript types, validator (40 rules), feedback formatter, CLI, 104 tests including an adversarial block/loop suite that was written after an independent review pass.

## 1. Why the IR looks the way it does

The IR is the single source of truth: BPMN XML, the spec kit and the graph dev plan are all *generated* from it and never authored independently. That puts three demands on its design.

First, it must be **generatable by a large model under a JSON Schema**, so the schema uses only portable constructs (a `oneOf` union of node variants discriminated by `type`, no `if/then`, no defaults) and every semantic rule that JSON Schema cannot express lives in the validator with a plain-language fix hint. The model does not need to know BPMN; it needs to know tasks, decisions, actors and data.

Second, it must be **strict enough that downstream generation is mechanical**. Every task has exactly one incoming and one outgoing flow (merges and branches are explicit gateways), every gateway is either a split or a join, parallel/inclusive blocks are explicitly paired and well-nested, and every edge carries a data contract. Those constraints are what make "one node = one unit of work with contracts on its edges" true by construction rather than by hope.

Third, it must **carry the clarifying loop's state**. Elements have `provenance` (`stated | inferred | assumed`), tasks carry Given/When/Then acceptance criteria, and the document has `requirements.open_questions`. The validator has a `draft` mode in which missing detail becomes a *gap* (a question for the user) rather than an error, so intake, clarification and final validation are one mechanism.

## 2. Document shape

```
ProcessIR
├─ ir_version: "1.0"
├─ process        { id, name, description?, goal?, domain?, provenance? }
├─ lanes[]        { id, name, kind: human|system|external, description?, provenance? }
├─ data_objects[] { id, name, description?, schema? (JSON Schema 2020-12), states?[], sensitivity?, provenance? }
├─ nodes[]        StartEvent | EndEvent | IntermediateCatchEvent | BoundaryEvent | Task | Gateway
├─ edges[]        { id, from, to, name?, condition?, is_default?, data_contract, provenance? }
├─ requirements?  { non_functional[], assumptions[], open_questions[] }
└─ extensions?    { "x-…": any }
```

All ids are kebab-case and share **one namespace** across the whole document (process, lanes, data objects, nodes, edges, NFRs, assumptions, questions). Array order is preserved but carries no meaning except that lanes render top-to-bottom in that order.

### 2.1 Node variants

| `type` | Extra fields | Degree (in / out) | Meaning |
| --- | --- | --- | --- |
| `startEvent` | `trigger? {kind: none\|message\|timer\|signal, detail?}`, `data? {writes}` | 0 / 1 | Where an instance begins; `writes` is the trigger payload |
| `endEvent` | `result? {kind: none\|terminate\|error\|message, detail?}` | 1 / 0 | `terminate` stops every parallel branch |
| `intermediateCatchEvent` | `trigger {kind: message\|timer\|signal}`, `data? {reads, writes}` | 1 / 1 | Wait for something mid-flow |
| `boundaryEvent` | `attached_to` (a task), `trigger {kind: error\|timer\|message\|signal}`, `interrupting?` (default true), `data? {writes}` | 0 / 1 | Exception path off a task |
| `userTask` `serviceTask` `scriptTask` `sendTask` `receiveTask` `manualTask` `businessRuleTask` | `data? {reads, writes}`, `acceptance_criteria[]`, `integration?` | 1 / 1 | One unit of work → one node in the dev plan |
| `exclusiveGateway` `parallelGateway` `inclusiveGateway` | `direction: split\|join`, `pairs_with?` | split 1 / ≥2, join ≥2 / 1 | XOR / AND / OR routing |

Every node has `id, type, name, lane` and optional `description, provenance, extensions`.

Deliberately **not** in v1: pools/message flows (external parties are lanes of kind `external`), sub-processes/call activities (escalation decomposes a node in place into a subgraph), event-based gateways, multi-instance markers, compensation. Each is an additive change to the schema when needed.

### 2.2 Gateway semantics

A gateway is a split or a join, never both. Conditions and `is_default` may only appear on edges leaving an exclusive/inclusive split; parallel splits are unconditional. Every branch of an exclusive/inclusive split needs a condition or is the single default (a missing default is a warning in final mode: the process would be stuck if no condition matched).

Pairing: a **join declares the split it closes** via `pairs_with` (same gateway type). It is required for parallel and inclusive joins and optional for exclusive joins, because exclusive merges are legitimately used unpaired (a loop's re-entry point is an XOR merge whose "split" is downstream). Every parallel/inclusive split must have exactly one join. For a paired parallel/inclusive block the validator enforces token soundness, i.e. the join can always fire exactly once: no branch may reach a non-terminate end event without passing the join (an interrupting boundary path that ends kills the block; a non-interrupting one may end on its own), no branch may loop back to the split without passing the join, nothing may enter the block except through the split (no loop-backs or second start events into a branch), every branch delivers **exactly one** flow into the join (an XOR decision or an exception path inside a branch must be merged with an XOR join *before* the parallel join, not wired into it twice), and the join receives nothing from outside the block. A direct split→join "skip" edge is a legal empty branch. For exclusive pairs only the last check applies, and a join that precedes its declared split is recognised as a loop re-entry merge and told to drop `pairs_with`.

Loops are allowed (retry, revise-and-resubmit) but every cycle must have a conditional exit: an exclusive/inclusive split with an edge that leaves the cycle, or a task whose normal completion leaves the cycle while a boundary-event path loops back (retry-on-error). Combined with "every node reaches an end event" this rules out both unconditional and dead loops.

### 2.3 Data model and contracts

`data_objects` are named things with an optional JSON Schema (draft 2020-12, validated against the metaschema and compiled to catch bad regexes etc.). Nodes declare `data.reads` and `data.writes`; edges declare `data_contract.carries` (data-object ids guaranteed present at the target) and `invariants` (predicates that hold there).

Availability is **local and declarative** — no transitive inference, which keeps the check deterministic and the error message concrete:

```
incoming(u)  = ∪ carries(e) for e into u            (tasks, events, splits, parallel joins)
             = ∩ carries(e) for e into u            (exclusive / inclusive joins — only one branch is guaranteed)
             = incoming(host)                       (boundary events: the host may not have completed,
                                                     so its writes are NOT guaranteed on the exception path)
available(u) = writes(u) ∪ incoming(u)
```

An edge may only carry what is available at its source (`data.not-available`); a node may only read what its incoming flow carries (`data.read-unavailable`). The intersection rule at XOR merges is intentionally strict: it forces state that must survive a loop (e.g. `order.payment_attempts`) onto an object that flows on every path, which is exactly what an implementer needs to know.

Formal conditions (`language: "javascript" | "cel"`) reference data objects by identifier: the data-object id with hyphens replaced by underscores (`payment-result` → `payment_result`), exported as `dataIdentifier()`. A formal condition that references a data object not carried into its split is flagged (`gw.condition-unbound`); natural-language conditions are never parsed.

## 3. Validator

`validate(doc, { mode })` runs the JSON Schema check, then 39 semantic rules (40 rule ids including the schema check) over a graph index (sequence flows plus implicit host→boundary edges), and returns a sorted, deterministic report:

```ts
{ ok, mode, schema_valid, counts: {error, warning, gap}, findings: Finding[], summary }
Finding = { rule, severity, message, path (JSON pointer), element?, fix?, question?, data? }
```

Semantic rules still run when the schema fails, as long as the document is IR-shaped (arrays present, nodes/edges with string ids), so one round of feedback covers both layers. Findings are sorted by severity, rule id, path (numeric path segments compared numerically, locale-independent) — same input, same output on any machine.

Severities: `error` blocks rendering and is fed back to the generating model; `warning` is surfaced but non-blocking; `gap` is a question for the user that the model must not answer by guessing. Modes: `draft` (intake/clarification) and `final` (before render/confirm).

### 3.1 Rule catalogue

| Rule | draft / final | What it checks | Brief requirement |
| --- | --- | --- | --- |
| `schema.invalid` | error / error | JSON Schema violation (Ajv errors normalised: path, offending field, allowed values, fix) | — |
| `id.duplicate` | error / error | id reused anywhere in the document | — |
| `ref.unknown` | error / error | lane, node, data object, gateway or task reference does not resolve | — |
| `graph.no-start-or-end` | error / error | at least one start and one end event | every path reaches an end |
| `graph.orphan` | error / error | node with no edges at all | no orphan nodes |
| `card.mismatch` | error / error | in/out-degree per node kind (table above) | orphans; split/join shape |
| `graph.unreachable` | error / error | node not reachable from any start event | no orphan nodes |
| `graph.no-path-to-end` | error / error | node cannot reach any end event | every path reaches an end |
| `edge.self-loop` | error / error | `from == to` | — |
| `edge.duplicate` | error / error | two edges with same source and target | — |
| `gw.condition-missing` | **gap** / error | branch of XOR/OR split has neither condition nor `is_default` | gateway semantics |
| `gw.condition-misplaced` | error / error | condition/default on an edge not leaving an XOR/OR split | gateway semantics |
| `gw.default-multiple` | error / error | more than one default branch | gateway semantics |
| `gw.default-missing` | off / warning | XOR/OR split where every branch has a condition and none is default | gateway semantics |
| `gw.default-implicit` | error / error | exactly one bare branch and no default → deterministic fix: mark it `is_default` (not a user question) | gateway semantics |
| `gw.default-conditional` | error / error | default flow also carries a condition | gateway semantics |
| `gw.condition-unbound` | warning / warning | formal (js/cel) condition references a data object not carried into the split | gateway semantics |
| `gw.pairing-required` | error / error | parallel/inclusive join without `pairs_with` | matching splits/joins |
| `gw.pairing-invalid` | error / error | `pairs_with` on a split, wrong type/direction, or split claimed twice | matching splits/joins |
| `gw.join-missing` | error / error | parallel/inclusive split with no join | matching splits/joins |
| `gw.region-leak` | error / error | block not token-sound: branch ends without the join / re-enters the split / entered from outside / delivers ≠1 flow to the join / join fed by merged branches or an outside node; or the "join" precedes its split | matching splits/joins |
| `loop.no-exit` | error / error | cycle without a conditional exit (XOR/OR split, or task completion vs. boundary path) | every path reaches an end |
| `edge.contract-empty` | **gap** / warning | `carries` empty | every edge has a contract |
| `data.not-available` | error / error | edge carries data not available at its source | every edge has a contract |
| `data.read-unavailable` | error / error | node reads data its incoming flow does not carry | every edge has a contract |
| `data.unused` | warning / warning | data object never referenced | — |
| `data.schema-missing` | **gap** / warning | data object without schema | — |
| `data.schema-invalid` | error / error | data object schema does not compile | — |
| `task.criteria-missing` | **gap** / error | task without acceptance criteria | spec kit needs G/W/T |
| `task.criteria-duplicate-id` | error / error | AC ids repeat within a task | — |
| `task.integration-missing` | **gap** / warning | service/send/receive task without `integration` | — |
| `task.lane-human-required` | error / error | user/manual task in a `system` lane (human and external lanes are fine) | — |
| `task.lane-kind-suspicious` | warning / warning | automated task in a human lane | — |
| `lane.unused` | warning / warning | lane with no nodes | — |
| `boundary.host-invalid` | error / error | boundary event attached to a non-task | — |
| `boundary.lane-mismatch` | warning / warning | boundary event in a different lane than its host | BPMN rendering |
| `event.trigger-kind` | error / error | trigger kind not allowed for the event type | — |
| `provenance.assumed` | **gap** / warning | element marked `assumed` | clarifying loop |
| `assumption.unconfirmed` | **gap** / warning | `requirements.assumptions` entry without `confirmed: true` | clarifying loop |
| `question.open` | **gap** / warning | unanswered `open_questions` entry | clarifying loop |

Every finding carries a `fix` written for the generating model ("Add a parallelGateway with direction "join" and pairs_with "gw-fulfil-split", and route every branch into it") and, for gap-capable rules, a `question` written for the user ("At 'Payment approved?', under what condition does the flow go to 'Confirm order'?").

### 3.2 Feedback contract (self-correction loop)

`formatFeedback(report, { maxPerRule = 6, maxChars = 6000 })` renders the report as three sections — ERRORS (fix, then re-emit the complete IR), WARNINGS (fix without inventing facts), OPEN GAPS (do not guess; these go to the user) — grouped by rule, capped per rule with "+N more", and truncated at a line boundary. It is deterministic, so retrying the model against identical feedback is meaningful.

`toClarifyingQuestions(report)` turns gaps into `{theme, question, rule, affects[], path}` grouped by theme (process → tasks → decisions → data → integrations → assumptions → other) and de-duplicated. The clarifying loop batches these by theme into its 2–3 rounds and writes answers back into the IR (acceptance criteria, conditions, schemas, `provenance.status`, `confirmed: true`, `answered: true`). Questions name work, not plumbing: for an edge leaving a gateway the question names the upstream task(s); for an edge into an end event it asks for the process result.

### 3.3 Intake mapping

The requirement schema from §2.1 of the plan context is a projection of the IR, so the extractor emits a *draft IR* directly rather than a separate structure: actors → `lanes`; triggers → `startEvent.trigger`; tasks → task nodes; decisions → exclusive/inclusive splits with conditions; data objects → `data_objects` + `carries`; integrations → `task.integration`; NFRs → `requirements.non_functional`. Gap detection is `validate(draft, { mode: "draft" })`.

## 4. Using it

```ts
import { validate, formatFeedback, toClarifyingQuestions, assertValid } from "@vibestudio/ir";

const report = validate(irJson, { mode: "final" });   // or "draft" during intake
if (!report.ok) modelPrompt += formatFeedback(report);  // self-correction round
const questions = toClarifyingQuestions(validate(irJson, { mode: "draft" }));
```

CLI: `vibestudio-ir validate <file> [--mode draft|final] [--json] [--questions]` (exit 0 = no errors). Examples: `examples/checkout.ir.json` (clean; the flow behind the packet example in the brief), `examples/leave-request.draft.ir.json` (draft with 8 gaps), `examples/invalid/checkout-broken.ir.json` (5 errors).

The JSON Schema is exported at `@vibestudio/ir/schema` for use as a structured-output schema. It uses `oneOf` + `discriminator` (an OpenAPI keyword that Ajv honours for clean errors; standard validators ignore it and still get the right answer from `oneOf`) and has no external `$ref`s (data-object schemas are typed as plain objects and validated/compiled by the validator instead). Providers with a restricted structured-output dialect (e.g. OpenAI strict mode: `anyOf` only, all properties required, no `propertyNames`/`uniqueItems`/`pattern`) will need a derived profile — see open question 5.

## 5. What the next items get from this

Item 3 (BPMN transformer): a 1:1 mapping — lanes → `laneSet`, node types → BPMN elements of the same name, `direction` → converging/diverging, `condition` → `conditionExpression`, `is_default` → `default`, `boundaryEvent.attached_to` → `attachedToRef`, `data_objects` → `dataObjectReference` with associations from `reads`/`writes`. Because tasks are 1-in/1-out and blocks are well-nested, layout has no ambiguous cases to resolve — `@vibestudio/bpmn` ships its own deterministic layered layout (longest-path layering, lane bands, loop edges routed below the lanes), after probing showed `bpmn-auto-layout` drops lane shapes entirely.

Item 4 (spec kit): `spec.md` sections come from tasks + `acceptance_criteria`; `contracts/` gets one file per edge from `data_contract` + the referenced data-object schemas; `plan.md` gets `integration`s and NFRs; `constitution.md` gets `process.goal` and lane kinds.

Item 6 (orchestrator): `topologicalOrder()` (Kahn over the SCC DAG; loop members in merge→body→exit order) is exported for build order; a node's input contracts are its incoming edges' `carries` (∩ at XOR merges), output contracts its outgoing edges'; `availableData()`/`incomingData()` and `nearestWorkAncestors()`/`nearestWorkDescendants()` (looking through gateways) are exported so the packet builder can fill `contracts.inputs[].from` / `outputs[].to` with tasks rather than gateways.

## 6. Open questions for review

1. Should `data.schema-missing` block in final mode (currently a warning)? Blocking forces the model to invent schemas the user then reviews; not blocking risks weak `contracts/`.
2. Do we want a `pools`/message-flow layer in v1.1 for multi-organisation processes, or keep external parties as lanes?
3. Should intake use a third, looser mode (`sketch`) where cardinality/reachability are downgraded to warnings so a partial graph can be shown before the first clarifying round? Today `draft` still enforces graph well-formedness.
4. Expression language for conditions: `natural` today; `cel` or `javascript` when the dev plan needs executable routing — decide before item 6. Related: gateways and events are not units of work, so routing logic needs an owner in the dev plan (proposal: the orchestrator generates routing from conditions; tasks never route).
5. Structured-output profile: derive a provider-specific schema (e.g. OpenAI strict: `anyOf`, all-required/nullable, no `propertyNames`/`uniqueItems`/`pattern`) from the canonical schema with a small script, and validate model output with the canonical one. Anthropic tool schemas accept the canonical schema as is (unknown keywords are ignored).
6. `endEvent` with `result.kind = "error"` inside a parallel block is currently a leak (engine-dependent whether an error end terminates the instance); `terminate` is the sanctioned way to abort a block. Confirm.

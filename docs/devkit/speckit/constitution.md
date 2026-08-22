# VibeStudio — development constitution

The non-negotiables. Every packet in `../graph-plan.md` and every future change is judged against these.

## 1. One source of truth
Everything downstream — diagram, spec kit, graph plan, notes, cover page — is **generated from the Process IR**, never authored independently. If two artifacts disagree, the generator is wrong, not the artifacts. Nothing hand-edits generated output except the builder's `[TO FILL]` markers in the notes, whose banner explicitly says so.

## 2. Determinism
Same input → byte-identical output, on any machine: code-unit string comparison (never `localeCompare`), numeric path segments compared numerically, no clocks, no randomness, no object-key-order dependence. Every generator ships a determinism test. This is what makes "retry the model against identical feedback" meaningful.

## 3. The validator judges; the model drafts; the person decides
Severity semantics are product semantics: `error` = the model must fix it (self-correction loop); `warning` = surfaced, non-blocking; `gap` = a question **only the person may answer — the model must never guess**. Skipped questions become provenance-`assumed` entries surfaced for review at Confirm, never silent guesses. Draft vs final mode is the same rule set with different severities, so intake and pre-render are one mechanism.

## 4. Libraries are browser-safe; only the CLI touches the filesystem
No `node:fs` (or any Node-only API) outside `packages/ir/src/cli.ts`. The canonical JSON Schema ships as a generated TS module kept in sync by a test.

## 5. No credential ever reaches the client
Model calls go through the app's own proxy (`/api/openrouter`); the key lives server-side in `.env.local`, deliberately not `VITE_`-prefixed. There is no key UI. Swapping providers or keys must never require touching client code.

## 6. Small-model resilience is a design constraint, not an aspiration
The pipeline must work with free/small models: primary→fallback model rotation, tolerant JSON extraction, validator-driven fix rounds, and work packets + documentation duties sized so a ~27B model with a 32k window never needs more than one packet in context.

## 7. Newbie-first UX
One question at a time; no JSON, no jargon in the main path; errors are human sentences; everything the AI assumed is called out for review. The brand is a `>` with a blinking `_` in matrix dark green — the site itself is light and friendly, not a terminal.

## 8. Licenses are constraints
bpmn-js's license requires a visible watermark when embedded — so we don't embed it: diagrams are rendered by our own SVG renderer over our own layout. The exported `.bpmn` keeps interoperability with BPMN tools.

## 9. Generated text is injection-hardened
Any IR free text can contain markdown/XML-significant characters. All interpolation goes through the hardened helpers (`oneLine`, `cell`, `inlineCode`, `escapeXml`); adversarial tests are part of the definition of done.

## 10. Adversarial review is part of the build
Correctness claims are earned by loops, not assertions: regression-test-first fixes, and judge lenses (an owner who can't read code; a literal small-model harness) that must pass before a document-producing feature ships. See `../graph-plan.md` § Methodology loops.

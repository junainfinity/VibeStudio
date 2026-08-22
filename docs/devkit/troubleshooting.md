# VibeStudio — where to look when something goes wrong

Symptom → exact file/function. Written like the troubleshooting notes VibeStudio ships in its bundles, but with every pointer already filled in.

## Quick map

| What you're seeing | Where to look | Details |
| --- | --- | --- |
| Something is broken, not sure where | start at Triage | just below |
| Wizard stuck on "Building/Updating your process" | `apps/web/src/lib/agent.ts` | § Agent |
| "The AI's reply wasn't a valid document" | `agent.ts` → `extractJson` | § Agent |
| "The app's AI key was rejected" | `apps/web/.env.local` + `vite.config.ts` | § Keys & proxy |
| "The free AI model hit its speed limit" | normal free-tier 429 | § Agent |
| Questions are odd, missing, or too many | `packages/ir/src/feedback.ts` + `rules/catalog.ts` | § Validator |
| A valid-looking process is rejected (or a broken one accepted) | `packages/ir/src/rules/` | § Validator |
| Diagram looks wrong (overlaps, crossings, missing labels) | `packages/bpmn/src/layout.ts` / `apps/web/src/lib/diagramSvg.ts` | § Diagram |
| Exported `.bpmn` won't open in Camunda/other tools | `packages/bpmn/src/semantic.ts` / `xml.ts` | § Diagram |
| Bundle missing files, or notes markers look wrong | `apps/web/src/lib/bundle.ts` / `packages/speckit/src/notes.ts` | § Bundle |
| Generated markdown broken by a weird process name | `packages/speckit/src/markdown.ts` | § Bundle |
| Code changes not showing in the browser | vite dep-optimizer cache | § Dev environment |
| `node: command not found` (this machine) | PATH | § Dev environment |
| A test fails after editing the JSON Schema | `npm run gen-schema` | § Dev environment |

## Triage: broken but you don't know where

Walk the pipeline in order; the first check that fails names the culprit:

1. **Validator** — `cd packages/ir && npx tsx src/cli.ts validate examples/checkout.ir.json` → must print `PASSED … 0 gaps`.
2. **Libraries** — `npm test` at the root → 104 + 36 + 86 must pass.
3. **Proxy & key** — with the dev server running: `curl -s localhost:5173/api/openrouter/models | head -c 200` → JSON, not an auth error.
4. **Agent loop** — describe a tiny process in the wizard; the working screen must show real stages ("drafting…", "checking against 40 rules"). Stuck with no stage change ≫ 3 min → § Agent.
5. **Bundle** — reach Download; the file table must list `notes/troubleshooting.md` and `notes/codebase.md`.

## Agent (`apps/web/src/lib/agent.ts`)

- **Stuck on the working screen:** each model call has a 180 s abort (`CALL_TIMEOUT_MS` in `callOnce`). Free models legitimately take minutes; up to ~4 calls per phase (draft + 3 fix rounds), each possibly retried once on the fallback model (`callModel`). True hangs beyond ~15 min mean the promise chain lost its run token — check `runAgent` in `App.tsx` (`runToken` guard).
- **"wasn't a valid document":** `extractJson` strips fences and takes the outermost `{…}`. If a model chronically fails here, log the raw `content` in `callOnce` and tighten `ANALYST_SYSTEM`'s "JSON only" clause in `prompts.ts` — do not weaken `extractJson` to guess harder.
- **429s / "speed limit":** `callOnce` maps 429 → `AgentError("rate")`; `callModel` already retried the fallback. Persistent 429 on both models = the key's free-tier allowance; swap the key in `.env.local` or use paid model ids in `MODELS`.
- **"couldn't produce a sound process after several tries":** the validator found draft-mode errors after `MAX_FIX_ROUNDS`. Reproduce headlessly: validate the saved IR with the CLI and read `formatFeedback`'s output — usually a schema-shaped failure the model repeats; improve the matching rule's `fix` text in `packages/ir/src/rules/`.

## Keys & proxy (`apps/web/vite.config.ts`, `apps/web/.env.local`)

- The browser calls `/api/openrouter/*`; the vite server injects `Authorization` from `OPENROUTER_API_KEY`. 401/403 in the network tab = wrong/revoked key **on the server side** — the client never has one.
- Changed `.env.local`? Restart the dev server — the proxy reads env at config time (`loadEnv` in `vite.config.ts`).
- Key visible in the client bundle would mean someone renamed it with a `VITE_` prefix. It must stay unprefixed.

## Validator & questions (`packages/ir`)

- **Question text** comes from each rule's `question` field (`src/rules/*.ts`) and is themed/deduplicated in `toClarifyingQuestions` (`src/feedback.ts`). Wrong theme → `themeOf` in `feedback.ts`.
- **Too many/few questions:** a rule's per-mode severity in `rules/catalog.ts` decides gap vs error vs warning. `gap` = ask the person. Changing severities changes the wizard's question count directly.
- **False accept/reject:** find the rule id in the report, open its implementation (`structural.ts` / `topology.ts` / `gateways.ts` / `data.ts`), and reproduce with `test/builder.ts` + `test/helpers.ts` mutation helpers. Block/loop soundness lives in `gateways.ts` (`validPairings`, `tokenAccounting`); the adversarial suite is `test/blocks.test.ts`.
- **Nondeterministic reports:** someone introduced a locale-dependent sort. `sortFindings`/`comparePaths` in `src/validate.ts` are the only sanctioned comparators.

## Diagram (`packages/bpmn`, `apps/web/src/lib/diagramSvg.ts`)

- **Geometry problems** (overlap, edge through a node): `computeLayout` in `packages/bpmn/src/layout.ts`. The DI invariant tests in `test/di.test.ts` are the spec — add the failing case there first (`segmentCrossesRect` helper in `test/helpers.ts`).
- **Rendering problems** (labels, markers, colors, wrapping): `diagramSvg.ts` — `nodeSvg` for shapes, `wrap` for label wrapping, edge-label placement in `renderDiagramSvg`.
- **Interchange problems** (tool rejects the file): `semantic.ts` for element/attribute mapping, `xml.ts` for escaping. Round-trip with bpmn-moddle in `test/semantic.test.ts` / `options.test.ts`.
- The exported `.bpmn` and the on-screen SVG share `computeLayout` — if they disagree, the bug is in `diagramSvg.ts`, not the layout.

## Bundle & notes (`apps/web/src/lib/bundle.ts`, `packages/speckit`)

- **File set** (what's in the zip): `buildBundle` — one `add(...)` per file; audience labels feed both the UI table and README.html.
- **Notes scaffolds:** `packages/speckit/src/notes.ts`. The marker grammar `[TO FILL <owner-id>: …]` must stay in lock-step with the builder commands (7a–7d) in `apps/web/src/lib/prompts.ts` → `buildKickoffPrompt`. Change one → change both → rerun `packages/speckit/test/notes.test.ts`.
- **Markdown broken by hostile names:** every interpolation must pass through `oneLine`/`cell`/`inlineCode` (`markdown.ts`). `test/adversarial.test.ts` is the gate.

## Dev environment

- **`node: command not found` (this machine):** Node lives at `~/.local/node/bin` and is not on the default PATH — `export PATH="$HOME/.local/node/bin:$PATH"`. The dev server launcher (`.claude/launch.json`) already wraps this.
- **Library edits not visible in the app:** vite pinned a stale workspace dist. `rm -rf node_modules/.vite apps/web/node_modules/.vite`, rebuild libs (`npm run build:libs`), restart the dev server.
- **`schema-gen.test.ts` fails:** you edited `schema/process-ir.v1.schema.json` without regenerating — `cd packages/ir && npm run gen-schema`.
- **Determinism tests fail:** an unsorted map/set iteration or locale sort crept into a generator. Diff the two runs' outputs; the divergence names the file.

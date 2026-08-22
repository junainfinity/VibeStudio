# VibeStudio Development Kit

This folder documents VibeStudio **the same way VibeStudio documents the systems it generates** — a codebase map, a symptom-driven troubleshooting guide, a spec kit, and a graph plan with loops. Together with its two declared companion inputs it lets an agent (or a person) **recreate the whole repository**: 4 workspaces, 226 tests, the wizard, and the output bundle.

**Required companion inputs** (the kit deliberately does not duplicate them):
- `../process-ir-v1.md` — the IR document shape (§2), the complete 40-rule severity table (§3.1), and the BPMN mapping (§5). P1, P3 and P6 are built from it.
- `../../packages/ir/schema/process-ir.v1.schema.json` and `../../packages/ir/examples/*.ir.json` — the canonical schema (pins every field shape: sensitivity enum, integration object, condition languages, …) and the three fixtures every numeric acceptance criterion refers to. Copy them rather than re-authoring.

## The files

| File | What it is | Read it when |
| --- | --- | --- |
| `codebase.md` | Plain-words map of every module: what it does, its files, how to tell it's working, what's fragile | You're new here, or something needs changing |
| `troubleshooting.md` | Symptom → exact file/function to investigate | Something misbehaves |
| `speckit/constitution.md` | The non-negotiables every change must preserve | Before any design decision |
| `speckit/spec.md` | What each component must do, with its acceptance criteria (the test files) | Before building or modifying a component |
| `speckit/plan.md` | Environment, dependencies, wiring, and the order things get built | Setting up, or starting a rebuild |
| `graph-plan.md` | The build as work packets with input/output contracts, plus every loop (runtime and methodology) with its exit condition | Executing a rebuild packet by packet |

## To recreate this repository

1. Read `speckit/constitution.md` — it constrains every choice below — and the companion inputs above.
2. Set up the environment per `speckit/plan.md` § Environment.
3. Execute `graph-plan.md` packet by packet, in `build_order`. Each packet lists its inputs (what must already exist), outputs (files + exported API), key decisions (the traps we already fell into so you don't), and acceptance criteria (the tests to write — write them as you build, not after).
4. A packet is done when its named tests pass, `npm run typecheck` is clean, and nothing upstream broke.
5. The methodology loops in `graph-plan.md` § Loops are part of the recipe: the adversarial-review loop is how the layout engine, the markdown hardening, and the notes generator reached their current quality. Rebuilding without those loops reproduces the files, not the correctness.

Node ≥ 20 and npm are the only global prerequisites. Everything else is `npm install` from the repo root.

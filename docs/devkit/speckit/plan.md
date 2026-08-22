# VibeStudio — development plan

## Environment
- Node ≥ 20 (repo developed on 24.19.0), npm ≥ 10. On this machine Node lives at `~/.local/node/bin` (not on default PATH).
- No global tools; no backend. macOS/Linux fine.
- Model access for the wizard: an OpenRouter key in `apps/web/.env.local` as `OPENROUTER_API_KEY` (any OpenAI-compatible gateway works — change `ENDPOINT`/`MODELS` in `apps/web/src/lib/agent.ts`).

## Workspace wiring
- Root `package.json`: workspaces `packages/*`, `apps/*`; scripts: `build` (ir → bpmn+speckit → web), `build:libs`, `dev` (build libs, then vite), `test`, `typecheck` (all `--workspaces --if-present`).
- The three library packages: ESM (`"type": "module"`), TS strict, module NodeNext, vitest, `main`/`types` → `dist`, mirrored `tsconfig.build.json`. The web app differs: module Bundler, single `tsconfig.json` (`noEmit`), no vitest and no dist wiring — it is verified in-browser.
- Dependencies (runtime): ir → `ajv`, `ajv-formats`; bpmn → ir only; speckit → ir only; web → ir+bpmn+speckit, `react`, `react-dom`, `jszip`. Dev: `bpmn-moddle` (bpmn tests), `vite`+`@vitejs/plugin-react`, `tsx`, `typescript`, `vitest`, `playwright` (root — drives the in-browser E2E and walkthrough recordings).

## Order of work
Execute `../graph-plan.md` packets P1→P14. Libraries before app; within the app, theme/shell before agent before bundle. Keep `npm run typecheck` green at every packet boundary; write each packet's tests as part of the packet.

## Test strategy
- One mutation test per validator rule id, plus adversarial suites for the hard subsystems (blocks/loops; DI geometry; markdown injection; notes marker discipline).
- Determinism tests everywhere a file is generated.
- The web app is verified in-browser (dev and production builds) — drive all four steps, including failure paths, with the model API mocked; then one live run.

## Methodology (how quality was actually reached)
- Regression-test-first for every confirmed bug.
- Adversarial review loops with role-played lenses (non-technical owner; literal 27B/32k harness; BPMN-spec conformance; docs-accuracy) — findings verified by skeptics before fixing; loop until pass. Detailed in `../graph-plan.md` § Methodology loops.

## Verification (recreation is complete when)
- 226 tests green; typecheck and production build clean.
- CLI on the three examples: clean / 8 gaps / 5 errors.
- Wizard E2E produces a 30-file bundle for the checkout example; `.bpmn` round-trips through bpmn-moddle with zero warnings; no third-party watermark anywhere.

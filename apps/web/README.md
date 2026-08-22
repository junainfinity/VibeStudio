# @vibestudio/web

The VibeStudio wizard — a fully client-side Vite + React app. Describe → Questions → Confirm → Download; see the root README for the flow.

- `lib/agent.ts` — the built-in agent: OpenRouter free models (`z-ai/glm-5.2:free` → `poolside/laguna-s-2.1:free` automatic fallback) called through the app's `/api/openrouter` proxy, so the browser never holds a credential. The system prompt carries the canonical Process IR JSON Schema and demands JSON-only replies; a tolerant extractor parses them and the deterministic validator drives up to 3 self-correction rounds via `formatFeedback`.
- `lib/diagramSvg.ts` — VibeStudio's own SVG renderer over `computeLayout` from `@vibestudio/bpmn` (no embedded viewer, no third-party chrome); also emits the bundle's standalone `diagram.svg`.
- `lib/bundle.ts` — assembles the output folder (README.html cover page, IR, BPMN, SVG, spec kit, graph plan) and zips it.
- API key: `OPENROUTER_API_KEY` in `.env.local`, injected server-side by the vite proxy (`vite.config.ts`). No key UI exists.

```bash
npm run dev        # from the repo root: builds the libs, then starts vite
```

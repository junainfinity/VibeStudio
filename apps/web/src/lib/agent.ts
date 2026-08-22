/**
 * The in-app agent, on a provider-spanning model chain through the app's own
 * backend (the vite server proxies at /api/openrouter and /api/sarvam — the
 * browser never holds a credential, so there is no key screen).
 *
 * These models don't reliably support forced tool calls, so the contract
 * is prompt-level: the system prompt carries the canonical Process IR JSON
 * Schema and demands a JSON-only reply, a tolerant extractor pulls the
 * document out of whatever comes back, and the deterministic validator
 * remains the judge — errors go back verbatim (formatFeedback) for up to
 * MAX_FIX_ROUNDS self-correction rounds. If a model fails (rate limit,
 * outage, a stalled response body, unparseable output) the next model in
 * MODELS takes the call; only an auth failure stops the chain.
 */
import {
  loadSchema,
  toClarifyingQuestions,
  validate,
  type ClarifyingQuestion,
  type ValidationReport
} from "@vibestudio/ir";
import {
  ANALYST_SYSTEM,
  buildFixPrompt,
  buildGeneratePrompt,
  buildUpdatePrompt,
  type AnsweredQuestion
} from "./prompts";

/** Each candidate names its own proxy route, so the chain can span providers. */
export const MODELS = [
  { id: "poolside/laguna-s-2.1:free", endpoint: "/api/openrouter/chat/completions" },
  { id: "sarvam-105b", endpoint: "/api/sarvam/chat/completions" },
  { id: "sarvam-105b-conversations", endpoint: "/api/sarvam/chat/completions" }
] as const;
type Candidate = (typeof MODELS)[number];
// The Sarvam models are reasoning models: reasoning_content is billed against
// the same budget as the answer, so the IR (~7k tokens) needs generous headroom.
const MAX_TOKENS = 16_000;
const MAX_FIX_ROUNDS = 12;
const CALL_TIMEOUT_MS = 180_000;

export interface AgentProgress {
  stage: string;
  round?: number;
}

export interface AgentResult {
  irText: string;
  draftReport: ValidationReport;
  finalReport: ValidationReport;
  questions: ClarifyingQuestion[];
}

/** Errors rephrased for people who have never seen an HTTP status code. */
export class AgentError extends Error {
  readonly kind: "auth" | "rate" | "network" | "model" | "unknown";
  constructor(kind: AgentError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

function systemPrompt(): string {
  return `${ANALYST_SYSTEM.replace("Always answer by calling the emit_process_ir tool with the complete document.", "Always answer with ONLY the complete JSON document — no prose before or after, no markdown fences.")}

The document must conform to this JSON Schema (draft 2020-12):
${JSON.stringify(loadSchema())}`;
}

/** Pull a JSON object out of a model reply that may carry fences or prose. */
export function extractJson(text: string): string {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  const doc = JSON.parse(t.slice(start, end + 1)) as unknown;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

async function callOnce(model: Candidate, userPrompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(model.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: model.id,
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
          messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: userPrompt }
          ]
        })
      });
    } catch {
      throw new AgentError("network", "Couldn't reach the AI. Check your internet connection and try again.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new AgentError("auth", "The app's AI key was rejected. Tell whoever runs this deployment.");
    }
    if (res.status === 429) {
      throw new AgentError("rate", "The AI model hit its rate limit. Wait a moment and try again.");
    }
    if (!res.ok) {
      throw new AgentError("model", `The AI service returned an error (${res.status}). Try again in a moment.`);
    }
    // The body is read inside the abort window too: a free provider that sends
    // 200 headers and then stalls mid-stream would otherwise hang the wizard
    // forever, and the next model in MODELS would never get its turn.
    let data: {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    try {
      data = await res.json();
    } catch {
      throw new AgentError("network", "The AI stopped responding partway through its answer.");
    }
    if (data.error?.message) throw new AgentError("model", `The AI service says: ${data.error.message}`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new AgentError("model", "The AI returned an empty reply. Try again.");
    try {
      return extractJson(content);
    } catch {
      throw new AgentError("model", "The AI's reply wasn't a valid document.");
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Walk the model list in order; on any failure except auth, hand the call to the next one. */
async function callModel(userPrompt: string, onProgress: (p: AgentProgress) => void): Promise<string> {
  let last: AgentError | undefined;
  for (let i = 0; i < MODELS.length; i++) {
    try {
      return await callOnce(MODELS[i]!, userPrompt);
    } catch (err) {
      const e = err instanceof AgentError ? err : new AgentError("unknown", "Something unexpected went wrong.");
      if (e.kind === "auth") throw e;
      last = e;
      if (i + 1 < MODELS.length) {
        onProgress({ stage: i === 0 ? "switching to the backup model" : "switching to the next backup model" });
      }
    }
  }
  throw last ?? new AgentError("unknown", "Something unexpected went wrong.");
}

function assess(irText: string): AgentResult {
  const doc = JSON.parse(irText) as unknown;
  const draftReport = validate(doc, { mode: "draft" });
  const finalReport = validate(doc, { mode: "final" });
  return { irText, draftReport, finalReport, questions: toClarifyingQuestions(draftReport) };
}

async function generateAndCorrect(
  firstPrompt: string,
  firstStage: string,
  onProgress: (p: AgentProgress) => void
): Promise<AgentResult> {
  onProgress({ stage: firstStage });
  let irText = await callModel(firstPrompt, onProgress);

  // The error count does not fall monotonically round to round, so always
  // correct from the best document seen so far rather than the newest one.
  let best: AgentResult | undefined;
  for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
    onProgress({ stage: "checking against 40 rules" });
    const result = assess(irText);
    if (result.draftReport.counts.error === 0) return result;
    if (!best || result.draftReport.counts.error < best.draftReport.counts.error) best = result;
    onProgress({
      stage: `fixing ${best.draftReport.counts.error} issue${best.draftReport.counts.error === 1 ? "" : "s"}`,
      round
    });
    irText = await callModel(buildFixPrompt(best.irText, best.draftReport), onProgress);
  }
  const result = assess(irText);
  if (result.draftReport.counts.error === 0) return result;
  throw new AgentError("model", "The AI couldn't produce a sound process after several tries. Rephrase the description and try again.");
}

export function generateIR(description: string, onProgress: (p: AgentProgress) => void): Promise<AgentResult> {
  return generateAndCorrect(buildGeneratePrompt(description), "drafting your process", onProgress);
}

export function updateIR(
  irText: string,
  finalReport: ValidationReport,
  answered: AnsweredQuestion[],
  skipped: ClarifyingQuestion[],
  feedback: string | undefined,
  onProgress: (p: AgentProgress) => void
): Promise<AgentResult> {
  return generateAndCorrect(
    buildUpdatePrompt(irText, finalReport, answered, skipped, feedback),
    feedback ? "working in your corrections" : "working in your answers",
    onProgress
  );
}

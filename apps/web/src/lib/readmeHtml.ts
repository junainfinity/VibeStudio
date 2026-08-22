/**
 * README.html — the plain-language cover page of the output bundle, written
 * for the person who described the process, not for their tools. It restates
 * what they said, what the system understood (and what it assumed), lists
 * every file in the folder with who it is for, and gives copy-paste
 * instructions for pointing a coding agent at the folder. Standalone HTML:
 * inline CSS, no scripts, no external references, printable.
 */
import type { ProcessIR } from "@vibestudio/ir";
import { buildKickoffPrompt } from "./prompts";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface BundleFileInfo {
  path: string;
  what: string;
  audience: "You" | "Your AI agent" | "BPMN tools";
}

const e = escapeHtml;

function li(items: string[]): string {
  return items.map((x) => `<li>${x}</li>`).join("\n");
}

export function renderReadmeHtml(ir: ProcessIR, description: string, files: BundleFileInfo[]): string {
  const taskCount = ir.nodes.filter((n) => !n.type.endsWith("Gateway") && !n.type.endsWith("Event")).length;
  const decisionCount = ir.nodes.filter((n) => (n.type === "exclusiveGateway" || n.type === "inclusiveGateway") && (n as { direction?: string }).direction === "split").length;
  const assumptions = ir.requirements?.assumptions ?? [];
  const answered = (ir.requirements?.open_questions ?? []).filter((q) => q.answered);

  const actorRows = ir.lanes
    .map((l) => {
      const meaning =
        l.kind === "human" ? "People — their steps need a user interface" : l.kind === "system" ? "Software we build — their steps run automatically" : "An outside party — we integrate with them, we don't build them";
      return `<tr><td><strong>${e(l.name)}</strong></td><td>${e(l.kind)}</td><td>${e(l.description ?? meaning)}</td></tr>`;
    })
    .join("\n");

  const fileRows = files.map((f) => `<tr><td><code>${e(f.path)}</code></td><td>${e(f.what)}</td><td>${e(f.audience)}</td></tr>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(ir.process.name)} — build bundle</title>
<style>
  body { font: 16px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c2733; margin: 0; background: #f6f8fa; }
  main { max-width: 860px; margin: 0 auto; padding: 40px 28px 80px; background: #fff; min-height: 100vh; box-shadow: 0 0 40px rgba(0,0,0,.06); }
  h1 { font-size: 30px; margin: 0 0 4px; }
  .sub { color: #5b6b7b; margin: 0 0 28px; }
  h2 { font-size: 21px; margin: 36px 0 10px; border-bottom: 2px solid #e3e8ee; padding-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
  th, td { border: 1px solid #dde3ea; padding: 8px 12px; text-align: left; vertical-align: top; }
  th { background: #f0f3f7; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; background: #eef1f5; padding: 1px 5px; border-radius: 4px; }
  pre { background: #10151c; color: #dfe6ee; padding: 16px 18px; border-radius: 10px; overflow-x: auto; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
  blockquote { margin: 0; padding: 10px 18px; background: #f0faf2; border-left: 4px solid #00a63e; border-radius: 0 8px 8px 0; }
  .note { background: #f2fbf6; border-left: 4px solid #00a63e; padding: 12px 18px; border-radius: 0 8px 8px 0; }
  .mark { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; color: #00a63e; }
  ol li, ul li { margin-bottom: 6px; }
</style>
</head>
<body>
<main>
  <h1><span class="mark">&gt;_</span> ${e(ir.process.name)}</h1>
  <p class="sub">Made with VibeStudio. Everything in this folder was generated from one validated description of your process. Nothing here was written by hand — and nothing needs to be.</p>

  <h2>What you described</h2>
  ${description.trim() ? `<blockquote>${e(description.trim())}</blockquote>` : ""}
  ${ir.process.goal ? `<p><strong>Goal:</strong> ${e(ir.process.goal)}</p>` : ""}
  <p>Understood as: <strong>${taskCount}</strong> step${taskCount === 1 ? "" : "s"} of work, <strong>${decisionCount}</strong> decision${decisionCount === 1 ? "" : "s"}, <strong>${ir.data_objects.length}</strong> kind${ir.data_objects.length === 1 ? "" : "s"} of data, across <strong>${ir.lanes.length}</strong> actor${ir.lanes.length === 1 ? "" : "s"}.</p>

  <h2>Who does what</h2>
  <table><tr><th>Actor</th><th>Kind</th><th>Meaning</th></tr>
  ${actorRows}
  </table>

  ${assumptions.length > 0 ? `<h2>Assumptions</h2><ul>${li(assumptions.map((a) => `${e(a.statement)} ${a.confirmed ? "<em>(you confirmed this)</em>" : "<em>(not explicitly confirmed — flag it to your agent if wrong)</em>"}`))}</ul>` : ""}
  ${answered.length > 0 ? `<h2>Questions you answered</h2><ul>${li(answered.map((q) => `<strong>${e(q.question)}</strong>${q.answer ? ` — ${e(q.answer)}` : ""}`))}</ul>` : ""}

  <h2>What's in this folder</h2>
  <table><tr><th>File</th><th>What it is</th><th>Who it's for</th></tr>
  ${fileRows}
  </table>

  <h2>How to get it built</h2>
  <ol>
    <li>Keep this folder together (it is self-contained).</li>
    <li>Open your coding agent of choice — Claude Code, Cursor, Copilot, or a local harness.</li>
    <li>Point it at this folder and give it the kick-off prompt below.</li>
    <li>Let it work through the plan one packet at a time; each packet carries its own definition of done.</li>
    <li>As it builds, it must also complete <code>notes/troubleshooting.md</code> and <code>notes/codebase.md</code> — your plain-language map of the finished code and where to look when something misbehaves. If those files still contain "[TO FILL" markers, the build isn't done.</li>
  </ol>
  <p class="note"><strong>You don't need a frontier model.</strong> The plan is cut into small, self-contained work packets with explicit input/output data contracts, so no step ever needs the whole project in context. A harness driving a local ~27B model with a 32k context window can build this packet by packet.</p>

  <h3>Kick-off prompt (copy this to your agent)</h3>
  <pre>${e(buildKickoffPrompt(ir.process.id))}</pre>

  <h2>If something looks wrong</h2>
  <p>The file <code>process.ir.json</code> is the single source of truth — the diagram, specs and plan are all projections of it. To change anything, go back to VibeStudio, adjust the process there, and regenerate the bundle. Editing the generated files by hand forks them from the source and they will disagree with each other.</p>
</main>
</body>
</html>
`;
}

import { useEffect, useMemo, useState } from "react";
import type { ProcessIR } from "@vibestudio/ir";
import { buildBundle, zipBundle, type Bundle } from "../../lib/bundle";
import { downloadBlob, downloadText } from "../../lib/download";
import { buildKickoffPrompt } from "../../lib/prompts";

interface Props {
  ir: ProcessIR;
  irText: string;
  description: string;
  onRestart(): void;
  onBack(): void;
}

const AUDIENCE: Record<string, string> = { You: "for you", "Your AI agent": "for your AI builder", "BPMN tools": "for diagram tools" };

/**
 * The hand-over. One folder, plain-language explanations, and the exact
 * prompt to paste into whatever coding agent will do the building.
 */
export function OutputStep({ ir, irText, description, onRestart, onBack }: Props) {
  const [bundle, setBundle] = useState<Bundle | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [zipping, setZipping] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBundle(undefined);
    setError(undefined);
    buildBundle(ir, irText, description)
      .then((b) => !cancelled && setBundle(b))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [ir, irText, description]);

  const totalKb = useMemo(
    () => (bundle ? Math.max(1, Math.round(bundle.files.reduce((n, f) => n + f.content.length, 0) / 1024)) : 0),
    [bundle]
  );

  if (error) {
    return (
      <div className="working">
        <p className="error-line">{error}</p>
        <button className="btn" onClick={onBack}>← Back</button>
      </div>
    );
  }
  if (!bundle) {
    return (
      <div className="working">
        <h1 className="working-title">Packing your folder…</h1>
        <div className="term">
          <p className="term-line"><span className="term-spinner" /> Generating the diagram, specs, plan and cover page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="confirm">
      <p className="ask-count">Step 4 — done</p>
      <h1 className="ask-question">Your build folder is ready</h1>
      <p className="ask-hint">
        {bundle.files.length} files, ~{totalKb} KB. Everything an AI builder needs to make this real — cut into pieces
        small enough that even a modest local model (a ~27B model with a 32k window) can build it one piece at a time.
      </p>

      <div className="ask-actions download-actions">
        <button
          className="btn primary big"
          disabled={zipping}
          onClick={async () => {
            setZipping(true);
            try {
              downloadBlob(`${bundle.folder}.zip`, await zipBundle(bundle));
            } finally {
              setZipping(false);
            }
          }}
        >
          {zipping ? "Zipping…" : `↓ Download ${bundle.folder}.zip`}
        </button>
        <button
          className="btn"
          onClick={async () => {
            await navigator.clipboard.writeText(buildKickoffPrompt(ir.process.id));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied ✓" : "Copy the builder instructions"}
        </button>
      </div>

      <section className="next-box">
        <p className="next-title">What to do with it</p>
        <ol className="next-steps">
          <li>Unzip it. Open <code>README.html</code> — it explains everything in plain words.</li>
          <li>Open your AI coding tool (Claude Code, Cursor, or a local one) in that folder.</li>
          <li>Paste the builder instructions (button above — they're also inside the README).</li>
          <li>It builds step by step, checking its own work against the plan. You review the result.</li>
        </ol>
      </section>

      <details className="files-details">
        <summary>What's inside ({bundle.files.length} files)</summary>
        <table className="bundle-table">
          <tbody>
            {bundle.files.map((f) => (
              <tr key={f.path}>
                <td className="mono">{f.path}</td>
                <td>{f.info.what}</td>
                <td className="nowrap term-dim">{AUDIENCE[f.info.audience] ?? f.info.audience}</td>
                <td>
                  <button
                    className="btn small"
                    onClick={() =>
                      downloadText(
                        f.path.replace(/\//g, "__"),
                        f.content,
                        f.path.endsWith(".html") ? "text/html" : f.path.endsWith(".json") ? "application/json" : f.path.endsWith(".svg") ? "image/svg+xml" : f.path.endsWith(".bpmn") ? "application/xml" : "text/markdown"
                      )
                    }
                  >
                    ↓
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div className="ask-actions">
        <button className="btn" onClick={onBack}>← Back to the map</button>
        <button className="btn" onClick={onRestart}>Start a new process</button>
      </div>
    </div>
  );
}

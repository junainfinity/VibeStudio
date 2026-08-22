import { useMemo } from "react";
import { isTask, type ProcessIR } from "@vibestudio/ir";
import type { AgentError } from "../../lib/agent";
import { ProcessDiagram } from "../ProcessDiagram";

interface Props {
  ir: ProcessIR;
  warningCount: number;
  error?: AgentError;
  onConfirm(): void;
  onWrong(): void;
}

/**
 * The moment of truth, in plain words: here's the map of what you said —
 * is it right? Anything the AI decided on its own is called out for review.
 */
export function ConfirmStep({ ir, warningCount, error, onConfirm, onWrong }: Props) {
  const digest = useMemo(() => {
    const tasks = ir.nodes.filter(isTask);
    const assumed = [
      ...ir.lanes.filter((l) => l.provenance?.status === "assumed").map((l) => `Who: "${l.name}"`),
      ...ir.nodes.filter((n) => n.provenance?.status === "assumed").map((n) => `Step: "${n.name}"`),
      ...ir.data_objects.filter((d) => d.provenance?.status === "assumed").map((d) => `Data: "${d.name}"`),
      ...(ir.requirements?.assumptions ?? []).filter((a) => !a.confirmed).map((a) => a.statement)
    ];
    return { tasks, assumed };
  }, [ir]);

  return (
    <div className="confirm">
      <p className="ask-count">Step 3 — check the map</p>
      <h1 className="ask-question">Is this your process?</h1>
      <p className="ask-hint">
        Rows are people & systems · boxes are steps · diamonds are decisions. Follow the arrows and check the story.
      </p>
      <div className="confirm-diagram">
        <ProcessDiagram ir={ir} />
      </div>
      <div className="confirm-meta">
        <span className="meta-chip">{digest.tasks.length} steps</span>
        <span className="meta-chip">{ir.lanes.length} people & systems</span>
        <span className="meta-chip">{ir.data_objects.length} kinds of data</span>
        {warningCount > 0 && <span className="meta-chip dim">{warningCount} minor note{warningCount === 1 ? "" : "s"}</span>}
      </div>
      {digest.assumed.length > 0 && (
        <div className="assumed-box">
          <p className="assumed-title">The AI decided these on its own — glance over them:</p>
          <ul>
            {digest.assumed.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="error-line">{error.message}</p>}
      <div className="ask-actions">
        <button className="btn" onClick={onWrong}>Something's off — tell it what</button>
        <button className="btn primary big" onClick={onConfirm}>
          Looks right — make my folder →
        </button>
      </div>
    </div>
  );
}

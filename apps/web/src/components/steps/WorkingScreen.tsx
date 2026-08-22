import type { AgentProgress } from "../../lib/agent";

/**
 * Friendly live progress: a checklist that fills in as the agent works.
 * Every line is a real event from the agent loop (drafting, checking,
 * fixing round N) — no invented percentages, no jargon.
 */
export function WorkingScreen({ title, progress }: { title: string; progress: AgentProgress[] }) {
  const lines = progress.length > 0 ? progress : [{ stage: "getting started" } as AgentProgress];
  return (
    <div className="working">
      <h1 className="working-title">{title}…</h1>
      <div className="term" role="status" aria-live="polite">
        {lines.map((p, i) => {
          const current = i === lines.length - 1;
          return (
            <p key={i} className="term-line">
              {current ? <span className="term-spinner" /> : <span className="term-ok">✓</span>}
              <span>
                {capitalize(p.stage)}
                {p.round ? <span className="term-dim"> · round {p.round}</span> : null}
              </span>
            </p>
          );
        })}
      </div>
      <p className="working-hint">Usually under a minute. It writes the process, then checks its own work against 40 rules.</p>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

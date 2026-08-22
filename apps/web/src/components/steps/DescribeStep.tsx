import type { AgentError } from "../../lib/agent";

interface Props {
  description: string;
  onDescription(v: string): void;
  onBuild(): void;
  error?: AgentError;
}

/**
 * The opening screen: one big question, one box, one button. Everything else
 * — questions, checking, fixing — happens after, one screen at a time.
 */
export function DescribeStep({ description, onDescription, onBuild, error }: Props) {
  const ready = description.trim().length >= 20;
  return (
    <div className="ask">
      <p className="ask-count">Step 1 — just talk</p>
      <h1 className="ask-question">What should we build?</h1>
      <p className="ask-hint">
        Describe the process in your own words, like you'd explain it to a colleague. Who does what, what gets decided,
        what can go wrong. Don't worry about being complete — anything missing becomes a question, not a guess.
      </p>
      <textarea
        className="ask-input tall"
        rows={6}
        autoFocus
        placeholder="Customers order on our site. We check stock, take payment — retrying once if the card is declined — then pack and ship, and email the tracking number…"
        value={description}
        onChange={(e) => onDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) onBuild();
        }}
      />
      {error && <p className="error-line">{error.message}</p>}
      <div className="ask-actions">
        <span className="ask-keys">{ready ? "⌘↵ works too" : "a few more words…"}</span>
        <button className="btn primary big" disabled={!ready} onClick={onBuild}>
          Build it →
        </button>
      </div>
    </div>
  );
}

export type RailStep = "describe" | "questions" | "confirm" | "download";

const STEPS: { id: RailStep; label: string }[] = [
  { id: "describe", label: "describe" },
  { id: "questions", label: "questions" },
  { id: "confirm", label: "confirm" },
  { id: "download", label: "download" }
];

/** Read-only progress rail; navigation happens through each screen's own buttons. */
export function WizardSteps({ current }: { current: RailStep }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <nav className="rail" aria-label="Progress">
      {STEPS.map((s, i) => (
        <span key={s.id} className={`rail-step ${i < idx ? "done" : i === idx ? "current" : ""}`}>
          <span className="rail-mark">{i < idx ? "✓" : `0${i + 1}`}</span>
          {s.label}
        </span>
      ))}
    </nav>
  );
}

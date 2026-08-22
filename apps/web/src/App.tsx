import { useCallback, useMemo, useRef, useState } from "react";
import { validate, type ClarifyingQuestion, type ProcessIR, type ValidationReport } from "@vibestudio/ir";
import { generateIR, updateIR, type AgentProgress, type AgentResult, AgentError } from "./lib/agent";
import type { AnsweredQuestion } from "./lib/prompts";
import { WizardSteps, type RailStep } from "./components/WizardSteps";
import { ClarifyStep } from "./components/steps/ClarifyStep";
import { ConfirmStep } from "./components/steps/ConfirmStep";
import { DescribeStep } from "./components/steps/DescribeStep";
import { OutputStep } from "./components/steps/OutputStep";
import { WorkingScreen } from "./components/steps/WorkingScreen";

/**
 * The wizard's phases. "building"/"updating" are full-screen working states
 * (the agent is running); the rail shows the four human-facing steps.
 */
type Phase = "describe" | "building" | "clarify" | "updating" | "confirm" | "feedback" | "output";

const RAIL: Record<Phase, RailStep> = {
  describe: "describe",
  building: "describe",
  clarify: "questions",
  updating: "questions",
  confirm: "confirm",
  feedback: "confirm",
  output: "download"
};

export function App() {
  const [phase, setPhase] = useState<Phase>("describe");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<AgentResult | undefined>();
  const [progress, setProgress] = useState<AgentProgress[]>([]);
  const [error, setError] = useState<AgentError | undefined>();
  /** Questions asked in the current clarify round (frozen so answering doesn't reshuffle). */
  const [roundQuestions, setRoundQuestions] = useState<ClarifyingQuestion[]>([]);
  const runToken = useRef(0);

  const ir: ProcessIR | undefined = useMemo(() => {
    if (!result || !result.finalReport.ok) return undefined;
    return JSON.parse(result.irText) as ProcessIR;
  }, [result]);

  const pushProgress = useCallback((p: AgentProgress) => {
    setProgress((prev) => [...prev, p]);
  }, []);

  const runAgent = useCallback(
    async (work: () => Promise<AgentResult>, workingPhase: "building" | "updating", donePhase: (r: AgentResult) => Phase) => {
      const token = ++runToken.current;
      setError(undefined);
      setProgress([]);
      setPhase(workingPhase);
      try {
        const r = await work();
        if (runToken.current !== token) return;
        setResult(r);
        setPhase(donePhase(r));
      } catch (err) {
        if (runToken.current !== token) return;
        const e = err instanceof AgentError ? err : new AgentError("unknown", "Something unexpected went wrong. Try again.");
        setError(e);
        setPhase(workingPhase === "building" ? "describe" : result ? "confirm" : "describe");
      }
    },
    [result]
  );

  const build = useCallback(() => {
    void runAgent(
      () => generateIR(description, pushProgress),
      "building",
      (r) => {
        if (r.questions.length > 0) {
          setRoundQuestions(r.questions);
          return "clarify";
        }
        return r.finalReport.ok ? "confirm" : "clarify"; // no questions but final errors → answers round resolves them
      }
    );
  }, [runAgent, description, pushProgress]);

  const submitAnswers = useCallback(
    (answers: Record<string, string>) => {
      if (!result) return;
      const answered: AnsweredQuestion[] = roundQuestions
        .map((q) => ({ question: q, answer: answers[q.path] ?? "" }))
        .filter((a) => a.answer.trim().length > 0);
      const skipped = roundQuestions.filter((q) => !(answers[q.path] ?? "").trim());
      void runAgent(
        () => updateIR(result.irText, result.finalReport, answered, skipped, undefined, pushProgress),
        "updating",
        (r) => (r.finalReport.ok ? "confirm" : "confirm") // remaining warnings surface on confirm; hard failure throws
      );
    },
    [runAgent, result, roundQuestions, pushProgress]
  );

  const submitFeedback = useCallback(
    (feedback: string) => {
      if (!result) return;
      void runAgent(
        () => updateIR(result.irText, result.finalReport, [], [], feedback, pushProgress),
        "updating",
        (r) => {
          if (r.questions.length > 0 && !r.finalReport.ok) {
            setRoundQuestions(r.questions);
            return "clarify";
          }
          return "confirm";
        }
      );
    },
    [runAgent, result, pushProgress]
  );

  const restart = useCallback(() => {
    runToken.current++;
    setPhase("describe");
    setDescription("");
    setResult(undefined);
    setProgress([]);
    setError(undefined);
    setRoundQuestions([]);
  }, []);

  // Confirm is only reachable with a structurally sound document; if the update
  // could not fully resolve final-mode errors, fall back to showing confirm with
  // what we have (assumed resolutions are requested in the prompt), else block.
  const confirmReady = !!ir;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={restart} title="Start over">
          <span className="brand-glyph">
            &gt;<span className="blink">_</span>
          </span>
          <span className="brand-name">VibeStudio</span>
        </button>
        <WizardSteps current={RAIL[phase]} />
      </header>

      <main className="stage">
        {phase === "describe" && (
          <DescribeStep description={description} onDescription={setDescription} onBuild={build} error={error} />
        )}
        {(phase === "building" || phase === "updating") && (
          <WorkingScreen
            title={phase === "building" ? "Building your process" : "Updating your process"}
            progress={progress}
          />
        )}
        {phase === "clarify" && result && (
          <ClarifyStep questions={roundQuestions} onDone={submitAnswers} />
        )}
        {phase === "confirm" && result && (
          confirmReady && ir ? (
            <ConfirmStep
              ir={ir}
              warningCount={result.finalReport.counts.warning}
              error={error}
              onConfirm={() => setPhase("output")}
              onWrong={() => setPhase("feedback")}
            />
          ) : (
            <div className="working">
              <p className="error-line">The document still has unresolved problems.</p>
              <button className="btn primary big" onClick={restart}>Start over</button>
            </div>
          )
        )}
        {phase === "feedback" && result && (
          <FeedbackScreen onSubmit={submitFeedback} onBack={() => setPhase("confirm")} />
        )}
        {phase === "output" && ir && result && (
          <OutputStep ir={ir} irText={result.irText} description={description} onRestart={restart} onBack={() => setPhase("confirm")} />
        )}
      </main>

    </div>
  );
}

/** Typeform-style single question: what's wrong with the diagram? */
function FeedbackScreen({ onSubmit, onBack }: { onSubmit(feedback: string): void; onBack(): void }) {
  const [text, setText] = useState("");
  return (
    <div className="ask">
      <p className="ask-count">One thing to tell it</p>
      <h1 className="ask-question">What should be different?</h1>
      <p className="ask-hint">Plain words are fine — "the refund check should come before shipping", "there's also a warehouse team involved".</p>
      <textarea
        className="ask-input tall"
        rows={4}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) onSubmit(text);
        }}
      />
      <div className="ask-actions">
        <button className="btn" onClick={onBack}>← Back to the diagram</button>
        <button className="btn primary" disabled={!text.trim()} onClick={() => onSubmit(text)}>
          Fix it ↵
        </button>
      </div>
    </div>
  );
}

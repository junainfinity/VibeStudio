import { useCallback, useEffect, useRef, useState } from "react";
import type { ClarifyingQuestion } from "@vibestudio/ir";

interface Props {
  questions: ClarifyingQuestion[];
  onDone(answers: Record<string, string>): void;
}

const THEME_LABEL: Record<string, string> = {
  process: "about the process",
  tasks: "about a step",
  decisions: "about a decision",
  data: "about the data",
  integrations: "about a system",
  assumptions: "checking a guess",
  other: "one more thing"
};

/**
 * One question at a time, full screen, big type — so a stack of eight
 * questions feels like a conversation, not a form. Enter advances, Skip is
 * always allowed (skipped questions are resolved as reviewable assumptions),
 * and the last OK hands every answer to the agent in one update round.
 */
export function ClarifyStep({ questions, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const q = questions[Math.min(index, questions.length - 1)]!;
  const value = answers[q.path] ?? "";
  const last = index === questions.length - 1;

  const advance = useCallback(() => {
    if (leaving) return; // ignore double-taps during the transition
    if (last) {
      onDone(answers);
      return;
    }
    setLeaving(true);
    setTimeout(() => {
      setIndex((i) => i + 1);
      setLeaving(false);
    }, 160);
  }, [leaving, last, answers, onDone]);

  const back = useCallback(() => {
    if (leaving || index === 0) return;
    setLeaving(true);
    setTimeout(() => {
      setIndex((i) => i - 1);
      setLeaving(false);
    }, 160);
  }, [leaving, index]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [leaving, index]);

  return (
    <div className={`ask ${leaving ? "leaving" : "entering"}`}>
      <div className="ask-progress">
        <div className="ask-progress-fill" style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
      </div>
      <p className="ask-count">
        Question {index + 1} of {questions.length} <span className="term-dim">· {THEME_LABEL[q.theme] ?? q.theme}</span>
      </p>
      <h1 className="ask-question">{q.question}</h1>
      <textarea
        ref={inputRef}
        className="ask-input"
        rows={2}
        placeholder="Type your answer…"
        value={value}
        onChange={(e) => setAnswers((prev) => ({ ...prev, [q.path]: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            advance();
          }
        }}
      />
      <div className="ask-actions">
        <div className="ask-nav">
          {index > 0 && (
            <button className="btn small" onClick={back} title="Previous question">
              ↑
            </button>
          )}
          {!last && (
            <button className="btn small" onClick={advance} title="Next question">
              ↓
            </button>
          )}
        </div>
        <span className="ask-keys">↵ to continue{value.trim() ? "" : " · blank = let it decide, you review later"}</span>
        <button className="btn primary" onClick={advance}>
          {last ? (value.trim() ? "Done — update it →" : "Skip & finish →") : value.trim() ? "OK ↵" : "Skip ↵"}
        </button>
      </div>
    </div>
  );
}

/**
 * Rule catalogue: ids, per-mode severities, and one-line descriptions.
 *
 * Modes:
 *  - draft: the IR is being extracted during intake/clarification. Missing detail
 *           becomes a `gap` (a clarifying question) instead of an error.
 *  - final: the IR is about to be rendered (BPMN + spec kit) and confirmed.
 *           `error` blocks; `warning` is shown but does not block.
 *
 * Severity semantics:
 *  - error   → must be fixed by the generating model (self-correction loop) before the user sees output
 *  - warning → surfaced to the model/user, non-blocking
 *  - gap     → a question for the user (clarifying loop); the model must not guess
 *  - off     → rule not evaluated in this mode
 */
export type Severity = "error" | "warning" | "gap";
export type Mode = "draft" | "final";
export type ModeSeverity = Severity | "off";

export interface RuleDef {
  id: RuleId;
  title: string;
  severity: Record<Mode, ModeSeverity>;
  /** Which brief-level requirement this rule implements (for traceability). */
  covers?: string;
}

export const RULE_IDS = [
  // structural
  "schema.invalid",
  "id.duplicate",
  "ref.unknown",
  // topology / cardinality
  "graph.no-start-or-end",
  "graph.orphan",
  "card.mismatch",
  "graph.unreachable",
  "graph.no-path-to-end",
  "edge.self-loop",
  "edge.duplicate",
  // gateways & loops
  "gw.condition-missing",
  "gw.condition-misplaced",
  "gw.default-multiple",
  "gw.default-missing",
  "gw.default-implicit",
  "gw.default-conditional",
  "gw.condition-unbound",
  "gw.pairing-required",
  "gw.pairing-invalid",
  "gw.join-missing",
  "gw.region-leak",
  "loop.no-exit",
  // edges & data
  "edge.contract-empty",
  "data.not-available",
  "data.read-unavailable",
  "data.unused",
  "data.schema-missing",
  "data.schema-invalid",
  // tasks, lanes, events
  "task.criteria-missing",
  "task.criteria-duplicate-id",
  "task.integration-missing",
  "task.lane-human-required",
  "task.lane-kind-suspicious",
  "lane.unused",
  "boundary.host-invalid",
  "boundary.lane-mismatch",
  "event.trigger-kind",
  // provenance & questions
  "provenance.assumed",
  "assumption.unconfirmed",
  "question.open"
] as const;

export type RuleId = (typeof RULE_IDS)[number];

const both = (s: ModeSeverity): Record<Mode, ModeSeverity> => ({ draft: s, final: s });
const modes = (draft: ModeSeverity, final: ModeSeverity): Record<Mode, ModeSeverity> => ({ draft, final });

export const RULES: Record<RuleId, RuleDef> = {
  "schema.invalid": { id: "schema.invalid", title: "Document violates the Process IR JSON Schema", severity: both("error") },
  "id.duplicate": { id: "id.duplicate", title: "Identifier reused across the document", severity: both("error") },
  "ref.unknown": { id: "ref.unknown", title: "Reference to a non-existent element", severity: both("error") },

  "graph.no-start-or-end": { id: "graph.no-start-or-end", title: "Process needs at least one start and one end event", severity: both("error"), covers: "every path reaches an end event" },
  "graph.orphan": { id: "graph.orphan", title: "Node has no incoming or outgoing flow", severity: both("error"), covers: "no orphan nodes" },
  "card.mismatch": { id: "card.mismatch", title: "In/out-degree does not match node kind", severity: both("error"), covers: "no orphan nodes; gateway split/join shape" },
  "graph.unreachable": { id: "graph.unreachable", title: "Node not reachable from any start event", severity: both("error"), covers: "no orphan nodes" },
  "graph.no-path-to-end": { id: "graph.no-path-to-end", title: "Node cannot reach any end event", severity: both("error"), covers: "every path reaches an end event" },
  "edge.self-loop": { id: "edge.self-loop", title: "Edge from a node to itself", severity: both("error") },
  "edge.duplicate": { id: "edge.duplicate", title: "Two edges with the same source and target", severity: both("error") },

  "gw.condition-missing": { id: "gw.condition-missing", title: "Branch of an exclusive/inclusive split has no condition and is not the default", severity: modes("gap", "error"), covers: "gateway semantics" },
  "gw.condition-misplaced": { id: "gw.condition-misplaced", title: "Condition/default on an edge that does not leave an exclusive/inclusive split", severity: both("error"), covers: "gateway semantics" },
  "gw.default-multiple": { id: "gw.default-multiple", title: "More than one default flow out of a split", severity: both("error"), covers: "gateway semantics" },
  "gw.default-missing": { id: "gw.default-missing", title: "Exclusive/inclusive split has no default flow (deadlocks if no condition matches)", severity: modes("off", "warning"), covers: "gateway semantics" },
  "gw.default-implicit": { id: "gw.default-implicit", title: "Exactly one unconditioned branch and no default: mark it is_default", severity: both("error"), covers: "gateway semantics" },
  "gw.default-conditional": { id: "gw.default-conditional", title: "Default flow must not carry a condition", severity: both("error"), covers: "gateway semantics" },
  "gw.condition-unbound": { id: "gw.condition-unbound", title: "Formal condition references data not carried into the split", severity: both("warning"), covers: "gateway semantics" },
  "gw.pairing-required": { id: "gw.pairing-required", title: "Parallel/inclusive join must declare the split it closes", severity: both("error"), covers: "gateways have matching splits/joins" },
  "gw.pairing-invalid": { id: "gw.pairing-invalid", title: "pairs_with does not point to a split of the same type, or the split is claimed twice", severity: both("error"), covers: "gateways have matching splits/joins" },
  "gw.join-missing": { id: "gw.join-missing", title: "Parallel/inclusive split has no matching join", severity: both("error"), covers: "gateways have matching splits/joins" },
  "gw.region-leak": { id: "gw.region-leak", title: "Split/join region is not well-formed (branch escapes, re-enters, or join has outside predecessor)", severity: both("error"), covers: "gateways have matching splits/joins" },
  "loop.no-exit": { id: "loop.no-exit", title: "Cycle has no conditional exit through an exclusive/inclusive split", severity: both("error"), covers: "every path reaches an end event" },

  "edge.contract-empty": { id: "edge.contract-empty", title: "Edge carries no data", severity: modes("gap", "warning"), covers: "every edge has a data contract" },
  "data.not-available": { id: "data.not-available", title: "Edge carries data the source node neither writes nor receives", severity: both("error"), covers: "every edge has a data contract" },
  "data.read-unavailable": { id: "data.read-unavailable", title: "Node reads data that does not arrive on its incoming edge(s)", severity: both("error"), covers: "every edge has a data contract" },
  "data.unused": { id: "data.unused", title: "Data object is never carried, read or written", severity: both("warning") },
  "data.schema-missing": { id: "data.schema-missing", title: "Data object has no JSON schema", severity: modes("gap", "warning") },
  "data.schema-invalid": { id: "data.schema-invalid", title: "Data object schema does not compile as JSON Schema 2020-12", severity: both("error") },

  "task.criteria-missing": { id: "task.criteria-missing", title: "Task has no acceptance criteria", severity: modes("gap", "error") },
  "task.criteria-duplicate-id": { id: "task.criteria-duplicate-id", title: "Acceptance criterion ids repeat within a task", severity: both("error") },
  "task.integration-missing": { id: "task.integration-missing", title: "Service/send/receive task does not say which system it talks to", severity: modes("gap", "warning") },
  "task.lane-human-required": { id: "task.lane-human-required", title: "User/manual task placed in a non-human lane", severity: both("error") },
  "task.lane-kind-suspicious": { id: "task.lane-kind-suspicious", title: "Automated task placed in a human lane", severity: both("warning") },
  "lane.unused": { id: "lane.unused", title: "Lane contains no nodes", severity: both("warning") },
  "boundary.host-invalid": { id: "boundary.host-invalid", title: "Boundary event is not attached to a task", severity: both("error") },
  "boundary.lane-mismatch": { id: "boundary.lane-mismatch", title: "Boundary event is in a different lane than its host task", severity: both("warning") },
  "event.trigger-kind": { id: "event.trigger-kind", title: "Trigger kind not allowed for this event type", severity: both("error") },

  "provenance.assumed": { id: "provenance.assumed", title: "Element was assumed rather than stated by the user", severity: modes("gap", "warning") },
  "assumption.unconfirmed": { id: "assumption.unconfirmed", title: "Recorded assumption has not been confirmed by the user", severity: modes("gap", "warning") },
  "question.open": { id: "question.open", title: "Open question not yet answered", severity: modes("gap", "warning") }
};

export interface ElementRef {
  kind: "process" | "lane" | "data_object" | "node" | "edge" | "nfr" | "assumption" | "question";
  id: string;
}

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** One sentence describing the defect, naming the element. */
  message: string;
  /** JSON pointer into the IR document (best effort), e.g. "/nodes/3". */
  path: string;
  element?: ElementRef;
  /** Concrete instruction for the generating model. */
  fix?: string;
  /** For gaps: the question to ask the user. */
  question?: string;
  /** Extra machine-readable context (ids involved, etc.). */
  data?: Record<string, unknown>;
}

/** What a rule implementation emits; severity is assigned by the runner per mode. */
export type RawFinding = Omit<Finding, "severity">;

export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, gap: 2 };

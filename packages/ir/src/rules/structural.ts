/**
 * Structural rules: identifiers, references, per-type field semantics that
 * JSON Schema cannot express, lanes, data objects, provenance, open questions.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { isGateway, isTask } from "../types.js";
import type { ElementRef, RawFinding } from "./catalog.js";
import { describeNode, nodePath, nodeRef, type RuleFn } from "./context.js";

const AUTOMATED_TASKS = new Set(["serviceTask", "scriptTask", "businessRuleTask"]);
const INTEGRATION_TASKS = new Set(["serviceTask", "sendTask", "receiveTask"]);

const ALLOWED_TRIGGERS: Record<string, Set<string>> = {
  startEvent: new Set(["none", "message", "timer", "signal"]),
  intermediateCatchEvent: new Set(["message", "timer", "signal"]),
  boundaryEvent: new Set(["error", "timer", "message", "signal"])
};

export const idDuplicate: RuleFn = ({ ir }) => {
  const seen = new Map<string, string>(); // id -> first location description
  const out: RawFinding[] = [];
  const check = (id: unknown, path: string, kind: string) => {
    if (typeof id !== "string") return;
    const first = seen.get(id);
    if (first) {
      out.push({
        rule: "id.duplicate",
        message: `Id '${id}' is used twice (${first} and ${kind} at ${path}). All ids share one namespace.`,
        path,
        fix: `Rename the ${kind} at ${path} to a unique kebab-case id (e.g. '${id}-2').`
      });
    } else {
      seen.set(id, `${kind} at ${path}`);
    }
  };
  check(ir.process?.id, "/process", "process");
  ir.lanes?.forEach((l, i) => check(l.id, `/lanes/${i}`, "lane"));
  ir.data_objects?.forEach((d, i) => check(d.id, `/data_objects/${i}`, "data object"));
  ir.nodes?.forEach((n, i) => check(n.id, `/nodes/${i}`, "node"));
  ir.edges?.forEach((e, i) => check(e.id, `/edges/${i}`, "edge"));
  ir.requirements?.non_functional?.forEach((r, i) => check(r.id, `/requirements/non_functional/${i}`, "NFR"));
  ir.requirements?.assumptions?.forEach((r, i) => check(r.id, `/requirements/assumptions/${i}`, "assumption"));
  ir.requirements?.open_questions?.forEach((r, i) => check(r.id, `/requirements/open_questions/${i}`, "open question"));
  return out;
};

export const refUnknown: RuleFn = ({ ir }) => {
  const out: RawFinding[] = [];
  const laneIds = new Set(ir.lanes.map((l) => l.id));
  const dataIds = new Set(ir.data_objects.map((d) => d.id));
  const nodeIds = new Set(ir.nodes.map((n) => n.id));
  const anyIds = new Set<string>([...laneIds, ...dataIds, ...nodeIds]);

  const bad = (path: string, what: string, id: string, expected: string, fix: string) =>
    out.push({ rule: "ref.unknown", message: `${what} refers to unknown ${expected} '${id}'.`, path, fix, data: { id } });

  ir.nodes.forEach((n, i) => {
    const p = `/nodes/${i}`;
    if (typeof n.lane === "string" && !laneIds.has(n.lane))
      bad(`${p}/lane`, describeNode(n), n.lane, "lane", `Set lane to one of: ${[...laneIds].join(", ")} — or add a lane with id '${n.lane}'.`);
    if ("data" in n && n.data) {
      const d = n.data as { reads?: string[]; writes?: string[] };
      d.reads?.forEach((x, j) => !dataIds.has(x) && bad(`${p}/data/reads/${j}`, describeNode(n), x, "data object", `Add a data object with id '${x}' or fix the reference.`));
      d.writes?.forEach((x, j) => !dataIds.has(x) && bad(`${p}/data/writes/${j}`, describeNode(n), x, "data object", `Add a data object with id '${x}' or fix the reference.`));
    }
    if (isTask(n) && n.integration?.lane !== undefined && !laneIds.has(n.integration.lane))
      bad(`${p}/integration/lane`, describeNode(n), n.integration.lane, "lane", `Point integration.lane at an existing lane (usually of kind external or system), or omit it.`);
    if (n.type === "boundaryEvent" && !nodeIds.has(n.attached_to))
      bad(`${p}/attached_to`, describeNode(n), n.attached_to, "node", `Set attached_to to the id of the task this event is attached to.`);
    if (isGateway(n) && n.pairs_with !== undefined && !nodeIds.has(n.pairs_with))
      bad(`${p}/pairs_with`, describeNode(n), n.pairs_with, "gateway", `Set pairs_with to the id of the ${n.type} split this join closes.`);
  });
  ir.edges.forEach((e, i) => {
    const p = `/edges/${i}`;
    if (!nodeIds.has(e.from)) bad(`${p}/from`, `edge '${e.id}'`, e.from, "node", "Point 'from' at an existing node id.");
    if (!nodeIds.has(e.to)) bad(`${p}/to`, `edge '${e.id}'`, e.to, "node", "Point 'to' at an existing node id.");
    e.data_contract?.carries?.forEach((x, j) => !dataIds.has(x) && bad(`${p}/data_contract/carries/${j}`, `edge '${e.id}'`, x, "data object", `Add a data object with id '${x}' or remove it from carries.`));
  });
  ir.requirements?.non_functional?.forEach((r, i) =>
    r.applies_to?.forEach((x, j) => !anyIds.has(x) && bad(`/requirements/non_functional/${i}/applies_to/${j}`, `NFR '${r.id}'`, x, "element", "applies_to must list existing node, lane or data object ids."))
  );
  ir.requirements?.assumptions?.forEach((r, i) =>
    r.affects?.forEach((x, j) => !anyIds.has(x) && bad(`/requirements/assumptions/${i}/affects/${j}`, `assumption '${r.id}'`, x, "element", "affects must list existing node, lane or data object ids."))
  );
  ir.requirements?.open_questions?.forEach((r, i) =>
    r.affects?.forEach((x, j) => !anyIds.has(x) && bad(`/requirements/open_questions/${i}/affects/${j}`, `open question '${r.id}'`, x, "element", "affects must list existing node, lane or data object ids."))
  );
  return out;
};

export const boundaryHostInvalid: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (n.type !== "boundaryEvent") continue;
    const host = g.nodesById.get(n.attached_to);
    if (!host) continue; // ref.unknown covers it
    if (!isTask(host)) {
      out.push({
        rule: "boundary.host-invalid",
        message: `${describeNode(n)} is attached to ${describeNode(host)}, but boundary events can only be attached to tasks.`,
        path: `${nodePath(g, n.id)}/attached_to`,
        element: nodeRef(n),
        fix: "Attach the boundary event to the task whose execution it interrupts, or model the exception as an exclusive gateway after the task."
      });
    }
  }
  return out;
};

export const eventTriggerKind: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    const allowed = ALLOWED_TRIGGERS[n.type];
    if (!allowed) continue;
    const trig = (n as { trigger?: { kind?: string } }).trigger;
    if (!trig?.kind) continue;
    if (!allowed.has(trig.kind)) {
      out.push({
        rule: "event.trigger-kind",
        message: `${describeNode(n)} has trigger kind '${trig.kind}', which is not allowed for ${n.type} (allowed: ${[...allowed].join(", ")}).`,
        path: `${nodePath(g, n.id)}/trigger/kind`,
        element: nodeRef(n),
        fix: `Use one of: ${[...allowed].join(", ")}.`
      });
    }
  }
  return out;
};

export const taskCriteriaMissing: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (!isTask(n)) continue;
    if (!n.acceptance_criteria || n.acceptance_criteria.length === 0) {
      out.push({
        rule: "task.criteria-missing",
        message: `${describeNode(n)} has no acceptance criteria.`,
        path: `${nodePath(g, n.id)}/acceptance_criteria`,
        element: nodeRef(n),
        fix: `Add at least one Given/When/Then criterion (id 'AC-1', ...) describing what must be true for '${n.name}' to be considered done.`,
        question: `What must be true for '${n.name}' to be considered done? (e.g. what does success look like, and what should happen on failure?)`
      });
    }
  }
  return out;
};

export const taskCriteriaDuplicateId: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (!isTask(n) || !n.acceptance_criteria) continue;
    const seen = new Set<string>();
    n.acceptance_criteria.forEach((ac, j) => {
      if (seen.has(ac.id)) {
        out.push({
          rule: "task.criteria-duplicate-id",
          message: `${describeNode(n)} has two acceptance criteria with id '${ac.id}'.`,
          path: `${nodePath(g, n.id)}/acceptance_criteria/${j}/id`,
          element: nodeRef(n),
          fix: "Number criteria AC-1, AC-2, ... uniquely within the task."
        });
      }
      seen.add(ac.id);
    });
  }
  return out;
};

export const taskIntegrationMissing: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (!isTask(n) || !INTEGRATION_TASKS.has(n.type)) continue;
    if (!n.integration) {
      out.push({
        rule: "task.integration-missing",
        message: `${describeNode(n)} does not say which system it interacts with.`,
        path: `${nodePath(g, n.id)}/integration`,
        element: nodeRef(n),
        fix: `Add integration: { system, operation, direction } for '${n.name}'.`,
        question: `Which system performs or is called by '${n.name}' (e.g. an internal service, a third-party API), and what operation?`
      });
    }
  }
  return out;
};

export const taskLaneKind: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  const laneKind = new Map(ir.lanes.map((l) => [l.id, l.kind] as const));
  for (const n of ir.nodes) {
    if (!isTask(n)) continue;
    const kind = laneKind.get(n.lane);
    if (!kind) continue; // ref.unknown covers it
    const humanRequired = (n.type === "userTask" || n.type === "manualTask") && kind === "system";
    if (humanRequired) {
      out.push({
        rule: "task.lane-human-required",
        message: `${describeNode(n)} is in lane '${n.lane}' (kind system); user/manual tasks are performed by people, i.e. a human lane (or an external organisation's lane).`,
        path: `${nodePath(g, n.id)}/lane`,
        element: nodeRef(n),
        fix: `Move it to a human (or external) lane, or change the task type to serviceTask/scriptTask if a system performs it.`
      });
    } else if (AUTOMATED_TASKS.has(n.type) && kind === "human") {
      out.push({
        rule: "task.lane-kind-suspicious",
        message: `${describeNode(n)} is an automated task but sits in human lane '${n.lane}'.`,
        path: `${nodePath(g, n.id)}/lane`,
        element: nodeRef(n),
        fix: `Move it to a system/external lane, or make it a userTask/manualTask if a person actually does it.`
      });
    }
  }
  return out;
};

export const laneUnused: RuleFn = ({ ir }) => {
  const used = new Set(ir.nodes.map((n) => n.lane));
  return ir.lanes
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !used.has(l.id))
    .map(({ l, i }) => ({
      rule: "lane.unused" as const,
      message: `Lane '${l.name}' (${l.id}) contains no nodes.`,
      path: `/lanes/${i}`,
      element: { kind: "lane" as const, id: l.id },
      fix: "Assign nodes to this lane or remove it."
    }));
};

export const dataUnused: RuleFn = ({ ir }) => {
  const used = new Set<string>();
  for (const e of ir.edges) e.data_contract?.carries?.forEach((x) => used.add(x));
  for (const n of ir.nodes) {
    const d = (n as { data?: { reads?: string[]; writes?: string[] } }).data;
    d?.reads?.forEach((x) => used.add(x));
    d?.writes?.forEach((x) => used.add(x));
  }
  return ir.data_objects
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => !used.has(d.id))
    .map(({ d, i }) => ({
      rule: "data.unused" as const,
      message: `Data object '${d.name}' (${d.id}) is never carried, read or written.`,
      path: `/data_objects/${i}`,
      element: { kind: "data_object" as const, id: d.id },
      fix: "Reference it from a node's data.reads/writes and an edge's data_contract.carries, or remove it."
    }));
};

export const dataSchemaMissing: RuleFn = ({ ir }) =>
  ir.data_objects
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.schema === undefined)
    .map(({ d, i }) => ({
      rule: "data.schema-missing" as const,
      message: `Data object '${d.name}' (${d.id}) has no schema.`,
      path: `/data_objects/${i}/schema`,
      element: { kind: "data_object" as const, id: d.id },
      fix: `Add a JSON Schema (draft 2020-12) with the fields of '${d.name}'.`,
      question: `What fields does '${d.name}' contain (names, types, which are required)?`
    }));

let schemaCompiler: Ajv2020 | undefined;
function compiler(): Ajv2020 {
  if (!schemaCompiler) {
    schemaCompiler = new Ajv2020({ strict: false, allErrors: false, validateSchema: true, logger: false });
    // ajv-formats ships CJS; under NodeNext its default export is the module namespace.
    const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (ajv: Ajv2020) => void;
    addFormats(schemaCompiler);
  }
  return schemaCompiler;
}

export const dataSchemaInvalid: RuleFn = ({ ir }) => {
  const out: RawFinding[] = [];
  ir.data_objects.forEach((d, i) => {
    if (d.schema === undefined || typeof d.schema !== "object" || d.schema === null) return; // schema.invalid covers non-objects
    try {
      // Compile in isolation: strip $id to avoid cross-object id collisions in the shared instance.
      const { $id: _ignored, ...rest } = d.schema as Record<string, unknown>;
      compiler().compile(rest);
    } catch (err) {
      out.push({
        rule: "data.schema-invalid",
        message: `Schema of data object '${d.name}' (${d.id}) does not compile: ${(err as Error).message}`,
        path: `/data_objects/${i}/schema`,
        element: { kind: "data_object", id: d.id },
        fix: "Fix the JSON Schema so it is valid draft 2020-12 (check keywords, regex patterns and $refs)."
      });
    }
  });
  return out;
};

export const provenanceAssumed: RuleFn = ({ ir }) => {
  const out: RawFinding[] = [];
  // label: what the element is (for the message); claim: the assumption as a sentence fragment (for the question).
  const push = (path: string, kind: ElementRef["kind"], id: string, label: string, claim: string, source?: string) =>
    out.push({
      rule: "provenance.assumed",
      message: `${label} was assumed rather than stated by the user${source ? ` (basis: ${source})` : ""}.`,
      path: `${path}/provenance`,
      element: { kind, id },
      fix: "Confirm with the user, or mark provenance.status as 'inferred'/'stated' if the prompt supports it.",
      question: `You did not say this explicitly, so I assumed that ${claim}${source ? ` (because: ${source})` : ""}. Is that right?`
    });
  ir.lanes.forEach((l, i) => l.provenance?.status === "assumed" && push(`/lanes/${i}`, "lane", l.id, `lane '${l.name}'`, `'${l.name}' (${l.kind}) is one of the actors`, l.provenance.source));
  ir.data_objects.forEach((d, i) => d.provenance?.status === "assumed" && push(`/data_objects/${i}`, "data_object", d.id, `data object '${d.name}'`, `there is a '${d.name}' data object`, d.provenance.source));
  ir.nodes.forEach((n, i) => n.provenance?.status === "assumed" && push(`/nodes/${i}`, "node", n.id, describeNode(n), `the process includes ${describeNode(n)}`, n.provenance.source));
  ir.edges.forEach((e, i) => e.provenance?.status === "assumed" && push(`/edges/${i}`, "edge", e.id, `flow ${e.from} -> ${e.to}`, `the flow goes from '${e.from}' to '${e.to}'${e.condition ? ` when ${e.condition.expression}` : ""}`, e.provenance.source));
  ir.requirements?.non_functional?.forEach((r, i) => r.provenance?.status === "assumed" && push(`/requirements/non_functional/${i}`, "nfr", r.id, `requirement '${r.id}'`, `the requirement "${r.statement}" applies`, r.provenance.source));
  return out;
};

export const questionOpen: RuleFn = ({ ir }) =>
  (ir.requirements?.open_questions ?? [])
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => !q.answered)
    .map(({ q, i }) => ({
      rule: "question.open" as const,
      message: `Open question '${q.id}' is unanswered: ${q.question}`,
      path: `/requirements/open_questions/${i}`,
      element: { kind: "question" as const, id: q.id },
      fix: "Ask the user; once answered set answered=true and record the answer, then update the affected elements.",
      question: q.question,
      data: { affects: q.affects ?? [] }
    }));

export const assumptionUnconfirmed: RuleFn = ({ ir }) =>
  (ir.requirements?.assumptions ?? [])
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => !a.confirmed)
    .map(({ a, i }) => ({
      rule: "assumption.unconfirmed" as const,
      message: `Assumption '${a.id}' has not been confirmed by the user: ${a.statement}`,
      path: `/requirements/assumptions/${i}`,
      element: { kind: "assumption" as const, id: a.id },
      fix: "Ask the user; once confirmed set confirmed=true (or remove/rewrite the assumption and update the affected elements).",
      question: `I am assuming: "${a.statement}". Is that right?`,
      data: { affects: a.affects ?? [] }
    }));

export const boundaryLaneMismatch: RuleFn = ({ ir, g }) => {
  const out: RawFinding[] = [];
  for (const n of ir.nodes) {
    if (n.type !== "boundaryEvent") continue;
    const host = g.nodesById.get(n.attached_to);
    if (!host || !isTask(host) || host.lane === n.lane) continue;
    out.push({
      rule: "boundary.lane-mismatch",
      message: `${describeNode(n)} is in lane '${n.lane}' but its host ${describeNode(host)} is in lane '${host.lane}'; a boundary event is drawn on its host.`,
      path: `${nodePath(g, n.id)}/lane`,
      element: nodeRef(n),
      fix: `Set the boundary event's lane to '${host.lane}'.`
    });
  }
  return out;
};


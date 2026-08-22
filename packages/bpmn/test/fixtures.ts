/**
 * Fixtures: the rich examples shipped with @vibestudio/ir (loaded fresh from
 * disk on every call so tests cannot accidentally share mutated state), plus
 * small inline IRs covering shapes the examples do not exercise (terminate
 * end events, timer/signal triggers, a loop, hostile characters).
 */
import { readFileSync } from "node:fs";
import type { ProcessIR } from "@vibestudio/ir";

export function loadExample(name: string): ProcessIR {
  const url = new URL(`../../ir/examples/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as ProcessIR;
}

export const checkout = (): ProcessIR => loadExample("checkout.ir.json");
export const leaveRequest = (): ProcessIR => loadExample("leave-request.draft.ir.json");

/** A retry loop: XOR merge re-entry, conditional exit, default back edge. */
export function loopIr(): ProcessIR {
  return {
    ir_version: "1.0",
    process: { id: "retry-loop", name: "Retry loop" },
    lanes: [{ id: "ops", name: "Ops", kind: "human" }],
    data_objects: [{ id: "job", name: "Job" }],
    nodes: [
      { id: "loop-start", type: "startEvent", name: "Started", lane: "ops", data: { writes: ["job"] } },
      { id: "loop-merge", type: "exclusiveGateway", direction: "join", name: "Attempt", lane: "ops" },
      {
        id: "do-work",
        type: "userTask",
        name: "Do work",
        lane: "ops",
        data: { reads: ["job"], writes: ["job"] }
      },
      { id: "loop-check", type: "exclusiveGateway", direction: "split", name: "Done?", lane: "ops" },
      {
        id: "loop-end",
        type: "endEvent",
        name: "Finished",
        lane: "ops",
        result: { kind: "message", detail: "job.done" }
      }
    ],
    edges: [
      { id: "le-1", from: "loop-start", to: "loop-merge", data_contract: { carries: ["job"] } },
      { id: "le-2", from: "loop-merge", to: "do-work", data_contract: { carries: ["job"] } },
      { id: "le-3", from: "do-work", to: "loop-check", data_contract: { carries: ["job"] } },
      {
        id: "le-4",
        from: "loop-check",
        to: "loop-end",
        name: "done",
        condition: { expression: "job.status == 'done'", language: "cel" },
        data_contract: { carries: ["job"] }
      },
      {
        id: "le-5",
        from: "loop-check",
        to: "loop-merge",
        name: "retry",
        is_default: true,
        data_contract: { carries: ["job"] }
      }
    ]
  };
}

/** Timer start, signal catch, terminate end — event kinds checkout lacks. */
export function eventsIr(): ProcessIR {
  return {
    ir_version: "1.0",
    process: { id: "events-demo", name: "Events demo" },
    lanes: [{ id: "sys", name: "System", kind: "system" }],
    data_objects: [],
    nodes: [
      {
        id: "ev-start",
        type: "startEvent",
        name: "Nightly",
        lane: "sys",
        trigger: { kind: "timer", detail: "0 2 * * *" }
      },
      {
        id: "ev-wait",
        type: "intermediateCatchEvent",
        name: "Wait for go signal",
        lane: "sys",
        trigger: { kind: "signal", detail: "go" }
      },
      { id: "ev-notify", type: "sendTask", name: "Notify", lane: "sys" },
      {
        id: "ev-done",
        type: "endEvent",
        name: "Abort all branches",
        lane: "sys",
        result: { kind: "terminate" }
      }
    ],
    edges: [
      { id: "ee-1", from: "ev-start", to: "ev-wait", data_contract: { carries: [] } },
      { id: "ee-2", from: "ev-wait", to: "ev-notify", data_contract: { carries: [] } },
      { id: "ee-3", from: "ev-notify", to: "ev-done", data_contract: { carries: [] } }
    ]
  };
}

/**
 * Multi-boundary regression fixtures (adversarial review findings): hosts
 * with several boundary events, and handlers placed exactly where naive
 * centre-line routing used to cross unrelated shapes.
 */

/** A host with TWO boundary events whose handlers stack in one shared lane. */
export function twinBoundaryIr(): ProcessIR {
  return {
    ir_version: "1.0",
    process: { id: "twin-boundary", name: "Twin boundary" },
    lanes: [
      { id: "main", name: "Main", kind: "system" },
      { id: "handlers", name: "Handlers", kind: "human" }
    ],
    data_objects: [],
    nodes: [
      { id: "start", type: "startEvent", name: "Start", lane: "main" },
      { id: "work", type: "serviceTask", name: "Work", lane: "main" },
      { id: "mend", type: "endEvent", name: "Done", lane: "main" },
      {
        id: "b-error",
        type: "boundaryEvent",
        name: "Failed",
        lane: "main",
        attached_to: "work",
        trigger: { kind: "error" }
      },
      {
        id: "b-timer",
        type: "boundaryEvent",
        name: "Timed out",
        lane: "main",
        attached_to: "work",
        trigger: { kind: "timer", detail: "PT5M" }
      },
      { id: "h-error", type: "userTask", name: "Handle error", lane: "handlers" },
      { id: "h-timer", type: "userTask", name: "Handle timeout", lane: "handlers" },
      { id: "he-error", type: "endEvent", name: "Error handled", lane: "handlers" },
      { id: "he-timer", type: "endEvent", name: "Timeout handled", lane: "handlers" }
    ],
    edges: [
      { id: "e-1", from: "start", to: "work", data_contract: { carries: [] } },
      { id: "e-2", from: "work", to: "mend", data_contract: { carries: [] } },
      { id: "e-b1", from: "b-error", to: "h-error", data_contract: { carries: [] } },
      { id: "e-b2", from: "b-timer", to: "h-timer", data_contract: { carries: [] } },
      { id: "e-h1", from: "h-error", to: "he-error", data_contract: { carries: [] } },
      { id: "e-h2", from: "h-timer", to: "he-timer", data_contract: { carries: [] } }
    ]
  };
}

/** Handler two lanes below the host, with a same-column node in between. */
export function deepHandlerIr(): ProcessIR {
  return {
    ir_version: "1.0",
    process: { id: "deep-handler", name: "Deep handler" },
    lanes: [
      { id: "top", name: "Top", kind: "system" },
      { id: "mid", name: "Mid", kind: "system" },
      { id: "bottom", name: "Bottom", kind: "human" }
    ],
    data_objects: [],
    nodes: [
      { id: "start", type: "startEvent", name: "Start", lane: "top" },
      { id: "work", type: "serviceTask", name: "Work", lane: "top" },
      { id: "notify", type: "sendTask", name: "Notify", lane: "mid" },
      { id: "bend", type: "endEvent", name: "Done", lane: "mid" },
      {
        id: "b-err",
        type: "boundaryEvent",
        name: "Failed",
        lane: "top",
        attached_to: "work",
        trigger: { kind: "error" }
      },
      { id: "handler", type: "userTask", name: "Recover", lane: "bottom" },
      { id: "hend", type: "endEvent", name: "Recovered", lane: "bottom" }
    ],
    edges: [
      { id: "e-1", from: "start", to: "work", data_contract: { carries: [] } },
      { id: "e-2", from: "work", to: "notify", data_contract: { carries: [] } },
      { id: "e-3", from: "notify", to: "bend", data_contract: { carries: [] } },
      { id: "e-b", from: "b-err", to: "handler", data_contract: { carries: [] } },
      { id: "e-h", from: "handler", to: "hend", data_contract: { carries: [] } }
    ]
  };
}

/** Host in the LAST lane; the exception edge routes upward past a blocker. */
export function upwardHandlerIr(): ProcessIR {
  return {
    ir_version: "1.0",
    process: { id: "upward-handler", name: "Upward handler" },
    lanes: [
      { id: "recovery", name: "Recovery", kind: "human" },
      { id: "mid", name: "Mid", kind: "system" },
      { id: "ops", name: "Ops", kind: "system" }
    ],
    data_objects: [],
    nodes: [
      { id: "handler", type: "userTask", name: "Recover", lane: "recovery" },
      { id: "hend", type: "endEvent", name: "Recovered", lane: "recovery" },
      { id: "notify", type: "sendTask", name: "Notify", lane: "mid" },
      { id: "bend", type: "endEvent", name: "Done", lane: "mid" },
      { id: "start", type: "startEvent", name: "Start", lane: "ops" },
      { id: "work", type: "serviceTask", name: "Work", lane: "ops" },
      {
        id: "b-err",
        type: "boundaryEvent",
        name: "Failed",
        lane: "ops",
        attached_to: "work",
        trigger: { kind: "error" }
      }
    ],
    edges: [
      { id: "e-1", from: "start", to: "work", data_contract: { carries: [] } },
      { id: "e-2", from: "work", to: "notify", data_contract: { carries: [] } },
      { id: "e-3", from: "notify", to: "bend", data_contract: { carries: [] } },
      { id: "e-b", from: "b-err", to: "handler", data_contract: { carries: [] } },
      { id: "e-h", from: "handler", to: "hend", data_contract: { carries: [] } }
    ]
  };
}

/** Three boundary events on one host, handlers stacked in the same lane. */
export function tripleBoundaryIr(): ProcessIR {
  return {
    ir_version: "1.0",
    process: { id: "triple-boundary", name: "Triple boundary" },
    lanes: [{ id: "ops", name: "Ops", kind: "system" }],
    data_objects: [],
    nodes: [
      { id: "start", type: "startEvent", name: "Start", lane: "ops" },
      { id: "work", type: "serviceTask", name: "Work", lane: "ops" },
      { id: "mend", type: "endEvent", name: "Done", lane: "ops" },
      {
        id: "b-1",
        type: "boundaryEvent",
        name: "Failed",
        lane: "ops",
        attached_to: "work",
        trigger: { kind: "error" }
      },
      {
        id: "b-2",
        type: "boundaryEvent",
        name: "Timed out",
        lane: "ops",
        attached_to: "work",
        trigger: { kind: "timer", detail: "PT5M" }
      },
      {
        id: "b-3",
        type: "boundaryEvent",
        name: "Escalated",
        lane: "ops",
        attached_to: "work",
        trigger: { kind: "signal", detail: "escalate" }
      },
      { id: "h-1", type: "serviceTask", name: "Handle error", lane: "ops" },
      { id: "h-2", type: "serviceTask", name: "Handle timeout", lane: "ops" },
      { id: "h-3", type: "serviceTask", name: "Handle escalation", lane: "ops" },
      { id: "he-1", type: "endEvent", name: "Error handled", lane: "ops" },
      { id: "he-2", type: "endEvent", name: "Timeout handled", lane: "ops" },
      { id: "he-3", type: "endEvent", name: "Escalation handled", lane: "ops" }
    ],
    edges: [
      { id: "e-1", from: "start", to: "work", data_contract: { carries: [] } },
      { id: "e-2", from: "work", to: "mend", data_contract: { carries: [] } },
      { id: "e-b1", from: "b-1", to: "h-1", data_contract: { carries: [] } },
      { id: "e-b2", from: "b-2", to: "h-2", data_contract: { carries: [] } },
      { id: "e-b3", from: "b-3", to: "h-3", data_contract: { carries: [] } },
      { id: "e-h1", from: "h-1", to: "he-1", data_contract: { carries: [] } },
      { id: "e-h2", from: "h-2", to: "he-2", data_contract: { carries: [] } },
      { id: "e-h3", from: "h-3", to: "he-3", data_contract: { carries: [] } }
    ]
  };
}

export const NASTY_TASK_NAME = `Review & 'approve' <cart> "now"`;
export const NASTY_EDGE_NAME = `it's <ok> & "fine"`;
export const NASTY_DESCRIPTION = `Checks <a> & "b" 'c'`;

/** Names/descriptions full of XML metacharacters, for escaping round-trips. */
export function nastyIr(): ProcessIR {
  return {
    ir_version: "1.0",
    process: { id: "nasty", name: `Ampersand & Sons <"QA">` },
    lanes: [{ id: "qa", name: `Q&A 'lane'`, kind: "human" }],
    data_objects: [],
    nodes: [
      { id: "nasty-start", type: "startEvent", name: "<go>", lane: "qa" },
      {
        id: "nasty-task",
        type: "userTask",
        name: NASTY_TASK_NAME,
        lane: "qa",
        description: NASTY_DESCRIPTION
      },
      { id: "nasty-end", type: "endEvent", name: `done & dusted`, lane: "qa" }
    ],
    edges: [
      { id: "ne-1", from: "nasty-start", to: "nasty-task", data_contract: { carries: [] } },
      {
        id: "ne-2",
        from: "nasty-task",
        to: "nasty-end",
        name: NASTY_EDGE_NAME,
        data_contract: { carries: [], description: NASTY_DESCRIPTION }
      }
    ]
  };
}

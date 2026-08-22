import { describe, expect, it } from "vitest";
import { RULE_IDS, RULES, type RuleId } from "../src/rules/catalog.js";
import type { EndEvent, ProcessIR } from "../src/types.js";
import { validate } from "../src/validate.js";
import { edge, fired, gateway, loadCheckout, mutate, node, removeEdge, removeNode, task } from "./helpers.js";

/**
 * One mutation per rule. Each must make the named rule fire on the (otherwise
 * valid) checkout example. Additional rules may fire as a side effect; that is
 * fine and expected (e.g. removing an edge also breaks cardinality).
 */
const TRIGGERS: Record<Exclude<RuleId, "schema.invalid">, (ir: ProcessIR) => void> = {
  "id.duplicate": (ir) => {
    ir.lanes[1]!.id = "cart";
    for (const n of ir.nodes) if (n.lane === "order-service") n.lane = "cart";
  },
  "ref.unknown": (ir) => {
    node(ir, "cart-review").lane = "nope";
  },
  "graph.no-start-or-end": (ir) => {
    removeNode(ir, "start-checkout");
    removeEdge(ir, "e-start");
  },
  "graph.orphan": (ir) => {
    ir.nodes.push({ id: "stray", type: "userTask", name: "Stray", lane: "customer", acceptance_criteria: [{ id: "AC-1", given: "g", when: "w", then: "t" }] });
  },
  "card.mismatch": (ir) => {
    ir.edges.push({ id: "e-extra", from: "cart-review", to: "end-checkout-rejected", data_contract: { carries: ["cart"] } });
  },
  "graph.unreachable": (ir) => {
    ir.nodes.push(
      { id: "island", type: "serviceTask", name: "Island", lane: "order-service", integration: { system: "x" }, acceptance_criteria: [{ id: "AC-1", given: "g", when: "w", then: "t" }] },
      { id: "island-end", type: "endEvent", name: "Island end", lane: "order-service" }
    );
    ir.edges.push({ id: "e-island", from: "island", to: "island-end", data_contract: { carries: [] } });
  },
  "graph.no-path-to-end": (ir) => {
    removeEdge(ir, "e-join-end");
  },
  "edge.self-loop": (ir) => {
    ir.edges.push({ id: "e-self", from: "cart-review", to: "cart-review", data_contract: { carries: ["cart"] } });
  },
  "edge.duplicate": (ir) => {
    ir.edges.push({ id: "e-start-2", from: "start-checkout", to: "cart-review", data_contract: { carries: ["cart"] } });
  },
  "gw.condition-missing": (ir) => {
    delete edge(ir, "e-paid-yes").condition;
  },
  "gw.condition-misplaced": (ir) => {
    edge(ir, "e-start").condition = { expression: "always" };
  },
  "gw.default-multiple": (ir) => {
    edge(ir, "e-paid-yes").is_default = true;
  },
  "gw.default-missing": (ir) => {
    const e = edge(ir, "e-valid-no");
    delete e.is_default;
    e.condition = { expression: "order.status == 'rejected'" };
  },
  "gw.default-implicit": (ir) => {
    delete edge(ir, "e-valid-no").is_default; // now the only bare branch of gw-valid, and no default
  },
  "gw.default-conditional": (ir) => {
    edge(ir, "e-valid-no").condition = { expression: "order.status == 'rejected'" };
  },
  "gw.condition-unbound": (ir) => {
    edge(ir, "e-paid-yes").condition = { expression: "receipt.sent_at != null && payment_result.status == 'approved'", language: "javascript" };
  },
  "gw.pairing-required": (ir) => {
    delete gateway(ir, "gw-fulfil-join").pairs_with;
  },
  "gw.pairing-invalid": (ir) => {
    gateway(ir, "gw-fulfil-join").pairs_with = "gw-valid";
  },
  "gw.join-missing": (ir) => {
    gateway(ir, "gw-fulfil-join").pairs_with = "gw-valid";
  },
  "gw.region-leak": (ir) => {
    ir.nodes.push({ id: "end-receipt-sent", type: "endEvent", name: "Receipt sent", lane: "order-service" });
    edge(ir, "e-receipt-join").to = "end-receipt-sent";
  },
  "loop.no-exit": (ir) => {
    removeEdge(ir, "e-paid-yes");
    removeEdge(ir, "e-paid-no");
    delete edge(ir, "e-paid-retry").condition;
    (node(ir, "payment-provider-error") as { attached_to: string }).attached_to = "order-confirm"; // no boundary exit inside the loop
  },
  "edge.contract-empty": (ir) => {
    edge(ir, "e-split-receipt").data_contract.carries = [];
  },
  "data.not-available": (ir) => {
    edge(ir, "e-start").data_contract.carries = ["cart", "order"];
  },
  "data.read-unavailable": (ir) => {
    task(ir, "order-confirm").data!.reads = ["order", "payment-result", "receipt"];
  },
  "data.unused": (ir) => {
    ir.data_objects.push({ id: "coupon", name: "Coupon", schema: { type: "object" } });
  },
  "data.schema-missing": (ir) => {
    delete ir.data_objects.find((d) => d.id === "receipt")!.schema;
  },
  "data.schema-invalid": (ir) => {
    ir.data_objects.find((d) => d.id === "receipt")!.schema = { type: "object", properties: { code: { type: "string", pattern: "([" } } };
  },
  "task.criteria-missing": (ir) => {
    delete task(ir, "cart-review").acceptance_criteria;
  },
  "task.criteria-duplicate-id": (ir) => {
    task(ir, "checkout-validate").acceptance_criteria![1]!.id = "AC-1";
  },
  "task.integration-missing": (ir) => {
    delete task(ir, "payment-init").integration;
  },
  "task.lane-human-required": (ir) => {
    task(ir, "cart-review").lane = "order-service";
  },
  "task.lane-kind-suspicious": (ir) => {
    task(ir, "checkout-validate").lane = "customer";
  },
  "lane.unused": (ir) => {
    ir.lanes.push({ id: "warehouse", name: "Warehouse", kind: "human" });
  },
  "boundary.host-invalid": (ir) => {
    (node(ir, "payment-provider-error") as { attached_to: string }).attached_to = "gw-paid";
  },
  "boundary.lane-mismatch": (ir) => {
    node(ir, "payment-provider-error").lane = "customer";
  },
  "assumption.unconfirmed": (ir) => {
    ir.requirements!.assumptions![0]!.confirmed = false;
  },
  "event.trigger-kind": (ir) => {
    (node(ir, "start-checkout") as { trigger: { kind: string } }).trigger.kind = "error";
  },
  "provenance.assumed": (ir) => {
    task(ir, "cart-review").provenance = { status: "assumed", source: "guessed from 'checkout'" };
  },
  "question.open": (ir) => {
    ir.requirements!.open_questions![0]!.answered = false;
  }
};

describe("validator on the checkout example", () => {
  it("passes in final mode with no findings at all", () => {
    const r = validate(loadCheckout(), { mode: "final" });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.summary).toContain("PASSED");
  });

  it("passes in draft mode too", () => {
    const r = validate(loadCheckout(), { mode: "draft" });
    expect(r.ok).toBe(true);
    expect(r.counts.gap).toBe(0);
  });
});

describe("every semantic rule can fire", () => {
  const ids = RULE_IDS.filter((id) => id !== "schema.invalid") as Exclude<RuleId, "schema.invalid">[];
  it.each(ids)("%s", (ruleId) => {
    const doc = mutate(TRIGGERS[ruleId]);
    const rules = fired(doc, { mode: "final" });
    expect(rules).toContain(ruleId);
    const r = validate(doc);
    for (const f of r.findings.filter((x) => x.rule === ruleId)) {
      expect(f.message.length).toBeGreaterThan(10);
      expect(f.path.startsWith("/")).toBe(true);
      expect(f.fix, `rule ${ruleId} should carry a fix hint`).toBeTruthy();
      expect(f.severity).toBe(RULES[ruleId].severity.final);
    }
  });

  it("covers every rule id in the catalogue with a trigger", () => {
    for (const id of RULE_IDS) {
      if (id === "schema.invalid") continue;
      expect(TRIGGERS[id], `missing trigger for ${id}`).toBeTypeOf("function");
    }
  });
});

describe("mode-dependent severities", () => {
  it("turns missing acceptance criteria into a gap in draft mode and an error in final mode", () => {
    const doc = mutate(TRIGGERS["task.criteria-missing"]);
    expect(fired(doc, { mode: "draft" }, "gap")).toContain("task.criteria-missing");
    expect(fired(doc, { mode: "final" }, "error")).toContain("task.criteria-missing");
    expect(validate(doc, { mode: "draft" }).ok).toBe(true);
    expect(validate(doc, { mode: "final" }).ok).toBe(false);
  });

  it("gap findings carry a question", () => {
    const doc = mutate(TRIGGERS["gw.condition-missing"]);
    const r = validate(doc, { mode: "draft" });
    const f = r.findings.find((x) => x.rule === "gw.condition-missing")!;
    expect(f.severity).toBe("gap");
    expect(f.question).toMatch(/under what condition/i);
  });
});

describe("gateway region rules", () => {
  it("allows a branch of a parallel block to end in a terminate end event", () => {
    const doc = mutate((ir) => {
      ir.nodes.push({ id: "end-abort", type: "endEvent", name: "Abort", lane: "order-service", result: { kind: "terminate" } } as EndEvent);
      edge(ir, "e-receipt-join").to = "end-abort";
    });
    const rules = fired(doc);
    expect(rules).not.toContain("gw.region-leak");
    expect(rules).toContain("card.mismatch"); // the join now has a single incoming flow
  });

  it("flags a join that receives a flow from outside its block", () => {
    const doc = mutate((ir) => {
      ir.edges.push({
        id: "e-sneak",
        from: "gw-valid",
        to: "gw-fulfil-join",
        condition: { expression: "order.total == 0" },
        data_contract: { carries: ["order"] }
      });
    });
    const r = validate(doc);
    const leak = r.findings.filter((f) => f.rule === "gw.region-leak");
    expect(leak.length).toBe(1);
    expect(leak[0]!.message).toContain("gw-valid");
  });

  it("flags a parallel branch that loops back to its split without passing the join", () => {
    const doc = mutate((ir) => {
      // send-receipt -> XOR split -> (retry) back to a merge before gw-fulfil-split | (ok) -> join
      ir.nodes.push(
        { id: "gw-pre-fulfil", type: "exclusiveGateway", direction: "join", name: "Fulfilment entry", lane: "order-service" },
        { id: "gw-receipt-ok", type: "exclusiveGateway", direction: "split", name: "Receipt ok?", lane: "order-service" }
      );
      edge(ir, "e-confirm-split").to = "gw-pre-fulfil";
      ir.edges.push(
        { id: "e-pre-split", from: "gw-pre-fulfil", to: "gw-fulfil-split", data_contract: { carries: ["order"] } },
        { id: "e-receipt-check", from: "send-receipt", to: "gw-receipt-ok", data_contract: { carries: ["order", "receipt"] } },
        { id: "e-receipt-ok", from: "gw-receipt-ok", to: "gw-fulfil-join", condition: { expression: "receipt.sent_at != null" }, data_contract: { carries: ["order", "receipt"] } },
        { id: "e-receipt-retry", from: "gw-receipt-ok", to: "gw-pre-fulfil", is_default: true, data_contract: { carries: ["order"] } }
      );
      removeEdge(ir, "e-receipt-join");
    });
    const r = validate(doc);
    const leak = r.findings.filter((f) => f.rule === "gw.region-leak");
    expect(leak.some((f) => f.message.includes("loops back"))).toBe(true);
  });

  it("does not require exclusive joins to be paired (loop re-entry merges)", () => {
    const r = validate(loadCheckout());
    expect(r.findings.filter((f) => f.rule === "gw.pairing-required")).toEqual([]);
  });

  it("validates an optional exclusive pairing when declared", () => {
    const doc = mutate((ir) => {
      gateway(ir, "gw-retry-merge").pairs_with = "gw-paid"; // gw-paid is downstream of the merge, so it is not its split
    });
    const rules = fired(doc);
    expect(rules).toContain("gw.region-leak");
  });
});

describe("data availability", () => {
  it("uses intersection semantics at exclusive merges", () => {
    // gw-retry-merge receives [order] from gw-valid and [order] from gw-paid; carrying payment-result out of it must fail
    const doc = mutate((ir) => {
      edge(ir, "e-paid-retry").data_contract.carries = ["order", "payment-result"];
      edge(ir, "e-merge-init").data_contract.carries = ["order", "payment-result"];
    });
    const r = validate(doc);
    const f = r.findings.filter((x) => x.rule === "data.not-available");
    expect(f.length).toBe(1);
    expect(f[0]!.message).toContain("every incoming flow");
    expect(f[0]!.path).toBe(`/edges/${doc.edges.findIndex((e) => e.id === "e-merge-init")}/data_contract/carries/1`);
  });

  it("uses union semantics at parallel joins", () => {
    const r = validate(loadCheckout());
    expect(r.findings.filter((x) => x.rule === "data.not-available")).toEqual([]);
  });

  it("lets boundary events carry what their host RECEIVED, not what it writes", () => {
    const ok = mutate((ir) => {
      edge(ir, "e-provider-error").data_contract.carries = ["order"]; // arrives at payment-init
    });
    expect(fired(ok)).not.toContain("data.not-available");
    const hostWrite = mutate((ir) => {
      edge(ir, "e-provider-error").data_contract.carries = ["order", "payment-intent"]; // payment-init WRITES it; may not have happened
    });
    const f = validate(hostWrite).findings.filter((x) => x.rule === "data.not-available");
    expect(f.length).toBe(1);
    expect(f[0]!.message).toContain("payment-intent");
    expect(f[0]!.fix).toMatch(/may not have finished/);
    const ownPayload = mutate((ir) => {
      ir.data_objects.push({ id: "provider-error", name: "Provider error", schema: { type: "object" } });
      (node(ir, "payment-provider-error") as { data?: { writes: string[] } }).data = { writes: ["provider-error"] };
      edge(ir, "e-provider-error").data_contract.carries = ["order", "provider-error"];
    });
    expect(fired(ownPayload)).not.toContain("data.not-available");
  });
});

describe("robustness", () => {
  it("never throws on a schema-invalid but IR-shaped document", () => {
    const doc = mutate((ir) => {
      (task(ir, "cart-review") as unknown as { acceptance_criteria: unknown }).acceptance_criteria = "lots";
      (ir.edges[0] as unknown as { data_contract: unknown }).data_contract = "cart";
      (ir.nodes[3] as unknown as { direction: unknown }).direction = 42;
    });
    expect(() => validate(doc)).not.toThrow();
    expect(validate(doc).ok).toBe(false);
  });

  it("is deterministic", () => {
    const doc = mutate((ir) => {
      TRIGGERS["gw.region-leak"](ir);
      TRIGGERS["data.unused"](ir);
      TRIGGERS["task.criteria-missing"](ir);
    });
    const a = validate(doc, { mode: "draft" });
    const b = validate(doc, { mode: "draft" });
    expect(a).toEqual(b);
    // sorted: errors, then warnings, then gaps; within severity by rule id then path
    const sev = a.findings.map((f) => f.severity);
    const rank = { error: 0, warning: 1, gap: 2 } as const;
    for (let i = 1; i < sev.length; i++) expect(rank[sev[i]!]).toBeGreaterThanOrEqual(rank[sev[i - 1]!]);
  });

  it("assertValid throws with a compact message", async () => {
    const { assertValid } = await import("../src/validate.js");
    const doc = mutate(TRIGGERS["gw.join-missing"]);
    expect(() => assertValid(doc)).toThrow(/gw\.join-missing/);
    expect(() => assertValid(loadCheckout())).not.toThrow();
  });
});

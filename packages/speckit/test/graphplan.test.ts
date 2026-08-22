/**
 * Graph plan tests: the machine-readable dev plan (one self-contained work
 * packet per task, loop structure with exit conditions, gateway routing) plus
 * its human-readable markdown rendering. The markdown must satisfy the same
 * whole-file invariants as every other kit file; the JSON side must carry the
 * IR's text verbatim — sanitisation is a rendering concern only.
 */
import { describe, expect, it } from "vitest";
import { isTask, type ProcessIR } from "@vibestudio/ir";
import { generateGraphPlan, renderGraphPlanMarkdown } from "../src/index.js";
import { expectKitInvariants, loadExample } from "./helpers.js";

const ir = loadExample("checkout.ir.json");
const plan = generateGraphPlan(ir);

describe("graph plan: checkout packets", () => {
  it("emits exactly one packet per task node, in build order", () => {
    const taskIds = ir.nodes.filter(isTask).map((n) => n.id);
    expect([...plan.packets.map((p) => p.id)].sort()).toEqual([...taskIds].sort());
    const taskSet = new Set(taskIds);
    expect(plan.packets.map((p) => p.id)).toEqual(plan.build_order.filter((id) => taskSet.has(id)));
  });

  it("orders cart-review before payment-init", () => {
    const at = (id: string): number => plan.build_order.indexOf(id);
    expect(at("cart-review")).toBeGreaterThanOrEqual(0);
    expect(at("payment-init")).toBeGreaterThan(at("cart-review"));
  });

  it("embeds the schemas of every data object a packet touches", () => {
    const init = plan.packets.find((p) => p.id === "payment-init")!;
    // reads order; writes order + payment-intent; carries order in, order + payment-intent out.
    expect(Object.keys(init.data_schemas)).toEqual(["order", "payment-intent"]);
    const order = ir.data_objects.find((d) => d.id === "order")!;
    expect(init.data_schemas["order"]).toEqual(order.schema);
    const review = plan.packets.find((p) => p.id === "cart-review")!;
    expect(Object.keys(review.data_schemas)).toEqual(["cart"]);
  });

  it("looks through gateways so packet flows name work nodes", () => {
    const init = plan.packets.find((p) => p.id === "payment-init")!;
    expect(init.inputs).toHaveLength(1);
    expect(init.inputs[0]!.via).toBe("gw-retry-merge");
    expect([...init.inputs[0]!.work].sort()).toEqual(["checkout-validate", "payment-authorize"]);
    expect(init.inputs[0]!.carries).toEqual(["order"]);
  });
});

describe("graph plan: checkout retry loop", () => {
  it("detects the payment retry loop with merge-first member order", () => {
    expect(plan.loops).toHaveLength(1);
    const loop = plan.loops[0]!;
    expect(loop.id).toBe("loop-1");
    expect([...loop.members].sort()).toEqual(["gw-paid", "gw-retry-merge", "payment-authorize", "payment-init"]);
    expect(loop.members[0]).toBe("gw-retry-merge");
  });

  it("records every exit edge with its condition", () => {
    const exits = [...plan.loops[0]!.exits].sort((a, b) => (a.edge < b.edge ? -1 : 1));
    expect(exits).toEqual([
      { from: "gw-paid", to: "end-payment-failed", edge: "e-paid-no", condition: "otherwise (default)" },
      { from: "gw-paid", to: "order-confirm", edge: "e-paid-yes", condition: "payment_result.status == 'approved'" }
    ]);
  });

  it("stamps loop membership and exits onto member packets", () => {
    const init = plan.packets.find((p) => p.id === "payment-init")!;
    expect(init.loop?.id).toBe("loop-1");
    expect(init.loop?.exits).toContainEqual({ on: "payment_result.status == 'approved'", to: "order-confirm" });
    const confirm = plan.packets.find((p) => p.id === "order-confirm")!;
    expect(confirm.loop).toBeUndefined();
  });
});

describe("graph plan: checkout routing", () => {
  it("routes every gateway with conditions and defaults", () => {
    const paid = plan.routing.find((r) => r.gateway === "gw-paid")!;
    expect(paid.direction).toBe("split");
    expect(paid.branches).toHaveLength(3);
    expect(paid.branches).toContainEqual({ edge: "e-paid-yes", to: "order-confirm", condition: "payment_result.status == 'approved'" });
    expect(paid.branches).toContainEqual({ edge: "e-paid-no", to: "end-payment-failed", is_default: true });
  });
});

describe("graph plan: markdown rendering", () => {
  const md = renderGraphPlanMarkdown(ir);

  it("satisfies the same whole-file invariants as the other kit files", () => {
    expectKitInvariants(ir, { files: [{ path: "graph-plan.md", content: md }] });
  });

  it("renders build order, packets, loop and routing sections", () => {
    expect(md).toContain("# Checkout — graph plan");
    expect(md).toContain("## Build order");
    expect(md).toContain("### Initiate payment (payment-init)");
    expect(md).toContain("- Part of loop-1");
    expect(md).toContain("- exits to Confirm order (order-confirm) when: payment_result.status == 'approved'");
    expect(md).toContain("## Routing (owned by the orchestrator, not by tasks)");
  });
});

describe("graph plan: determinism", () => {
  it("two runs produce a deep-equal plan and byte-identical markdown, without mutating the input", () => {
    const a = generateGraphPlan(loadExample("checkout.ir.json"));
    const b = generateGraphPlan(loadExample("checkout.ir.json"));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const m1 = renderGraphPlanMarkdown(loadExample("checkout.ir.json"));
    const m2 = renderGraphPlanMarkdown(loadExample("checkout.ir.json"));
    expect(m1 === m2, "markdown must be byte-identical").toBe(true);

    const fresh = loadExample("checkout.ir.json");
    const before = JSON.stringify(fresh);
    generateGraphPlan(fresh);
    renderGraphPlanMarkdown(fresh);
    expect(JSON.stringify(fresh)).toBe(before);
  });
});

describe("graph plan: leave-request draft", () => {
  it("generates without crashing and the markdown keeps the invariants", () => {
    const draft = loadExample("leave-request.draft.ir.json");
    const p = generateGraphPlan(draft);
    expect(p.packets.length).toBeGreaterThan(0);
    expect(p.build_order.length).toBe(draft.nodes.length);
    const md = renderGraphPlanMarkdown(draft);
    expectKitInvariants(draft, { files: [{ path: "graph-plan.md", content: md }] });
  });
});

describe("graph plan: adversarial text", () => {
  const hostile: ProcessIR = {
    ir_version: "1.0",
    process: { id: "hostile", name: "Hostile\nProc" },
    lanes: [{ id: "ops", name: "Ops", kind: "human" }],
    data_objects: [],
    nodes: [
      { id: "start", type: "startEvent", name: "Start\nHere", lane: "ops" },
      {
        id: "do-work",
        type: "userTask",
        name: "Do\nWork",
        lane: "ops",
        acceptance_criteria: [{ id: "AC-1", given: "g", when: "c \\| d", then: "t" }],
        integration: { system: "Sys\ntem", operation: "o\np" }
      },
      { id: "gw", type: "exclusiveGateway", direction: "split", name: "Which\nway?", lane: "ops" },
      { id: "end-a", type: "endEvent", name: "Done A", lane: "ops" },
      { id: "end-b", type: "endEvent", name: "Done B", lane: "ops" }
    ],
    edges: [
      { id: "e-start", from: "start", to: "do-work", data_contract: { carries: [] } },
      // Generator-level robustness: a condition on a task's outgoing edge must
      // still render one-line even though final IR keeps conditions on gateways.
      { id: "e-work-gw", from: "do-work", to: "gw", condition: { expression: "x ==\n'y'" }, data_contract: { carries: [] } },
      { id: "e-yes", from: "gw", to: "end-a", condition: { expression: "cond\nA", language: "natural" }, data_contract: { carries: [] } },
      { id: "e-no", from: "gw", to: "end-b", is_default: true, data_contract: { carries: [] } }
    ]
  };

  it("collapses newlines in every markdown interpolation and keeps the invariants", () => {
    const md = renderGraphPlanMarkdown(hostile);
    expect(md).toContain("# Hostile Proc — graph plan");
    expect(md).toContain("### Do Work (do-work)");
    expect(md).toContain("### Which way? (gw)");
    expect(md).toContain("(when x == 'y')");
    expect(md).toContain("- Integration: Sys tem — o p");
    expect(md).toContain("when: cond A");
    expect(md).not.toContain("Hostile\nProc");
    expectKitInvariants(hostile, { files: [{ path: "graph-plan.md", content: md }] });
  });

  it("keeps the raw text verbatim on the JSON side", () => {
    const p = generateGraphPlan(hostile);
    expect(p.process.name).toBe("Hostile\nProc");
    const packet = p.packets.find((x) => x.id === "do-work")!;
    expect(packet.name).toBe("Do\nWork");
    expect(packet.integration?.system).toBe("Sys\ntem");
    expect(packet.outputs[0]!.condition).toBe("x ==\n'y'");
    const route = p.routing.find((r) => r.gateway === "gw")!;
    expect(route.name).toBe("Which\nway?");
    expect(route.branches.find((b) => b.edge === "e-yes")?.condition).toBe("cond\nA");
  });
});

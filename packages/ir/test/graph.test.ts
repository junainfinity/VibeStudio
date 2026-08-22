import { describe, expect, it } from "vitest";
import { buildIndex, reachableFrom, stronglyConnectedComponents, topologicalOrder } from "../src/graph.js";
import { loadCheckout } from "./helpers.js";

describe("graph helpers", () => {
  const g = buildIndex(loadCheckout());

  it("adds implicit host -> boundary edges to the analysis graph", () => {
    expect(g.succ.get("payment-init")).toContain("payment-provider-error");
    expect(g.outEdges.get("payment-init")!.map((e) => e.to)).toEqual(["payment-authorize"]);
    expect(g.hostOf.get("payment-provider-error")).toBe("payment-init");
  });

  it("finds the payment retry loop as the only cycle", () => {
    const cycles = stronglyConnectedComponents(g).filter((c) => c.length > 1);
    expect(cycles.length).toBe(1);
    expect(new Set(cycles[0])).toEqual(new Set(["gw-retry-merge", "payment-init", "payment-authorize", "gw-paid"]));
  });

  it("reaches every node from the start and every node reaches an end", () => {
    const fwd = reachableFrom(g, ["start-checkout"]);
    expect(fwd.size).toBe(g.nodesById.size);
    const ends = [...g.nodesById.values()].filter((n) => n.type === "endEvent").map((n) => n.id);
    const back = reachableFrom(g, ends, { reverse: true });
    expect(back.size).toBe(g.nodesById.size);
  });

  it("produces a topological order that respects forward edges (ignoring back edges)", () => {
    const order = topologicalOrder(g);
    expect(order.length).toBe(g.nodesById.size);
    const pos = new Map(order.map((id, i) => [id, i] as const));
    expect(pos.get("start-checkout")!).toBeLessThan(pos.get("cart-review")!);
    expect(pos.get("order-confirm")!).toBeLessThan(pos.get("gw-fulfil-split")!);
    expect(pos.get("gw-fulfil-split")!).toBeLessThan(pos.get("gw-fulfil-join")!);
    expect(pos.get("gw-fulfil-join")!).toBeLessThan(pos.get("end-order-placed")!);
    // deterministic
    expect(topologicalOrder(g)).toEqual(order);
  });
});

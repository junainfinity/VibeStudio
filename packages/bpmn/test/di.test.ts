import { describe, expect, it } from "vitest";
import { validate } from "@vibestudio/ir";
import { computeLayout, irToBpmn } from "../src/index.js";
import {
  checkout,
  deepHandlerIr,
  loopIr,
  tripleBoundaryIr,
  twinBoundaryIr,
  upwardHandlerIr
} from "./fixtures.js";
import {
  boundsOf,
  diOf,
  overlaps,
  parse,
  prop,
  segmentCrossesRect,
  type Bounds,
  type ModdleElement
} from "./helpers.js";

describe("irToBpmn(checkout) — BPMNDI layout", () => {
  const ir = checkout();

  it("parses with zero warnings and contains exactly one BPMNDiagram for the process", async () => {
    const xml = await irToBpmn(ir);
    const { rootElement, warnings } = await parse(xml);
    expect(warnings).toEqual([]);
    const diagrams = prop<ModdleElement[]>(rootElement, "diagrams");
    expect(diagrams).toHaveLength(1);
    const di = diOf(rootElement);
    expect(prop<ModdleElement>(di.plane, "bpmnElement").id).toBe("checkout");
  });

  it("gives EVERY node a shape — including the boundary event, on its host's bottom border", async () => {
    const { rootElement } = await parse(await irToBpmn(ir));
    const di = diOf(rootElement);
    for (const node of ir.nodes) {
      expect(di.shapes.has(node.id), `shape for ${node.id}`).toBe(true);
    }
    const boundary = boundsOf(di.shapes.get("payment-provider-error")!);
    const host = boundsOf(di.shapes.get("payment-init")!);
    // Centre of the boundary event sits exactly on the host's bottom edge,
    // half in / half out.
    expect(boundary.y + boundary.height / 2).toBe(host.y + host.height);
    expect(boundary.x).toBeGreaterThanOrEqual(host.x);
    expect(boundary.x + boundary.width).toBeLessThanOrEqual(host.x + host.width);
  });

  it("gives every lane a horizontal shape spanning the full diagram width", async () => {
    const { rootElement } = await parse(await irToBpmn(ir));
    const di = diOf(rootElement);
    const laneBounds = ir.lanes.map((lane) => {
      const shape = di.shapes.get(lane.id);
      expect(shape, `lane shape for ${lane.id}`).toBeDefined();
      expect(prop<boolean>(shape!, "isHorizontal")).toBe(true);
      return boundsOf(shape!);
    });
    const width = Math.max(...laneBounds.map((b) => b.x + b.width));
    for (const bounds of laneBounds) {
      expect(bounds.x).toBe(0);
      expect(bounds.width).toBe(width);
    }
    // Lanes tile top-to-bottom in IR order with no gaps.
    for (let i = 1; i < laneBounds.length; i += 1) {
      expect(laneBounds[i]!.y).toBe(laneBounds[i - 1]!.y + laneBounds[i - 1]!.height);
    }
  });

  it("places every node inside its own lane's band", async () => {
    const { rootElement } = await parse(await irToBpmn(ir));
    const di = diOf(rootElement);
    for (const node of ir.nodes) {
      const nodeBounds = boundsOf(di.shapes.get(node.id)!);
      const laneBounds = boundsOf(di.shapes.get(node.lane)!);
      expect(nodeBounds.y, `${node.id} top vs lane ${node.lane}`).toBeGreaterThanOrEqual(laneBounds.y);
      expect(nodeBounds.y + nodeBounds.height, `${node.id} bottom vs lane ${node.lane}`).toBeLessThanOrEqual(
        laneBounds.y + laneBounds.height
      );
      expect(nodeBounds.x).toBeGreaterThanOrEqual(laneBounds.x);
      expect(nodeBounds.x + nodeBounds.width).toBeLessThanOrEqual(laneBounds.x + laneBounds.width);
    }
  });

  it("never overlaps two node shapes (except a boundary event on its host)", async () => {
    const { rootElement } = await parse(await irToBpmn(ir));
    const di = diOf(rootElement);
    const attachedTo = new Map<string, string>();
    for (const node of ir.nodes) {
      if (node.type === "boundaryEvent") attachedTo.set(node.id, node.attached_to);
    }
    const entries: Array<[string, Bounds]> = ir.nodes.map((node) => [
      node.id,
      boundsOf(di.shapes.get(node.id)!)
    ]);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [idA, a] = entries[i]!;
        const [idB, b] = entries[j]!;
        const boundaryOnHost = attachedTo.get(idA) === idB || attachedTo.get(idB) === idA;
        if (boundaryOnHost) {
          // The half-in/half-out placement REQUIRES this overlap.
          expect(overlaps(a, b), `${idA} should sit on ${idB}`).toBe(true);
        } else {
          expect(overlaps(a, b), `${idA} overlaps ${idB}`).toBe(false);
        }
      }
    }
  });

  it("draws a BPMNEdge with at least 2 waypoints for every sequence flow", async () => {
    const { rootElement } = await parse(await irToBpmn(ir));
    const di = diOf(rootElement);
    for (const edge of ir.edges) {
      const diEdge = di.edges.get(edge.id);
      expect(diEdge, `BPMNEdge for ${edge.id}`).toBeDefined();
      const waypoints = prop<ModdleElement[]>(diEdge!, "waypoint");
      expect(waypoints.length, `waypoints of ${edge.id}`).toBeGreaterThanOrEqual(2);
    }
    // The boundary event's exception edge leaves downward.
    const errorEdge = prop<ModdleElement[]>(di.edges.get("e-provider-error")!, "waypoint");
    expect(prop<number>(errorEdge[1]!, "y")).toBeGreaterThan(prop<number>(errorEdge[0]!, "y"));
    expect(prop<number>(errorEdge[0]!, "x")).toBe(prop<number>(errorEdge[1]!, "x"));
  });
});

describe("multi-boundary hosts — DI invariants (adversarial review)", () => {
  const scenarios = [
    ["two boundary events, handlers stacked in a shared lane", twinBoundaryIr],
    ["handler two lanes below the host, blocker in between", deepHandlerIr],
    ["upward exception edge past a same-column blocker", upwardHandlerIr],
    ["three boundary events, handlers in the host's own lane", tripleBoundaryIr]
  ] as const;

  it("fixtures are validator-clean (zero errors)", () => {
    for (const [label, make] of scenarios) {
      expect(validate(make(), { mode: "draft" }).counts.error, label).toBe(0);
    }
  });

  it("never overlaps two node shapes — including sibling boundary events on one host", () => {
    for (const [label, make] of scenarios) {
      const ir = make();
      const layout = computeLayout(ir, false);
      const rectById = new Map(layout.nodeShapes.map((shape) => [shape.id, shape.rect]));
      const attachedTo = new Map<string, string>();
      for (const node of ir.nodes) {
        if (node.type === "boundaryEvent") attachedTo.set(node.id, node.attached_to);
      }
      const ids = ir.nodes.map((node) => node.id);
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const idA = ids[i]!;
          const idB = ids[j]!;
          // Only the half-in/half-out host↔boundary pair may overlap; two
          // SIBLING boundary events on the same host may not.
          if (attachedTo.get(idA) === idB || attachedTo.get(idB) === idA) continue;
          expect(
            overlaps(rectById.get(idA)!, rectById.get(idB)!),
            `${label}: ${idA} overlaps ${idB}`
          ).toBe(false);
        }
      }
    }
  });

  it("keeps sibling boundary events on (or overflowing past the right edge of) the host's bottom border", () => {
    for (const [label, make] of scenarios) {
      const ir = make();
      const layout = computeLayout(ir, false);
      const rectById = new Map(layout.nodeShapes.map((shape) => [shape.id, shape.rect]));
      for (const node of ir.nodes) {
        if (node.type !== "boundaryEvent") continue;
        const boundary = rectById.get(node.id)!;
        const host = rectById.get(node.attached_to)!;
        expect(boundary.y + boundary.height / 2, `${label}: ${node.id} centre on host bottom`).toBe(
          host.y + host.height
        );
        // Never left of the host; may only overflow to the RIGHT when the
        // host is too narrow for all siblings at the minimum pitch.
        expect(boundary.x, `${label}: ${node.id} left of host`).toBeGreaterThanOrEqual(host.x);
      }
    }
  });

  it("routes every edge clear of every node shape (no edge-segment/shape intersections)", () => {
    for (const [label, make] of scenarios) {
      const ir = make();
      const layout = computeLayout(ir, false);
      const rectById = new Map(layout.nodeShapes.map((shape) => [shape.id, shape.rect]));
      for (const edge of ir.edges) {
        const di = layout.edgeWaypoints.find((candidate) => candidate.id === edge.id);
        expect(di, `${label}: waypoints for ${edge.id}`).toBeDefined();
        const { waypoints } = di!;
        for (let i = 1; i < waypoints.length; i += 1) {
          for (const [id, rect] of rectById) {
            if (id === edge.from || id === edge.to) continue;
            expect(
              segmentCrossesRect(waypoints[i - 1]!, waypoints[i]!, rect),
              `${label}: edge ${edge.id} segment ${i} crosses ${id}`
            ).toBe(false);
          }
        }
      }
    }
  });
});

describe("irToBpmn — adversarial loop", () => {
  it("lays out a cyclic IR without crashing; every node gets a shape, every edge waypoints", async () => {
    const ir = loopIr();
    const xml = await irToBpmn(ir);
    const { rootElement, warnings } = await parse(xml);
    expect(warnings).toEqual([]);
    const di = diOf(rootElement);
    for (const node of ir.nodes) expect(di.shapes.has(node.id), node.id).toBe(true);
    for (const edge of ir.edges) {
      expect(prop<ModdleElement[]>(di.edges.get(edge.id)!, "waypoint").length).toBeGreaterThanOrEqual(2);
    }
    // The back edge routes below the lane band instead of through nodes.
    const lane = boundsOf(di.shapes.get("ops")!);
    const back = prop<ModdleElement[]>(di.edges.get("le-5")!, "waypoint");
    const maxY = Math.max(...back.map((point) => prop<number>(point, "y")));
    expect(maxY).toBeGreaterThan(lane.y + lane.height);
  });
});

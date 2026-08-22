/**
 * Test-side helpers: parse generated XML with bpmn-moddle (the reference
 * BPMN 2.0 reader) and navigate the untyped moddle tree with typed accessors.
 */
import { BpmnModdle, type FromXmlResult, type ModdleElement } from "bpmn-moddle";

export type { ModdleElement };

export async function parse(xml: string): Promise<FromXmlResult> {
  return BpmnModdle().fromXML(xml, "bpmn:Definitions");
}

/** Typed property access over a moddle element. */
export function prop<T>(element: ModdleElement, name: string): T {
  return element.get(name) as T;
}

export function processOf(definitions: ModdleElement): ModdleElement {
  const roots = prop<ModdleElement[]>(definitions, "rootElements");
  const process = roots.find((root) => root.$type === "bpmn:Process");
  if (process === undefined) throw new Error("no bpmn:Process in definitions");
  return process;
}

export function flowElementsOf(process: ModdleElement): ModdleElement[] {
  return prop<ModdleElement[] | undefined>(process, "flowElements") ?? [];
}

export function byType(elements: ModdleElement[], type: string): ModdleElement[] {
  return elements.filter((element) => element.$type === type);
}

export function byId(elements: ModdleElement[], id: string): ModdleElement {
  const found = elements.find((element) => element.id === id);
  if (found === undefined) throw new Error(`element "${id}" not found`);
  return found;
}

/** Text of the first bpmn:documentation child, if any. */
export function documentationOf(element: ModdleElement): string | undefined {
  const docs = prop<ModdleElement[] | undefined>(element, "documentation") ?? [];
  const first = docs[0];
  return first === undefined ? undefined : prop<string | undefined>(first, "text");
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function boundsOf(shape: ModdleElement): Bounds {
  const bounds = prop<ModdleElement>(shape, "bounds");
  return {
    x: prop<number>(bounds, "x"),
    y: prop<number>(bounds, "y"),
    width: prop<number>(bounds, "width"),
    height: prop<number>(bounds, "height")
  };
}

export function overlaps(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * True iff an AXIS-ALIGNED segment passes through the rect's interior.
 * (Bounding-box overlap with strict inequalities is exact for horizontal and
 * vertical segments: touching a border — e.g. an edge ending ON a shape — is
 * not a crossing. Do not use for diagonal segments.)
 */
export function segmentCrossesRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  r: Bounds
): boolean {
  if (a.x !== b.x && a.y !== b.y) {
    throw new Error("segmentCrossesRect expects axis-aligned segments");
  }
  return (
    Math.min(a.x, b.x) < r.x + r.width &&
    Math.max(a.x, b.x) > r.x &&
    Math.min(a.y, b.y) < r.y + r.height &&
    Math.max(a.y, b.y) > r.y
  );
}

export interface DiIndex {
  plane: ModdleElement;
  /** bpmnElement id → BPMNShape */
  shapes: Map<string, ModdleElement>;
  /** bpmnElement id → BPMNEdge */
  edges: Map<string, ModdleElement>;
}

export function diOf(definitions: ModdleElement): DiIndex {
  const diagrams = prop<ModdleElement[] | undefined>(definitions, "diagrams") ?? [];
  const diagram = diagrams[0];
  if (diagram === undefined) throw new Error("no bpmndi:BPMNDiagram");
  const plane = prop<ModdleElement>(diagram, "plane");
  const planeElements = prop<ModdleElement[] | undefined>(plane, "planeElement") ?? [];
  const shapes = new Map<string, ModdleElement>();
  const edges = new Map<string, ModdleElement>();
  for (const element of planeElements) {
    const referenced = prop<ModdleElement | undefined>(element, "bpmnElement");
    const id = referenced?.id;
    if (id === undefined) continue;
    if (element.$type === "bpmndi:BPMNShape") shapes.set(id, element);
    if (element.$type === "bpmndi:BPMNEdge") edges.set(id, element);
  }
  return { plane, shapes, edges };
}

import { readFileSync } from "node:fs";
import type { Edge, Node, ProcessIR, Task, Gateway } from "../src/types.js";
import { validate, type ValidateOptions } from "../src/validate.js";
import type { RuleId } from "../src/rules/catalog.js";

const CHECKOUT_URL = new URL("../examples/checkout.ir.json", import.meta.url);

export function loadCheckout(): ProcessIR {
  return JSON.parse(readFileSync(CHECKOUT_URL, "utf8")) as ProcessIR;
}

/** Deep-clone the checkout example and apply a mutation. */
export function mutate(fn: (ir: ProcessIR) => void): ProcessIR {
  const ir = loadCheckout();
  fn(ir);
  return ir;
}

export function node<T extends Node = Node>(ir: ProcessIR, id: string): T {
  const n = ir.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n as T;
}

export const task = (ir: ProcessIR, id: string): Task => node<Task>(ir, id);
export const gateway = (ir: ProcessIR, id: string): Gateway => node<Gateway>(ir, id);

export function edge(ir: ProcessIR, id: string): Edge {
  const e = ir.edges.find((x) => x.id === id);
  if (!e) throw new Error(`no edge ${id}`);
  return e;
}

export function removeEdge(ir: ProcessIR, id: string): void {
  const i = ir.edges.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no edge ${id}`);
  ir.edges.splice(i, 1);
}

export function removeNode(ir: ProcessIR, id: string): void {
  const i = ir.nodes.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no node ${id}`);
  ir.nodes.splice(i, 1);
}

/** Rule ids fired by validating the doc (optionally filtered by severity). */
export function fired(doc: unknown, opts: ValidateOptions = {}, severity?: "error" | "warning" | "gap"): RuleId[] {
  const r = validate(doc, opts);
  return [...new Set(r.findings.filter((f) => !severity || f.severity === severity).map((f) => f.rule))];
}

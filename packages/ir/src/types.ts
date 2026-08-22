/**
 * TypeScript view of the Process IR v1.
 *
 * The JSON Schema in ../schema/process-ir.v1.schema.json is the source of truth
 * (it is what the generating model is constrained by). These types mirror it
 * 1:1 so downstream generators (BPMN, spec kit, dev plan) get static typing.
 * `test/types.test.ts` keeps the two in sync: typed literals must pass the
 * schema, and the schema's enums must equal the constants exported here.
 */

export type Id = string;

export type ProvenanceStatus = "stated" | "inferred" | "assumed";

export interface Provenance {
  status: ProvenanceStatus;
  source?: string;
  confidence?: number;
}

export type Extensions = Record<`x-${string}`, unknown>;

export interface ProcessMeta {
  id: Id;
  name: string;
  description?: string;
  goal?: string;
  domain?: string;
  provenance?: Provenance;
}

export type LaneKind = "human" | "system" | "external";

export interface Lane {
  id: Id;
  name: string;
  kind: LaneKind;
  description?: string;
  provenance?: Provenance;
}

export type Sensitivity = "public" | "internal" | "confidential" | "pii" | "payment";

/** A JSON Schema (draft 2020-12) object. Kept loose on purpose; validated by the data.schema-invalid rule. */
export type JsonSchema = Record<string, unknown>;

export interface DataObject {
  id: Id;
  name: string;
  description?: string;
  schema?: JsonSchema;
  states?: string[];
  sensitivity?: Sensitivity;
  provenance?: Provenance;
}

export interface DataRefs {
  reads?: Id[];
  writes?: Id[];
}

export interface DataWrites {
  writes?: Id[];
}

export interface AcceptanceCriterion {
  id: string; // AC-<n>, unique within the node
  given: string;
  when: string;
  then: string;
  tags?: string[];
}

export interface Integration {
  system: string;
  /** Optional link to the lane (usually kind external/system) that represents this system. */
  lane?: Id;
  operation?: string;
  direction?: "outbound" | "inbound" | "both";
  protocol?: string;
  description?: string;
}

export type ConditionLanguage = "natural" | "cel" | "javascript";

export interface Condition {
  expression: string;
  language?: ConditionLanguage;
  description?: string;
}

export interface DataContract {
  carries: Id[];
  invariants?: string[];
  description?: string;
}

export type TriggerKind = "none" | "message" | "timer" | "error" | "signal";

export interface EventDefinition {
  kind: TriggerKind;
  detail?: string;
  description?: string;
}

export type EndResultKind = "none" | "terminate" | "error" | "message";

export interface EndResult {
  kind: EndResultKind;
  detail?: string;
  description?: string;
}

interface NodeBase {
  id: Id;
  name: string;
  lane: Id;
  description?: string;
  provenance?: Provenance;
  extensions?: Extensions;
}

export interface StartEvent extends NodeBase {
  type: "startEvent";
  trigger?: EventDefinition; // none | message | timer | signal
  data?: DataWrites;
}

export interface EndEvent extends NodeBase {
  type: "endEvent";
  result?: EndResult;
}

export interface IntermediateCatchEvent extends NodeBase {
  type: "intermediateCatchEvent";
  trigger: EventDefinition; // message | timer | signal
  data?: DataRefs;
}

export interface BoundaryEvent extends NodeBase {
  type: "boundaryEvent";
  attached_to: Id;
  trigger: EventDefinition; // error | timer | message | signal
  interrupting?: boolean; // default true
  data?: DataWrites;
}

export const TASK_TYPES = [
  "userTask",
  "serviceTask",
  "scriptTask",
  "sendTask",
  "receiveTask",
  "manualTask",
  "businessRuleTask"
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export interface Task extends NodeBase {
  type: TaskType;
  data?: DataRefs;
  acceptance_criteria?: AcceptanceCriterion[];
  integration?: Integration;
}

export const GATEWAY_TYPES = ["exclusiveGateway", "parallelGateway", "inclusiveGateway"] as const;
export type GatewayType = (typeof GATEWAY_TYPES)[number];
export type GatewayDirection = "split" | "join";

export interface Gateway extends NodeBase {
  type: GatewayType;
  direction: GatewayDirection;
  pairs_with?: Id;
}

export type EventNode = StartEvent | EndEvent | IntermediateCatchEvent | BoundaryEvent;
export type Node = EventNode | Task | Gateway;
export type NodeType = Node["type"];

export interface Edge {
  id: Id;
  from: Id;
  to: Id;
  name?: string;
  condition?: Condition;
  is_default?: boolean;
  data_contract: DataContract;
  provenance?: Provenance;
  extensions?: Extensions;
}

export type NfrCategory =
  | "performance"
  | "security"
  | "compliance"
  | "reliability"
  | "scalability"
  | "usability"
  | "observability"
  | "cost"
  | "other";

export interface NonFunctionalRequirement {
  id: Id;
  category: NfrCategory;
  statement: string;
  applies_to?: Id[];
  provenance?: Provenance;
}

export interface Assumption {
  id: Id;
  statement: string;
  affects?: Id[];
  confidence?: number;
  confirmed?: boolean;
}

export interface OpenQuestion {
  id: Id;
  question: string;
  affects?: Id[];
  answered?: boolean;
  answer?: string;
}

export interface Requirements {
  non_functional?: NonFunctionalRequirement[];
  assumptions?: Assumption[];
  open_questions?: OpenQuestion[];
}

export interface ProcessIR {
  ir_version: "1.0";
  process: ProcessMeta;
  lanes: Lane[];
  data_objects: DataObject[];
  nodes: Node[];
  edges: Edge[];
  requirements?: Requirements;
  extensions?: Extensions;
}

// ---- type guards -----------------------------------------------------------

export function isTask(n: Node): n is Task {
  return (TASK_TYPES as readonly string[]).includes(n.type);
}

export function isGateway(n: Node): n is Gateway {
  return (GATEWAY_TYPES as readonly string[]).includes(n.type);
}

export function isEvent(n: Node): n is EventNode {
  return !isTask(n) && !isGateway(n);
}

export function isSplit(n: Node): n is Gateway & { direction: "split" } {
  return isGateway(n) && n.direction === "split";
}

export function isJoin(n: Node): n is Gateway & { direction: "join" } {
  return isGateway(n) && n.direction === "join";
}

/** Human-friendly kind label used in messages. */
export function nodeKind(n: Node): string {
  if (isGateway(n)) return `${n.type} (${n.direction})`;
  return n.type;
}

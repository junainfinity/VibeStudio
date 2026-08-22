# @vibestudio/speckit

Process IR → everything an implementing agent reads:

- `generateSpecKit(ir)` — `constitution.md`, `spec.md`, `plan.md`, `contracts/edge-<id>.md` per edge plus a `contracts/README.md` index. Deterministic, markdown-injection-hardened (hostile names cannot break headings or tables).
- `generateGraphPlan(ir)` — the machine-readable build plan: one self-contained work packet per task (input/output contracts with embedded JSON Schemas, acceptance criteria, integration), loops with exit conditions, and a gateway routing table (routing belongs to the orchestrator, never to tasks).
- `renderGraphPlanMarkdown(ir)` — the same plan for humans.

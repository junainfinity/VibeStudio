# @vibestudio/bpmn

Process IR → BPMN 2.0 XML, with a deterministic layered layout emitting BPMNDI (swim-lanes, boundary events on the host border, loop edges routed below the lanes). Runtime dependency-free; bpmn-moddle is used only in tests to verify the output parses cleanly.

- `toBpmnXml(ir, opts?)` — semantic BPMN XML (no DI)
- `irToBpmn(ir, opts?)` — XML including DI, ready for bpmn-js `importXML`
- `computeLayout(ir, includeDataObjects)` — the raw geometry, exported for tooling

`bpmn-auto-layout` was probed first and dropped: it emits no lane shapes. The custom layout is tractable because the IR guarantees tasks are 1-in/1-out and blocks are well-nested (see `docs/process-ir-v1.md` §5).

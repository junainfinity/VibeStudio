/**
 * The checkout example is the rich case: 3 lanes, 6 data objects, a boundary
 * event, a parallel block, 3 XOR gateways and a retry loop. These tests pin
 * down the documented file set, the per-file content obligations, and the
 * whole-kit hygiene invariants.
 */
import { describe, expect, it } from "vitest";
import { isTask, type Task } from "@vibestudio/ir";
import { generateSpecKit } from "../src/index.js";
import { countOccurrences, expectKitInvariants, fileByPath, loadExample, sectionOf } from "./helpers.js";

const ir = loadExample("checkout.ir.json");
const kit = generateSpecKit(ir);
const tasks: Task[] = ir.nodes.filter(isTask);

describe("checkout: file set", () => {
  it("produces exactly 4 + number-of-edges files", () => {
    expect(kit.files.length).toBe(4 + ir.edges.length);
  });

  it("orders files: constitution, spec, plan, then contracts sorted by path", () => {
    const contractPaths = [...ir.edges.map((e) => `contracts/edge-${e.id}.md`), "contracts/README.md"].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    expect(kit.files.map((f) => f.path)).toEqual(["constitution.md", "spec.md", "plan.md", ...contractPaths]);
    // README.md (uppercase R) sorts ahead of the lowercase edge- prefix, so the index leads.
    expect(kit.files[3]!.path).toBe("contracts/README.md");
  });

  it("indexes every contract in contracts/README.md", () => {
    const index = fileByPath(kit, "contracts/README.md").content;
    for (const edge of ir.edges) {
      expect(index).toContain(`[${edge.id}](./edge-${edge.id}.md)`);
    }
    expect(index).toContain("[e-start](./edge-e-start.md) — Customer clicks Checkout (start-checkout) -> Review cart (cart-review); carries Cart (cart)");
  });

  it("satisfies the kit-wide hygiene invariants", () => {
    expectKitInvariants(ir, kit);
  });
});

describe("checkout: constitution.md", () => {
  const constitution = fileByPath(kit, "constitution.md").content;

  it("leads with the process name and goal", () => {
    expect(constitution).toContain(`# ${ir.process.name}`);
    expect(constitution).toContain(ir.process.goal!);
    expect(constitution).toContain(`Domain: ${ir.process.domain!}`);
  });

  it("lists all 3 lanes with their kinds", () => {
    for (const lane of ir.lanes) {
      expect(constitution).toContain(`**${lane.name}** (${lane.id}, ${lane.kind})`);
    }
  });

  it("groups ground rules by category and shows only existing categories", () => {
    expect(constitution).toContain("## Ground rules");
    expect(constitution).toContain("### Compliance");
    expect(constitution).toContain("### Performance");
    expect(constitution).not.toContain("### Security");
    expect(constitution).toContain("(nfr-pci)");
    expect(constitution).toContain("(nfr-validate-latency)");
  });

  it("marks the assumption as confirmed", () => {
    expect(constitution).toContain("## Standing assumptions");
    expect(constitution).toContain("**asm-single-currency** (confirmed)");
  });
});

describe("checkout: spec.md", () => {
  const spec = fileByPath(kit, "spec.md").content;

  it("has an H2 for every task node", () => {
    for (const task of tasks) {
      expect(countOccurrences(spec, `## ${task.name} (${task.id})`)).toBe(1);
    }
  });

  it("contains every acceptance criterion (id and content)", () => {
    for (const task of tasks) {
      for (const criterion of task.acceptance_criteria ?? []) {
        expect(spec).toContain(`| ${criterion.id} |`);
        expect(spec).toContain(criterion.given);
        expect(spec).toContain(criterion.then);
      }
    }
  });

  it("shows lane, type, reads and writes for a task", () => {
    expect(spec).toContain("- Lane: Customer (human)");
    expect(spec).toContain("- Type: userTask");
    expect(spec).toContain("- Reads: Order (order), Payment Intent (payment-intent)");
    expect(spec).toContain("- Writes: Payment Result (payment-result)");
  });

  it("documents integrations on the tasks that have them", () => {
    expect(spec).toContain("- System: Stripe");
    expect(spec).toContain("- Operation: paymentIntents.create");
    expect(spec).toContain("- Protocol: https");
  });

  it("lists every exclusive split under Decisions with conditions and work targets", () => {
    const decisions = sectionOf(spec, "Decisions");
    expect(decisions).toContain("### Cart valid? (gw-valid)");
    expect(decisions).toContain("### Payment approved? (gw-paid)");
    // The retry branch targets a merge gateway; the spec must name the work
    // behind it, not the gateway.
    expect(decisions).toContain("**declined, retry** — condition: `payment_result.status == 'declined' && order.payment_attempts < 3` (javascript) → Initiate payment (payment-init)");
    expect(decisions).toContain("**rejected** — default → Checkout rejected (end-checkout-rejected)");
  });

  it("lists every event with trigger/result detail", () => {
    const events = sectionOf(spec, "Events");
    expect(events).toContain("**Customer clicks Checkout** (start-checkout) — start event; trigger: message (checkout.requested)");
    expect(events).toContain("**Payment provider error** (end-payment-error) — end event; result: error (PROVIDER_UNAVAILABLE)");
    expect(events).toContain(
      "**Provider unavailable** (payment-provider-error) — interrupting boundary event on Initiate payment (payment-init); trigger: error (PROVIDER_UNAVAILABLE)"
    );
  });
});

describe("checkout: plan.md", () => {
  const plan = fileByPath(kit, "plan.md").content;
  const buildOrder = sectionOf(plan, "Build order");

  it("contains every task exactly once in the build order", () => {
    for (const task of tasks) {
      expect(countOccurrences(buildOrder, `**${task.name}** (${task.id})`)).toBe(1);
    }
  });

  it("respects dependency order for known pairs", () => {
    const at = (id: string): number => buildOrder.indexOf(`(${id})`);
    expect(at("cart-review")).toBeGreaterThanOrEqual(0);
    expect(at("cart-review")).toBeLessThan(at("payment-init"));
    expect(at("checkout-validate")).toBeLessThan(at("order-confirm"));
    expect(at("order-confirm")).toBeLessThan(at("send-receipt"));
  });

  it("names input/output contracts in terms of work nodes, looking through gateways", () => {
    // payment-init's input edge comes from the XOR retry merge; the plan must
    // name the tasks behind the merge instead.
    expect(buildOrder).toContain("- Input from Validate checkout (checkout-validate), Authorize payment (payment-authorize): Order (order)");
    expect(buildOrder).toContain("- Output to Authorize payment (payment-authorize): Order (order), Payment Intent (payment-intent)");
  });

  it("lists integrations with the task that uses them", () => {
    const integrations = sectionOf(plan, "Integrations");
    expect(integrations).toContain("**Stripe** — operation: paymentIntents.create; direction: outbound; protocol: https — used by Initiate payment (payment-init)");
    expect(integrations).toContain("used by Send receipt (send-receipt)");
  });

  it("maps NFRs to resolved names (nodes and data objects)", () => {
    const nfrs = sectionOf(plan, "Non-functional requirements");
    expect(nfrs).toContain("**nfr-pci** (compliance)");
    expect(nfrs).toContain("Applies to: Initiate payment (payment-init), Authorize payment (payment-authorize), Payment Intent (payment-intent), Payment Result (payment-result)");
  });

  it("omits the open-questions section because the only question is answered", () => {
    expect(plan).not.toContain("## Open questions");
  });
});

describe("checkout: contracts/", () => {
  it("has one file per edge naming every carried data object", () => {
    for (const edge of ir.edges) {
      const contract = fileByPath(kit, `contracts/edge-${edge.id}.md`).content;
      for (const id of edge.data_contract.carries) {
        const dataObject = ir.data_objects.find((d) => d.id === id)!;
        expect(contract, `${edge.id} must name ${id}`).toContain(`${dataObject.name} (${dataObject.id})`);
      }
    }
  });

  it("renders the order schema as a pretty-printed json block", () => {
    const contract = fileByPath(kit, "contracts/edge-e-validate-gw.md").content;
    expect(contract).toContain("```json");
    // 2-space pretty print: nested properties sit at a predictable indent.
    expect(contract).toContain('    "payment_attempts": {');
    expect(contract).toContain('      "type": "integer",');
  });

  it("titles contracts with node names and annotates gateway endpoints with work", () => {
    const contract = fileByPath(kit, "contracts/edge-e-valid-yes.md").content;
    expect(contract).toContain("# Contract: Cart valid? (gw-valid) -> Payment attempt (gw-retry-merge)");
    expect(contract).toContain("- From work: Validate checkout (checkout-validate) — via gateway Cart valid? (gw-valid)");
    expect(contract).toContain("- To work: Initiate payment (payment-init) — via gateway Payment attempt (gw-retry-merge)");
    expect(contract).toContain("- Name: valid");
    expect(contract).toContain("- Condition: `order.status == 'validated'` (javascript)");
  });

  it("renders edge metadata and invariants when present", () => {
    const contract = fileByPath(kit, "contracts/edge-e-start.md").content;
    expect(contract).toContain("## Invariants");
    expect(contract).toContain("- cart.status == 'open'");
    const defaultBranch = fileByPath(kit, "contracts/edge-e-valid-no.md").content;
    expect(defaultBranch).toContain("- Default branch: yes");
  });
});

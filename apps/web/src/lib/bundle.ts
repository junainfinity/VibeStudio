/**
 * Assembles the output bundle: every artifact the confirmed IR projects to,
 * plus the human cover page. All of it is generated client-side; the zip is
 * built with jszip and handed to the browser as a download.
 */
import JSZip from "jszip";
import { irToBpmn } from "@vibestudio/bpmn";
import type { ProcessIR } from "@vibestudio/ir";
import { generateGraphPlan, generateProcessNotes, generateSpecKit, renderGraphPlanMarkdown } from "@vibestudio/speckit";
import { renderDiagramSvg } from "./diagramSvg";
import { renderReadmeHtml, type BundleFileInfo } from "./readmeHtml";

export interface BundleFile {
  path: string;
  content: string;
  info: BundleFileInfo;
}

export interface Bundle {
  folder: string;
  files: BundleFile[];
}


export async function buildBundle(ir: ProcessIR, irText: string, description: string): Promise<Bundle> {
  const xml = await irToBpmn(ir);
  const svg = renderDiagramSvg(ir, { standalone: true });
  const kit = generateSpecKit(ir);
  const plan = generateGraphPlan(ir);
  const planMd = renderGraphPlanMarkdown(ir);
  const notes = generateProcessNotes(ir);

  const files: BundleFile[] = [];
  const add = (path: string, content: string, what: string, audience: BundleFileInfo["audience"]) =>
    files.push({ path, content, info: { path, what, audience } });

  add("process.ir.json", irText.trim() + "\n", "The validated process description — the single source of truth everything else is generated from", "Your AI agent");
  add("process.bpmn", xml, "The process as a standard BPMN 2.0 diagram file — opens in Camunda, Signavio, bpmn.io and most process tools", "BPMN tools");
  add("diagram.svg", svg, "The diagram as an image — open it in any browser to see your process", "You");
  for (const f of kit.files) {
    add(
      `speckit/${f.path}`,
      f.content,
      f.path === "constitution.md"
        ? "The ground rules: who the actors are, what must always hold"
        : f.path === "spec.md"
          ? "The specification: every step of work with its definition of done"
          : f.path === "plan.md"
            ? "The build plan in human-readable form"
            : "Data contract for one flow between steps",
      "Your AI agent"
    );
  }
  add("plan/graph-plan.json", JSON.stringify(plan, null, 2) + "\n", "The machine-readable build plan: work packets with contracts, loops with exit conditions, gateway routing", "Your AI agent");
  add("plan/graph-plan.md", planMd, "The same build plan, readable by people", "You");
  add("notes/troubleshooting.md", notes.troubleshooting, "Symptom → where to look. The builder fills in exact files as it codes", "You");
  add("notes/codebase.md", notes.codebase, "Plain-words map of the code, written by the builder step by step", "You");

  const infoList: BundleFileInfo[] = [
    { path: "README.html", what: "This cover page — what you stated, what you got, what to do with it", audience: "You" },
    ...files.map((f) => f.info)
  ];
  const readme = renderReadmeHtml(ir, description, infoList);
  files.unshift({ path: "README.html", content: readme, info: infoList[0]! });

  return { folder: ir.process.id, files };
}

export async function zipBundle(bundle: Bundle): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(bundle.folder)!;
  for (const f of bundle.files) root.file(f.path, f.content);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

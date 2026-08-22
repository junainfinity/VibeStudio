/**
 * VibeStudio's own BPMN-style SVG renderer.
 *
 * The geometry comes straight from @vibestudio/bpmn's computeLayout — the same
 * coordinates that drive the exported .bpmn file — so what the person confirms
 * on screen is exactly what their tools will see. Rendering it ourselves (and
 * not embedding a viewer library) keeps the page free of third-party chrome,
 * lets the diagram match the app's design, and produces a standalone
 * diagram.svg for the bundle from the identical code path.
 */
import { computeLayout } from "@vibestudio/bpmn";
import { isGateway, isTask, type Gateway, type Node, type ProcessIR } from "@vibestudio/ir";

const STROKE = "#3a4a40";
const DIM = "#7c8a80";
const LANE_BORDER = "#dfe5df";
const LANE_HEADER = "#f1f5f1";
const FILL = "#ffffff";
const BG = "#fcfdfc";
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Greedy word wrap by character budget; last line ellipsized when over. */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > perLine) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.slice(0, perLine - 1)}…`;
    return kept;
  }
  return lines;
}

function tspans(lines: string[], x: number, firstY: number, lineHeight: number): string {
  return lines.map((l, i) => `<tspan x="${x}" y="${firstY + i * lineHeight}">${esc(l)}</tspan>`).join("");
}

function gatewayMark(n: Gateway, cx: number, cy: number): string {
  if (n.type === "parallelGateway")
    return `<path d="M ${cx - 9} ${cy} H ${cx + 9} M ${cx} ${cy - 9} V ${cy + 9}" stroke="${STROKE}" stroke-width="3" fill="none"/>`;
  if (n.type === "inclusiveGateway") return `<circle cx="${cx}" cy="${cy}" r="8" stroke="${STROKE}" stroke-width="2.5" fill="none"/>`;
  return `<path d="M ${cx - 7} ${cy - 7} L ${cx + 7} ${cy + 7} M ${cx + 7} ${cy - 7} L ${cx - 7} ${cy + 7}" stroke="${STROKE}" stroke-width="2.5" fill="none"/>`;
}

function nodeSvg(n: Node, r: { x: number; y: number; width: number; height: number }): string {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const parts: string[] = [];

  if (isTask(n)) {
    parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="9" fill="${FILL}" stroke="${STROKE}" stroke-width="1.6"/>`);
    const lines = wrap(n.name, 15, 3);
    const firstY = cy - ((lines.length - 1) * 14) / 2 + 4;
    parts.push(`<text text-anchor="middle" font-size="12" font-weight="500" fill="${STROKE}">${tspans(lines, cx, firstY, 14)}</text>`);
    return parts.join("");
  }

  if (isGateway(n)) {
    const h = r.width / 2;
    parts.push(
      `<path d="M ${cx} ${r.y} L ${r.x + r.width} ${cy} L ${cx} ${r.y + r.height} L ${r.x} ${cy} Z" fill="${FILL}" stroke="${STROKE}" stroke-width="1.6"/>`,
      gatewayMark(n, cx, cy)
    );
  } else {
    // events
    const radius = r.width / 2;
    const thick = n.type === "endEvent" ? 3.5 : 1.6;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${FILL}" stroke="${STROKE}" stroke-width="${thick}"/>`);
    if (n.type === "intermediateCatchEvent" || n.type === "boundaryEvent") {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${radius - 3.5}" fill="none" stroke="${STROKE}" stroke-width="1.3"/>`);
    }
  }
  // label under the shape
  const lines = wrap(n.name, 16, 2);
  parts.push(
    `<text text-anchor="middle" font-size="10.5" fill="${DIM}">${tspans(lines, cx, r.y + r.height + 13, 12)}</text>`
  );
  return parts.join("");
}

export function renderDiagramSvg(ir: ProcessIR, opts: { standalone?: boolean } = {}): string {
  const layout = computeLayout(ir, false);
  const nodesById = new Map(ir.nodes.map((n) => [n.id, n] as const));
  const edgesById = new Map(ir.edges.map((e) => [e.id, e] as const));

  const width = Math.max(...layout.laneShapes.map((l) => l.rect.x + l.rect.width)) + 20;
  const height = Math.max(...layout.laneShapes.map((l) => l.rect.y + l.rect.height)) + 40;

  const parts: string[] = [];
  parts.push(`<rect x="-10" y="-10" width="${width + 20}" height="${height + 20}" fill="${BG}"/>`);

  // lanes: band + header strip + rotated name
  for (const lane of layout.laneShapes) {
    const l = ir.lanes.find((x) => x.id === lane.id);
    const r = lane.rect;
    parts.push(
      `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="${LANE_BORDER}" stroke-width="1.4"/>`,
      `<rect x="${r.x}" y="${r.y}" width="30" height="${r.height}" fill="${LANE_HEADER}" stroke="${LANE_BORDER}" stroke-width="1.4"/>`,
      `<text transform="rotate(-90 ${r.x + 19} ${r.y + r.height / 2})" x="${r.x + 19}" y="${r.y + r.height / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${DIM}">${esc(l?.name ?? lane.id)}</text>`
    );
  }

  // edges under nodes
  for (const e of layout.edgeWaypoints) {
    const edge = edgesById.get(e.id);
    const pts = e.waypoints.map((p) => `${p.x},${p.y}`).join(" ");
    parts.push(`<polyline points="${pts}" fill="none" stroke="#55655c" stroke-width="1.5" marker-end="url(#arrow)"/>`);
    if (edge?.is_default) {
      // default-flow slash near the source
      const [a, b] = [e.waypoints[0]!, e.waypoints[1] ?? e.waypoints[0]!];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const mx = a.x + (dx / len) * 12, my = a.y + (dy / len) * 12;
      parts.push(`<path d="M ${mx - 4} ${my + 5} L ${mx + 4} ${my - 5}" stroke="#55655c" stroke-width="1.6"/>`);
    }
    if (edge?.name) {
      // label near the midpoint of the longest segment
      let best = 0, bi = 0;
      for (let i = 0; i < e.waypoints.length - 1; i++) {
        const seg = Math.hypot(e.waypoints[i + 1]!.x - e.waypoints[i]!.x, e.waypoints[i + 1]!.y - e.waypoints[i]!.y);
        if (seg > best) { best = seg; bi = i; }
      }
      const a = e.waypoints[bi]!, b = e.waypoints[bi + 1]!;
      const lx = (a.x + b.x) / 2, ly = (a.y + b.y) / 2 - 6;
      const label = esc(edge.name);
      parts.push(
        `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10.5" fill="${DIM}" paint-order="stroke" stroke="${BG}" stroke-width="3">${label}</text>`
      );
    }
  }

  // nodes on top
  for (const shape of layout.nodeShapes) {
    const n = nodesById.get(shape.id);
    if (n) parts.push(nodeSvg(n, shape.rect));
  }

  const sizing = opts.standalone ? `width="${width}" height="${height}"` : `width="100%" height="100%"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${width + 10} ${height + 30}" ${sizing} font-family="${FONT}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Process diagram for ${esc(ir.process.name)}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#55655c"/></marker></defs>
${parts.join("\n")}
</svg>`;
}

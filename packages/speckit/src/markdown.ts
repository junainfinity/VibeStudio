/**
 * Tiny GitHub-flavored-markdown emission helpers.
 *
 * Every generated file is assembled from "blocks" — arrays of lines with no
 * leading or trailing blank lines. `renderDoc` joins non-empty blocks with a
 * single blank line and enforces the two whole-file invariants the kit
 * promises: no trailing whitespace on any line and exactly one trailing
 * newline. Centralising this here means a section generator can simply return
 * `[]` to omit itself, which is how "degrade gracefully, never print an empty
 * section" is achieved by construction rather than by post-hoc filtering.
 */

export type Block = readonly string[];

/**
 * Join blocks with blank lines; empty blocks vanish, so omitted sections
 * leave no gap. The invariants are enforced on physical lines — block strings
 * may themselves contain newlines (multi-paragraph IR free text), so trailing
 * whitespace is stripped per physical line, runs of blank lines are collapsed
 * to a single blank line, and the file ends with exactly one newline.
 */
export function renderDoc(blocks: ReadonlyArray<Block>): string {
  const joined = blocks
    .filter((b) => b.length > 0)
    .map((b) => b.join("\n"))
    .join("\n\n");
  const stripped = joined
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n");
  return stripped.replace(/\n{3,}/gu, "\n\n").replace(/^\n+/u, "").replace(/\n+$/u, "") + "\n";
}

/**
 * The single inline-text sanitiser: collapse every line-break run (and the
 * whitespace hugging it) to one space, then trim. Every interpolation of IR
 * free text into an ATX heading, a label or a single-line list item routes
 * through this, so no name, statement or condition can ever truncate a
 * heading or break a bullet apart.
 */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/gu, " ").trim();
}

/**
 * Inline code span that survives backticks inside the content: GFM requires
 * the delimiter run to be longer than any run inside the span, and a space of
 * padding when the content starts or ends with a backtick.
 */
export function inlineCode(text: string): string {
  const runs = text.match(/`+/gu);
  const longest = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  const fence = "`".repeat(longest + 1);
  const pad = longest > 0 ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * One-line table cell: newlines collapsed, then backslashes escaped before
 * pipes (in that order — escaping pipes first would let a pre-existing
 * backslash neutralise the escape and split the row).
 */
export function cell(text: string): string {
  return oneLine(text).replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
}

/** A GFM table as lines. Rows are cell-escaped; the header is trusted (we author it). */
export function table(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string[] {
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${row.map(cell).join(" | ")} |`);
  return lines;
}

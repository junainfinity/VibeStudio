/**
 * Shared test utilities: loading the IR package's example documents and the
 * whole-kit invariants every generated file must satisfy regardless of input
 * (banner first, exactly one trailing newline, no forbidden junk strings, no
 * trailing whitespace, no empty sections).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { ProcessIR } from "@vibestudio/ir";
import type { SpecFile, SpecKit } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Parse an example fresh on every call so tests cannot share mutable state. */
export function loadExample(name: string): ProcessIR {
  const path = join(here, "..", "..", "ir", "examples", name);
  return JSON.parse(readFileSync(path, "utf8")) as ProcessIR;
}

export function bannerFor(ir: ProcessIR): string {
  return `<!-- generated from Process IR '${ir.process.id}' v${ir.ir_version} — do not edit by hand -->`;
}

const FORBIDDEN = ["undefined", "null", "[object Object]", "NaN"] as const;

export function expectKitInvariants(ir: ProcessIR, kit: SpecKit): void {
  const banner = bannerFor(ir);
  for (const file of kit.files) {
    expect(file.content.startsWith(`${banner}\n`), `${file.path} must start with the banner`).toBe(true);
    expect(file.content.endsWith("\n"), `${file.path} must end with a newline`).toBe(true);
    expect(file.content.endsWith("\n\n"), `${file.path} must end with exactly one newline`).toBe(false);
    for (const bad of FORBIDDEN) {
      expect(file.content.includes(bad), `${file.path} must not contain '${bad}'`).toBe(false);
    }
    expect(/[ \t]\n/.test(file.content), `${file.path} must have no trailing whitespace`).toBe(false);
    expect(file.content.includes("\n\n\n"), `${file.path} must not contain double blank lines`).toBe(false);
    expectNoEmptySections(file);
  }
}

/**
 * A heading whose next non-blank line is a heading of the same or higher
 * level (or end of file) is an empty section — the generator promises to omit
 * such sections entirely. Fenced code blocks are skipped so JSON content can
 * never masquerade as a heading.
 */
function expectNoEmptySections(file: SpecFile): void {
  const lines = file.content.split("\n");
  let inFence = false;
  const meta = lines.map((raw) => {
    if (/^```/.test(raw)) {
      inFence = !inFence;
      return { blank: false, level: 0 };
    }
    if (inFence) return { blank: false, level: 0 };
    const heading = /^(#{1,6}) /.exec(raw);
    return { blank: raw.trim() === "", level: heading ? heading[1]!.length : 0 };
  });
  for (let i = 0; i < meta.length; i++) {
    const cur = meta[i]!;
    if (cur.level === 0) continue;
    let j = i + 1;
    while (j < meta.length && meta[j]!.blank) j++;
    const next = meta[j];
    const empty = next === undefined || (next.level > 0 && next.level <= cur.level);
    expect(empty, `${file.path}: empty section under '${lines[i]}'`).toBe(false);
  }
}

export function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Slice out one `## <title>` section (up to the next H2 or end of file). */
export function sectionOf(content: string, title: string): string {
  const start = content.indexOf(`## ${title}`);
  expect(start, `section '## ${title}' must exist`).toBeGreaterThanOrEqual(0);
  const rest = content.slice(start);
  const end = rest.indexOf("\n## ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

export function fileByPath(kit: SpecKit, path: string): SpecFile {
  const file = kit.files.find((f) => f.path === path);
  expect(file, `kit must contain ${path}`).toBeDefined();
  return file!;
}

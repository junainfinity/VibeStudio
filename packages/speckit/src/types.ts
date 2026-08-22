/**
 * Public shape of a generated spec kit. Files are plain path/content pairs so
 * the caller decides what "writing" means (disk, zip, in-browser preview) —
 * the generator itself never touches the filesystem, which also keeps it
 * usable in the browser build of the studio.
 */

export interface SpecFile {
  /** Path relative to the kit root, always with forward slashes. */
  path: string;
  content: string;
}

export interface SpecKit {
  /**
   * Stable order: constitution.md, spec.md, plan.md, then contracts/* sorted
   * by path (code-unit order) — contracts/README.md first, then one
   * contracts/edge-<edge-id>.md per edge. The `edge-` prefix guarantees no
   * schema-valid edge id (lowercase kebab-case, e.g. 'readme') can collide
   * with README.md when the kit is written to a case-insensitive filesystem.
   * Consumers may rely on this order for rendering and diffing.
   */
  files: SpecFile[];
}

/**
 * Deterministic XML serialisation primitives.
 *
 * WHY hand-rolled rather than an XML library: the transformer's contract is
 * byte-identical output for identical input on any machine (downstream tools
 * diff and cache the generated BPMN), and the document we emit is small and
 * fully under our control. A tiny writer with explicit attribute ORDER
 * (arrays of pairs, never object-key iteration) removes the usual sources of
 * non-determinism — key enumeration order and serializer version drift — and
 * keeps the package dependency-free at runtime.
 */

/**
 * Characters the XML 1.0 `Char` production forbids entirely (the C0 controls
 * minus TAB/LF/CR). They cannot be represented in an XML 1.0 document at all
 * — not even as character references — so they are STRIPPED. They reach us
 * legally: JSON permits them, so an IR Name/Description containing e.g. a
 * BEL from an LLM's \u0007 escape passes schema validation.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function stripAndEscapeMarkup(value: string): string {
  return value
    .replace(ILLEGAL_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Escape a string for XML TEXT content: markup metacharacters (& < > " ')
 * become entities, XML-1.0-illegal control characters are stripped, and CR is
 * numerically escaped (a conforming parser would otherwise fold a literal CR
 * into LF during line-ending normalization). Literal newlines and tabs are
 * kept — text content preserves them as-is.
 */
export function escapeXml(value: string): string {
  return stripAndEscapeMarkup(value).replace(/\r/g, "&#13;");
}

/**
 * Escape a string for an ATTRIBUTE value: everything {@link escapeXml} does,
 * plus numeric escapes for newline (&#10;) and tab (&#9;). Attribute-value
 * normalization (XML 1.0 §3.3.3) turns raw whitespace in attributes into
 * spaces on every conforming parse, which would silently rewrite multi-line
 * names on interchange; character references survive normalization intact.
 */
export function escapeXmlAttribute(value: string): string {
  return escapeXml(value).replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
}

/**
 * Attribute list as ordered pairs. An object would serialise in property
 * insertion order, which is easy to perturb accidentally; a tuple array makes
 * the emission order part of the call site.
 */
export type Attrs = ReadonlyArray<readonly [name: string, value: string | number | boolean]>;

/** Mutable variant for call sites that build the list conditionally. */
export type AttrList = Array<readonly [name: string, value: string | number | boolean]>;

/** Line-oriented writer producing 2-space-indented XML with a fixed prolog. */
export class XmlWriter {
  private readonly lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  private depth = 0;

  private indent(): string {
    return "  ".repeat(this.depth);
  }

  private renderAttrs(attrs: Attrs): string {
    return attrs.map(([name, value]) => ` ${name}="${escapeXmlAttribute(String(value))}"`).join("");
  }

  /** Open `<tag …>` and indent what follows. */
  open(tag: string, attrs: Attrs = []): void {
    this.lines.push(`${this.indent()}<${tag}${this.renderAttrs(attrs)}>`);
    this.depth += 1;
  }

  /** Close `</tag>`. */
  close(tag: string): void {
    this.depth -= 1;
    this.lines.push(`${this.indent()}</${tag}>`);
  }

  /** Self-closing `<tag … />`. */
  leaf(tag: string, attrs: Attrs = []): void {
    this.lines.push(`${this.indent()}<${tag}${this.renderAttrs(attrs)} />`);
  }

  /** `<tag …>text</tag>` on one line; the text is escaped, never re-indented. */
  textElement(tag: string, text: string, attrs: Attrs = []): void {
    this.lines.push(
      `${this.indent()}<${tag}${this.renderAttrs(attrs)}>${escapeXml(text)}</${tag}>`
    );
  }

  toString(): string {
    return this.lines.join("\n") + "\n";
  }
}

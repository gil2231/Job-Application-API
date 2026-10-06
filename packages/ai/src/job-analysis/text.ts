const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", bull: "•", hellip: "…" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Convert job-description HTML to plain text, keeping list items and headings
 * on their own lines so section parsing still works. Plain text passes through.
 */
export function htmlToText(input: string): string {
  let text = input;
  // Greenhouse returns HTML that is itself entity-escaped.
  if (/&lt;\/?(p|div|li|ul|br|h\d|strong)\b/i.test(text)) text = decodeEntities(text);
  if (!/<\/?[a-z][^>]*>/i.test(text)) return normalizeWhitespace(decodeEntities(text));
  text = text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|ul|ol|h\d|tr|section|header)>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<h\d[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return normalizeWhitespace(decodeEntities(text));
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0 ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex matching a term as a whole word. Handles terms that start or end with
 * symbols (C++, C#, .NET, Node.js) where \b would not work.
 */
export function termPattern(term: string, flags = "i"): RegExp {
  const escaped = escapeRegExp(term.trim()).replace(/\s+/g, "[\\s-]+");
  return new RegExp(`(?<![A-Za-z0-9+#.])${escaped}(?![A-Za-z0-9+#])`, flags);
}

/** The sentence (or bullet) containing a match, trimmed for display. */
export function sentenceAround(text: string, index: number, max = 240): string {
  const before = text.lastIndexOf("\n", index);
  const sentenceStart = Math.max(before, text.lastIndexOf(". ", index) + 1, 0);
  let end = text.length;
  for (const stop of ["\n", ". "]) {
    const i = text.indexOf(stop, index);
    if (i !== -1 && i < end) end = i + (stop === ". " ? 1 : 0);
  }
  const sentence = text.slice(sentenceStart, end).replace(/^[\s•*-]+/, "").trim();
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

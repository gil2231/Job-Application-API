/**
 * Matching a question on a form to a differently worded question the user has
 * already answered in their Answer Library. Deterministic, and deliberately
 * strict: a near miss is worse than asking, so names, places and numbers in
 * either question must appear in both ("authorized to work in the US" never
 * matches "authorized to work in Canada").
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "at", "by", "with", "from", "as", "is", "are", "was", "were", "be", "been",
  "do", "does", "did", "you", "your", "yours", "we", "our", "us", "this", "that", "these", "those", "it", "its", "if", "so", "please",
  "what", "which", "who", "whom", "how", "when", "where", "why", "any", "have", "has", "had", "will", "would", "can", "could", "should",
  "may", "might", "i", "me", "my", "am", "about", "into", "currently", "now", "ever", "there", "here", "describe", "tell", "briefly",
]);

/** Words that change a question's meaning even when everything else matches. */
const MEANING_WORDS = new Set(["not", "no", "never", "future", "previously", "former", "current", "ever", "before", "after", "without", "other"]);

const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "") || w;

interface Tokens {
  content: Set<string>;
  /** Capitalized words past the first, acronyms and numbers: must match exactly. */
  anchors: Set<string>;
  meaning: Set<string>;
}

function tokenize(text: string): Tokens {
  const raw = text.replace(/\((required|optional)\)/gi, " ").replace(/[*✱?:]/g, " ").split(/[^A-Za-z0-9%$+#]+/).filter(Boolean);
  const content = new Set<string>();
  const anchors = new Set<string>();
  const meaning = new Set<string>();
  raw.forEach((word, i) => {
    const lower = word.toLowerCase();
    if (/\d/.test(word) || /^[A-Z]{2,}$/.test(word) || (i > 0 && /^[A-Z][a-z]/.test(word) && !STOPWORDS.has(lower))) anchors.add(lower);
    if (MEANING_WORDS.has(lower)) meaning.add(lower);
    if (!STOPWORDS.has(lower)) content.add(stem(lower));
  });
  return { content, anchors, meaning };
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Dice similarity of two questions' content words, 0..1; 0 when their anchors or negations differ. */
export function questionSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.content.size || !tb.content.size) return 0;
  if (!sameSet(ta.anchors, tb.anchors) || !sameSet(ta.meaning, tb.meaning)) return 0;
  let shared = 0;
  for (const t of ta.content) if (tb.content.has(t)) shared++;
  return (2 * shared) / (ta.content.size + tb.content.size);
}

export interface SimilarAnswer<T> {
  answer: T;
  /** 0..1 */
  score: number;
}

/**
 * The saved answer whose question best matches this label, when the match is
 * close enough to suggest. Sensitive answers are only ever used by exact key.
 */
export function findSimilarAnswer<T extends { question: string; answer: string; isSensitive?: boolean }>(label: string, library: T[], minScore = 0.75): SimilarAnswer<T> | null {
  let best: SimilarAnswer<T> | null = null;
  for (const entry of library) {
    if (entry.isSensitive || !entry.answer.trim()) continue;
    const score = questionSimilarity(label, entry.question);
    if (score >= minScore && (!best || score > best.score)) best = { answer: entry, score };
  }
  return best;
}

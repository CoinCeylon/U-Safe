// Duplicate suggestions for the file-complaint form (M059).
//
// Before the final submit step, the new description is compared with the
// open complaints of the same university using a simple token-overlap
// score computed entirely in the browser. The typed text and the scores
// never leave the student's device.
//
// The score is the Jaccard overlap of the token sets: shared tokens divided
// by the union. A match must score strictly above SIMILARITY_THRESHOLD to
// surface, and at most MAX_DUPLICATE_SUGGESTIONS complaints are shown.

/** A complaint whose description text the browser can read locally. */
export interface ComplaintText {
  id: string;
  text: string;
}

export const SIMILARITY_THRESHOLD = 0.5;
export const MAX_DUPLICATE_SUGGESTIONS = 3;

// Common English function words. Without this list, two unrelated
// descriptions that merely share "the", "a" or "to" would look similar.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from',
  'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'my',
  'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them',
  'they', 'this', 'to', 'was', 'we', 'were', 'will', 'with', 'you', 'your',
]);

/**
 * Splits a description into lowercase word tokens, ignoring punctuation,
 * one-character fragments and stopwords.
 */
export function tokenizeDescription(description: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of description.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length >= 2 && !STOPWORDS.has(token)) {
      tokens.add(token);
    }
  }
  return tokens;
}

/**
 * Token-overlap score between two token sets: the size of their
 * intersection divided by the size of their union. Empty sets never match.
 */
export function tokenOverlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (a.size + b.size - intersection);
}

/**
 * Returns the complaints whose description scores strictly above the
 * threshold, most similar first, at most MAX_DUPLICATE_SUGGESTIONS.
 * Ties are broken by complaint id so the list is stable.
 */
export function findSimilarComplaints<T extends ComplaintText>(
  description: string,
  corpus: T[],
): Array<T & { score: number }> {
  const query = tokenizeDescription(description);
  if (query.size === 0) {
    return [];
  }

  const scored: Array<T & { score: number }> = [];
  for (const entry of corpus) {
    if (entry.text.trim() === '') {
      continue;
    }
    const score = tokenOverlapScore(query, tokenizeDescription(entry.text));
    if (score > SIMILARITY_THRESHOLD) {
      scored.push({ ...entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, MAX_DUPLICATE_SUGGESTIONS);
}

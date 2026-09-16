/**
 * Resolved model ids from the API (e.g. `gpt-4o-2024-08-06`,
 * `claude-sonnet-4-6-20260201`) use dashes and date suffixes, while pricing-table
 * patterns are often transcribed from human-readable marketing names (e.g.
 * `claude-sonnet-4.6`) which use dots. Stripping all non-alphanumeric characters before
 * comparing avoids a silent match failure from formatting mismatch alone. Shared by both
 * the legacy per-request multiplier table and the per-token pricing table so the two
 * don't drift into different matching behavior.
 */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface PatternEntry {
  modelPattern: string;
}

/**
 * Finds the best (longest-pattern) match for a resolved model id among a list of
 * pattern-bearing entries. Longest-first so a more specific entry (e.g. "gpt-4.1") wins
 * over a shorter one that's also a substring (e.g. "gpt-4").
 */
export function findBestMatch<T extends PatternEntry>(resolvedModel: string, entries: readonly T[]): T | null {
  const normalized = normalizeForMatch(resolvedModel);
  const sorted = [...entries].sort((a, b) => b.modelPattern.length - a.modelPattern.length);
  return sorted.find((entry) => normalized.includes(normalizeForMatch(entry.modelPattern))) ?? null;
}

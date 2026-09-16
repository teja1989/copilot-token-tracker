import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface JsonlLine {
  lineNumber: number;
  raw: unknown;
  parseError: string | null;
}

/**
 * Reads a JSONL file line by line. A malformed line is reported as a `parseError`
 * entry rather than throwing — one bad line (e.g. a partially-flushed write while
 * Copilot is still appending to the file) must never take down ingestion for the
 * whole session history.
 */
export async function* readJsonlFile(filePath: string): AsyncGenerator<JsonlLine> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      yield { lineNumber, raw: JSON.parse(trimmed), parseError: null };
    } catch (err) {
      yield { lineNumber, raw: null, parseError: err instanceof Error ? err.message : String(err) };
    }
  }
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonlFile } from '../src/ingest/jsonlSource.js';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample-spans.jsonl');

describe('readJsonlFile', () => {
  it('reads all lines, reporting parse errors without stopping', async () => {
    const lines = [];
    for await (const line of readJsonlFile(fixturePath)) {
      lines.push(line);
    }

    expect(lines).toHaveLength(6);

    const malformed = lines.filter((l) => l.parseError !== null);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.lineNumber).toBe(4);

    const wellFormed = lines.filter((l) => l.parseError === null);
    expect(wellFormed).toHaveLength(5);
  });
});

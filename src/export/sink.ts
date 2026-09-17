/**
 * Where exported documents go. Deliberately minimal and swappable: the wrapper API's
 * actual contract (auth scheme, one-doc-vs-batch, response shape) wasn't decided when
 * this was built — see docs/mongo-team-rollup.md. Swapping HttpBatchSink for whatever
 * the real contract turns out to be is a one-file change; nothing else in the export
 * path knows or cares which sink is in use.
 */
export interface ExportSink {
  send(documents: Record<string, unknown>[]): Promise<void>;
}

/** The default until export is actually configured — sending nowhere is the safe default, not an error. */
export class NullSink implements ExportSink {
  async send(): Promise<void> {
    // intentionally does nothing
  }
}

export interface HttpBatchSinkOptions {
  endpoint: string;
  /** Full header value, e.g. "Bearer xyz" — this module doesn't assume a scheme. */
  authHeader?: string;
  /** Injectable for tests; defaults to the global fetch (Node 18+, available in the extension host). */
  fetchImpl?: typeof fetch;
  /** Chunk size per POST. Not a contract detail from the wrapper API — just a self-imposed cap so one sync cycle after being offline for a while doesn't send one enormous request. */
  maxBatchSize?: number;
}

/**
 * POSTs `{ events: [...] }` per chunk to a single endpoint. This shape is a reasonable
 * default guess, not a confirmed contract — see docs/mongo-team-rollup.md's open
 * decision on the wrapper API. No retry logic here on purpose: a failed chunk throws,
 * the caller (exportManager) doesn't advance its watermark, and the next scheduled sync
 * cycle retries the whole thing. Because every document upserts by spanId, re-sending a
 * chunk that partially succeeded last time is always safe, never a duplicate.
 */
export class HttpBatchSink implements ExportSink {
  constructor(private readonly options: HttpBatchSinkOptions) {}

  async send(documents: Record<string, unknown>[]): Promise<void> {
    const fetchFn = this.options.fetchImpl ?? fetch;
    const maxBatchSize = this.options.maxBatchSize ?? 200;

    for (let i = 0; i < documents.length; i += maxBatchSize) {
      const chunk = documents.slice(i, i + maxBatchSize);
      const response = await fetchFn(this.options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.authHeader ? { authorization: this.options.authHeader } : {})
        },
        body: JSON.stringify({ events: chunk })
      });
      if (!response.ok) {
        throw new Error(`export sink rejected batch (chunk starting at index ${i}): ${response.status} ${response.statusText}`);
      }
    }
  }
}

import { describe, expect, it, vi } from 'vitest';
import { HttpBatchSink, NullSink } from '../src/export/sink.js';

describe('NullSink', () => {
  it('resolves without throwing and without needing a real endpoint', async () => {
    await expect(new NullSink().send([{ a: 1 }])).resolves.toBeUndefined();
  });
});

describe('HttpBatchSink', () => {
  function fakeFetch(responses: Array<{ ok: boolean; status?: number; statusText?: string }>) {
    let call = 0;
    const requests: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
      const r = responses[call++] ?? { ok: true };
      return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), statusText: r.statusText ?? '' } as Response;
    });
    return { fetchImpl, requests };
  }

  it('sends one POST with all documents when under the batch size', async () => {
    const { fetchImpl, requests } = fakeFetch([{ ok: true }]);
    const sink = new HttpBatchSink({ endpoint: 'https://example.test/ingest', authHeader: 'Bearer tok', fetchImpl });
    await sink.send([{ _id: '1' }, { _id: '2' }]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requests[0]?.url).toBe('https://example.test/ingest');
    expect(requests[0]?.headers['authorization']).toBe('Bearer tok');
    expect(requests[0]?.body).toEqual({ events: [{ _id: '1' }, { _id: '2' }] });
  });

  it('chunks into multiple requests when over the configured batch size', async () => {
    const { fetchImpl, requests } = fakeFetch([{ ok: true }, { ok: true }, { ok: true }]);
    const sink = new HttpBatchSink({ endpoint: 'https://example.test/ingest', fetchImpl, maxBatchSize: 2 });
    await sink.send([{ _id: '1' }, { _id: '2' }, { _id: '3' }, { _id: '4' }, { _id: '5' }]);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((requests[0]?.body as { events: unknown[] }).events).toHaveLength(2);
    expect((requests[2]?.body as { events: unknown[] }).events).toHaveLength(1);
  });

  it('throws on a non-ok response and does not attempt subsequent chunks', async () => {
    const { fetchImpl } = fakeFetch([{ ok: true }, { ok: false, status: 503, statusText: 'Service Unavailable' }]);
    const sink = new HttpBatchSink({ endpoint: 'https://example.test/ingest', fetchImpl, maxBatchSize: 1 });

    await expect(sink.send([{ _id: '1' }, { _id: '2' }, { _id: '3' }])).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // stopped after the failing chunk, never attempted the third
  });
});

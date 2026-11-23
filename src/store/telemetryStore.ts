import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { QueryFilter, TelemetryEvent } from '../model/types.js';

export type StoreListener = (added: TelemetryEvent[]) => void;

export class TelemetryStore {
  private events = new Map<string, TelemetryEvent>();
  private listeners = new Set<StoreListener>();
  private persistPath: string | null;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(options?: { persistPath?: string | null }) {
    if (options && 'persistPath' in options) {
      this.persistPath = options.persistPath ?? null;
    } else {
      this.persistPath = join(homedir(), '.agentpulse', 'telemetry.jsonl');
    }
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, 'utf8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ev = JSON.parse(trimmed) as TelemetryEvent;
          if (ev && ev.id) {
            this.events.set(ev.id, ev);
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Ignore read errors on first start
    }
  }

  private scheduleFlush(): void {
    if (!this.persistPath || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, 1000);
    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  public flushNow(): void {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const lines: string[] = [];
      for (const ev of this.events.values()) {
        // Persist all real events (skip simulated so restarts stay clean unless kept)
        if (!ev.isSimulated) {
          lines.push(JSON.stringify(ev));
        }
      }
      writeFileSync(this.persistPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    } catch {
      // Non-fatal persistence error
    }
  }

  public upsert(incoming: TelemetryEvent[]): TelemetryEvent[] {
    const addedOrChanged: TelemetryEvent[] = [];
    for (const ev of incoming) {
      const existing = this.events.get(ev.id);
      if (
        !existing ||
        existing.totalTokens !== ev.totalTokens ||
        existing.status !== ev.status ||
        existing.endTimeMs !== ev.endTimeMs
      ) {
        this.events.set(ev.id, ev);
        addedOrChanged.push(ev);
      }
    }
    if (addedOrChanged.length > 0) {
      this.scheduleFlush();
      for (const listener of this.listeners) {
        try {
          listener(addedOrChanged);
        } catch {
          // Isolate listener errors
        }
      }
    }
    return addedOrChanged;
  }

  public clearSimulated(): number {
    let removed = 0;
    for (const [id, ev] of this.events.entries()) {
      if (ev.isSimulated) {
        this.events.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      for (const listener of this.listeners) {
        try {
          listener([]);
        } catch {
          // ignore
        }
      }
    }
    return removed;
  }

  public subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public count(): number {
    return this.events.size;
  }

  public query(filter: QueryFilter = {}): TelemetryEvent[] {
    const out: TelemetryEvent[] = [];
    for (const ev of this.events.values()) {
      if (filter.mode === 'live' && ev.isSimulated) continue;
      if (filter.mode === 'simulated' && !ev.isSimulated) continue;
      if (filter.source && filter.source !== 'all' && ev.source !== filter.source) continue;
      if (filter.model && ev.model.toLowerCase() !== filter.model.toLowerCase()) continue;
      if (filter.workflowId && ev.workflowId !== filter.workflowId) continue;
      if (typeof filter.sinceMs === 'number' && ev.endTimeMs < filter.sinceMs) continue;
      if (typeof filter.untilMs === 'number' && ev.startTimeMs > filter.untilMs) continue;
      out.push(ev);
    }
    out.sort((a, b) => a.startTimeMs - b.startTimeMs);
    return out;
  }
}

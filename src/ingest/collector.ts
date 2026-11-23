import { readFileSync, statSync } from 'node:fs';
import type { DiscoveredSourceStatus, SourceKind } from '../model/types.js';
import type { TelemetryStore } from '../store/telemetryStore.js';
import {
  discoverAntigravityChildLinks,
  extractAntigravityConvId,
  parseAntigravityTranscript,
  type AntigravityParentLink,
} from './antigravity.js';
import { readClaudeCodeFile } from './claudeCode.js';
import { readCodexFile } from './codex.js';
import {
  readCopilotChatLogFile,
  readCopilotChatSessionFile,
  readCopilotTracesDb,
} from './copilot.js';
import { discoverLocalSources } from './discovery.js';

export class LocalCollector {
  private store: TelemetryStore;
  private customHome?: string;
  private fileMtimes = new Map<string, number>();
  private sourceStatuses = new Map<SourceKind, DiscoveredSourceStatus>();
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(store: TelemetryStore, options?: { homeDir?: string }) {
    this.store = store;
    this.customHome = options?.homeDir;
    this.initStatuses();
  }

  private initStatuses(): void {
    const defs: Array<[SourceKind, string]> = [
      ['copilot', 'GitHub Copilot (VS Code)'],
      ['claude-code', 'Claude Code'],
      ['antigravity', 'Antigravity'],
      ['codex', 'OpenAI Codex CLI'],
      ['otlp', 'OpenTelemetry (OTLP)'],
      ['sdk', 'Custom SDK / HTTP Ingest'],
    ];
    for (const [source, label] of defs) {
      this.sourceStatuses.set(source, {
        source,
        label,
        detected: source === 'otlp' || source === 'sdk',
        paths: [],
        eventsIngested: 0,
        lastScannedMs: null,
        lastError: null,
      });
    }
  }

  private fileChanged(path: string): boolean {
    try {
      const mtime = statSync(path).mtimeMs;
      const prev = this.fileMtimes.get(path);
      if (prev !== undefined && prev === mtime) return false;
      this.fileMtimes.set(path, mtime);
      return true;
    } catch {
      return false;
    }
  }

  public async scanOnce(force = false): Promise<{ added: number; scannedFiles: number }> {
    if (this.scanning) return { added: 0, scannedFiles: 0 };
    this.scanning = true;
    let totalAdded = 0;
    let scannedFiles = 0;
    const now = Date.now();

    try {
      const discovered = discoverLocalSources(this.customHome);

      // 1. Copilot (traces DB + chatSessions .json/.jsonl + GitHub Copilot Chat.log)
      const copilotPaths = [
        ...discovered.copilotTracesDbs,
        ...discovered.copilotChatSessions,
        ...discovered.copilotChatLogs,
      ];
      const copilotStatus = this.sourceStatuses.get('copilot')!;
      copilotStatus.detected = copilotPaths.length > 0;
      copilotStatus.paths = copilotPaths;
      copilotStatus.lastScannedMs = now;
      try {
        for (const dbPath of discovered.copilotTracesDbs) {
          if (!force && !this.fileChanged(dbPath)) continue;
          scannedFiles++;
          const events = await readCopilotTracesDb(dbPath);
          const added = this.store.upsert(events);
          totalAdded += added.length;
        }
        for (const chatPath of discovered.copilotChatSessions) {
          if (!force && !this.fileChanged(chatPath)) continue;
          scannedFiles++;
          const events = readCopilotChatSessionFile(chatPath);
          const added = this.store.upsert(events);
          totalAdded += added.length;
        }
        for (const logPath of discovered.copilotChatLogs) {
          if (!force && !this.fileChanged(logPath)) continue;
          scannedFiles++;
          const events = readCopilotChatLogFile(logPath);
          const added = this.store.upsert(events);
          totalAdded += added.length;
        }
        copilotStatus.lastError = null;
      } catch (err) {
        copilotStatus.lastError = err instanceof Error ? err.message : String(err);
      }

      // 2. Claude Code
      const claudeStatus = this.sourceStatuses.get('claude-code')!;
      claudeStatus.detected = discovered.claudeCodeJsonls.length > 0;
      claudeStatus.paths = discovered.claudeCodeJsonls;
      claudeStatus.lastScannedMs = now;
      try {
        for (const file of discovered.claudeCodeJsonls) {
          if (!force && !this.fileChanged(file)) continue;
          scannedFiles++;
          const events = readClaudeCodeFile(file);
          const added = this.store.upsert(events);
          totalAdded += added.length;
        }
        claudeStatus.lastError = null;
      } catch (err) {
        claudeStatus.lastError = err instanceof Error ? err.message : String(err);
      }

      // 3. Antigravity (two-pass so subagent conversations link into their parent workflow DAG)
      const agStatus = this.sourceStatuses.get('antigravity')!;
      agStatus.detected = discovered.antigravityTranscripts.length > 0;
      agStatus.paths = discovered.antigravityTranscripts;
      agStatus.lastScannedMs = now;
      try {
        const agContents = new Map<string, string>();
        const childLinks = new Map<string, AntigravityParentLink>();
        for (const file of discovered.antigravityTranscripts) {
          const content = readFileSync(file, 'utf8');
          agContents.set(file, content);
          for (const [childId, link] of discoverAntigravityChildLinks(content, file)) {
            childLinks.set(childId, link);
          }
        }
        for (const file of discovered.antigravityTranscripts) {
          if (!force && !this.fileChanged(file)) continue;
          scannedFiles++;
          const convId = extractAntigravityConvId(file);
          const content = agContents.get(file) ?? readFileSync(file, 'utf8');
          const events = parseAntigravityTranscript(content, file, childLinks.get(convId));
          const added = this.store.upsert(events);
          totalAdded += added.length;
        }
        agStatus.lastError = null;
      } catch (err) {
        agStatus.lastError = err instanceof Error ? err.message : String(err);
      }

      // 4. Codex
      const codexStatus = this.sourceStatuses.get('codex')!;
      codexStatus.detected = discovered.codexJsonls.length > 0;
      codexStatus.paths = discovered.codexJsonls;
      codexStatus.lastScannedMs = now;
      try {
        for (const file of discovered.codexJsonls) {
          if (!force && !this.fileChanged(file)) continue;
          scannedFiles++;
          const events = readCodexFile(file);
          const added = this.store.upsert(events);
          totalAdded += added.length;
        }
        codexStatus.lastError = null;
      } catch (err) {
        codexStatus.lastError = err instanceof Error ? err.message : String(err);
      }

      // Refresh per-source ingested counts
      const allLive = this.store.query({ mode: 'live' });
      const counts = new Map<SourceKind, number>();
      for (const ev of allLive) {
        counts.set(ev.source, (counts.get(ev.source) ?? 0) + 1);
      }
      for (const status of this.sourceStatuses.values()) {
        status.eventsIngested = counts.get(status.source) ?? 0;
      }
    } finally {
      this.scanning = false;
    }

    return { added: totalAdded, scannedFiles };
  }

  public startPolling(intervalMs = 10_000): void {
    if (this.timer) return;
    void this.scanOnce(true);
    this.timer = setInterval(() => {
      void this.scanOnce(false);
    }, intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  public stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getSourceStatuses(): DiscoveredSourceStatus[] {
    return Array.from(this.sourceStatuses.values());
  }
}

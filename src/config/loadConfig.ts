import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface AgentPulseConfig {
  /** Custom VS Code / Cursor / VSCodium root or User data directories. */
  vscodeDirs: string[];
  /** Explicit paths to Copilot agent-traces.db files. */
  copilotTraceDbs: string[];
  /** Explicit directories containing GitHub Copilot Chat.log or chatSessions. */
  copilotChatLogDirs: string[];
  /** Custom Claude Code project directories. */
  claudeDirs: string[];
  /** Custom Antigravity brain directories. */
  antigravityDirs: string[];
  /** Custom Codex CLI session directories. */
  codexDirs: string[];
  /** Default server port (overridable via --port). */
  port?: number;
  /** Default polling interval in ms (overridable via --poll). */
  pollIntervalMs?: number;
}

export interface LoadedConfigResult {
  config: AgentPulseConfig;
  loadedFrom: string[];
}

const EMPTY_CONFIG: AgentPulseConfig = {
  vscodeDirs: [],
  copilotTraceDbs: [],
  copilotChatLogDirs: [],
  claudeDirs: [],
  antigravityDirs: [],
  codexDirs: [],
};

function expandHome(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function normalizeStrList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => resolve(expandHome(s.trim())));
}

export function getGlobalConfigPath(customHome?: string): string {
  return join(customHome ?? homedir(), '.agentpulse', 'config.json');
}

export function getLocalConfigPath(cwd = process.cwd()): string {
  return join(cwd, 'agentpulse.config.json');
}

export function loadAgentPulseConfig(options?: {
  cwd?: string;
  homeDir?: string;
}): LoadedConfigResult {
  const merged: AgentPulseConfig = {
    vscodeDirs: [],
    copilotTraceDbs: [],
    copilotChatLogDirs: [],
    claudeDirs: [],
    antigravityDirs: [],
    codexDirs: [],
  };
  const loadedFrom: string[] = [];

  const candidates = [
    getGlobalConfigPath(options?.homeDir),
    getLocalConfigPath(options?.cwd),
  ];

  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as Partial<AgentPulseConfig>;
      merged.vscodeDirs.push(...normalizeStrList(raw.vscodeDirs));
      merged.copilotTraceDbs.push(...normalizeStrList(raw.copilotTraceDbs));
      merged.copilotChatLogDirs.push(...normalizeStrList(raw.copilotChatLogDirs));
      merged.claudeDirs.push(...normalizeStrList(raw.claudeDirs));
      merged.antigravityDirs.push(...normalizeStrList(raw.antigravityDirs));
      merged.codexDirs.push(...normalizeStrList(raw.codexDirs));
      if (typeof raw.port === 'number' && Number.isFinite(raw.port)) merged.port = raw.port;
      if (typeof raw.pollIntervalMs === 'number' && Number.isFinite(raw.pollIntervalMs)) {
        merged.pollIntervalMs = raw.pollIntervalMs;
      }
      loadedFrom.push(cfgPath);
    } catch {
      // Ignore invalid JSON so startup never crashes
    }
  }

  return {
    config: {
      ...EMPTY_CONFIG,
      ...merged,
      vscodeDirs: Array.from(new Set(merged.vscodeDirs)),
      copilotTraceDbs: Array.from(new Set(merged.copilotTraceDbs)),
      copilotChatLogDirs: Array.from(new Set(merged.copilotChatLogDirs)),
      claudeDirs: Array.from(new Set(merged.claudeDirs)),
      antigravityDirs: Array.from(new Set(merged.antigravityDirs)),
      codexDirs: Array.from(new Set(merged.codexDirs)),
    },
    loadedFrom,
  };
}

export function saveGlobalConfig(config: Partial<AgentPulseConfig>, customHome?: string): string {
  const path = getGlobalConfigPath(customHome);
  mkdirSync(dirname(path), { recursive: true });
  const existing = loadAgentPulseConfig({ homeDir: customHome }).config;
  const next: AgentPulseConfig = {
    vscodeDirs: Array.from(new Set([...existing.vscodeDirs, ...(config.vscodeDirs ?? [])])),
    copilotTraceDbs: Array.from(new Set([...existing.copilotTraceDbs, ...(config.copilotTraceDbs ?? [])])),
    copilotChatLogDirs: Array.from(new Set([...existing.copilotChatLogDirs, ...(config.copilotChatLogDirs ?? [])])),
    claudeDirs: Array.from(new Set([...existing.claudeDirs, ...(config.claudeDirs ?? [])])),
    antigravityDirs: Array.from(new Set([...existing.antigravityDirs, ...(config.antigravityDirs ?? [])])),
    codexDirs: Array.from(new Set([...existing.codexDirs, ...(config.codexDirs ?? [])])),
    port: config.port ?? existing.port,
    pollIntervalMs: config.pollIntervalMs ?? existing.pollIntervalMs,
  };
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return path;
}

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DiscoveredPaths {
  vscodeRootDirs: string[];
  copilotTracesDbs: string[];
  copilotChatSessions: string[];
  copilotChatLogs: string[];
  claudeCodeJsonls: string[];
  antigravityTranscripts: string[];
  codexJsonls: string[];
}

const VSCODE_VARIANTS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'Windsurf'];

export function getVsCodeRootDirs(home: string): string[] {
  const dirs: string[] = [];

  // Optional custom override for corporate/portable VS Code installs
  const envOverride = process.env.AGENTPULSE_VSCODE_DIR || process.env.VSCODE_USER_DATA_DIR;
  if (envOverride) {
    for (const part of envOverride.split(process.platform === 'win32' ? ';' : ':')) {
      const trimmed = part.trim();
      if (trimmed) dirs.push(trimmed);
    }
  }

  if (process.platform === 'darwin') {
    for (const v of VSCODE_VARIANTS) {
      dirs.push(join(home, 'Library', 'Application Support', v));
    }
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    for (const v of VSCODE_VARIANTS) {
      dirs.push(join(appData, v));
      dirs.push(join(localAppData, v));
    }
  } else {
    const xdg = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
    for (const v of VSCODE_VARIANTS) {
      dirs.push(join(xdg, v));
    }
  }

  return Array.from(new Set(dirs)).filter((d) => existsSync(d));
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function collectFiles(
  dir: string,
  predicate: (fullPath: string, name: string) => boolean,
  maxDepth: number,
  depth = 0,
): string[] {
  if (depth > maxDepth || !existsSync(dir)) return [];
  const results: string[] = [];
  for (const name of safeReaddir(dir)) {
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isFile() && predicate(full, name)) {
        results.push(full);
      } else if (st.isDirectory() && depth < maxDepth) {
        results.push(...collectFiles(full, predicate, maxDepth, depth + 1));
      }
    } catch {
      // Skip unreadable entries
    }
  }
  return results;
}

export function discoverLocalSources(customHome?: string): DiscoveredPaths {
  const home = customHome ?? homedir();
  const vscodeRootDirs = getVsCodeRootDirs(home);

  const copilotTracesDbs: string[] = [];
  const copilotChatSessions: string[] = [];
  const copilotChatLogs: string[] = [];

  for (const rootDir of vscodeRootDirs) {
    // Support both rootDir = .../Code and rootDir = .../Code/User
    const userDir = existsSync(join(rootDir, 'User')) ? join(rootDir, 'User') : rootDir;

    // 1. Copilot globalStorage traces DB
    const globalCopilot = join(userDir, 'globalStorage', 'github.copilot-chat');
    if (existsSync(globalCopilot)) {
      copilotTracesDbs.push(
        ...collectFiles(globalCopilot, (_p, n) => n === 'agent-traces.db' || n.endsWith('-traces.db'), 4),
      );
    }

    // 2. Empty-window chat sessions (.json and .jsonl)
    const emptyWinChats = join(userDir, 'globalStorage', 'emptyWindowChatSessions');
    if (existsSync(emptyWinChats)) {
      for (const file of safeReaddir(emptyWinChats)) {
        if (file.endsWith('.json') || file.endsWith('.jsonl')) {
          copilotChatSessions.push(join(emptyWinChats, file));
        }
      }
    }

    // 3. Workspace storage: agent-traces.db + chatSessions (.json and .jsonl)
    const wsStorage = join(userDir, 'workspaceStorage');
    if (existsSync(wsStorage)) {
      for (const wsId of safeReaddir(wsStorage)) {
        const wsPath = join(wsStorage, wsId);
        const traceDb = join(wsPath, 'github.copilot-chat', 'agent-traces.db');
        if (existsSync(traceDb)) copilotTracesDbs.push(traceDb);

        const chatDir = join(wsPath, 'chatSessions');
        if (existsSync(chatDir)) {
          for (const file of safeReaddir(chatDir)) {
            if (file.endsWith('.json') || file.endsWith('.jsonl')) {
              copilotChatSessions.push(join(chatDir, file));
            }
          }
        }
      }
    }

    // 4. VS Code Extension Host logs: logs/<ts>/window*/exthost/GitHub.copilot-chat/GitHub Copilot Chat.log
    const logsDir = join(rootDir, 'logs');
    if (existsSync(logsDir)) {
      copilotChatLogs.push(
        ...collectFiles(
          logsDir,
          (_p, n) => n === 'GitHub Copilot Chat.log',
          5,
        ),
      );
    }
  }

  // Also check ~/.copilot for standalone Copilot CLI / agent traces
  const dotCopilot = join(home, '.copilot');
  if (existsSync(dotCopilot)) {
    copilotTracesDbs.push(
      ...collectFiles(dotCopilot, (_p, n) => n === 'agent-traces.db' || n.endsWith('-traces.db'), 3),
    );
  }

  const claudeProjectsDir = join(home, '.claude', 'projects');
  const claudeCodeJsonls = collectFiles(
    claudeProjectsDir,
    (_p, n) => n.endsWith('.jsonl'),
    5,
  );

  const antigravityBrainDir = join(home, '.gemini', 'antigravity', 'brain');
  const antigravityTranscripts = collectFiles(
    antigravityBrainDir,
    (_p, n) => n === 'transcript.jsonl',
    3,
  );

  const codexDir = join(home, '.codex', 'sessions');
  const codexJsonls = collectFiles(
    codexDir,
    (_p, n) => n.endsWith('.jsonl'),
    4,
  );

  return {
    vscodeRootDirs,
    copilotTracesDbs: Array.from(new Set(copilotTracesDbs)),
    copilotChatSessions: Array.from(new Set(copilotChatSessions)),
    copilotChatLogs: Array.from(new Set(copilotChatLogs)),
    claudeCodeJsonls: Array.from(new Set(claudeCodeJsonls)),
    antigravityTranscripts: Array.from(new Set(antigravityTranscripts)),
    codexJsonls: Array.from(new Set(codexJsonls)),
  };
}

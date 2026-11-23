import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DiscoveredPaths {
  copilotTracesDbs: string[];
  copilotChatSessions: string[];
  claudeCodeJsonls: string[];
  antigravityTranscripts: string[];
  codexJsonls: string[];
}

function getVsCodeUserDirs(home: string): string[] {
  const dirs: string[] = [];
  if (process.platform === 'darwin') {
    dirs.push(
      join(home, 'Library', 'Application Support', 'Code', 'User'),
      join(home, 'Library', 'Application Support', 'Code - Insiders', 'User'),
      join(home, 'Library', 'Application Support', 'Cursor', 'User'),
    );
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    dirs.push(
      join(appData, 'Code', 'User'),
      join(appData, 'Code - Insiders', 'User'),
      join(appData, 'Cursor', 'User'),
    );
  } else {
    const xdg = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
    dirs.push(
      join(xdg, 'Code', 'User'),
      join(xdg, 'Code - Insiders', 'User'),
      join(xdg, 'Cursor', 'User'),
    );
  }
  return dirs.filter((d) => existsSync(d));
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function collectFiles(dir: string, predicate: (fullPath: string, name: string) => boolean, maxDepth: number, depth = 0): string[] {
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

  const copilotTracesDbs: string[] = [];
  const copilotChatSessions: string[] = [];

  for (const userDir of getVsCodeUserDirs(home)) {
    const globalCopilot = join(userDir, 'globalStorage', 'github.copilot-chat');
    if (existsSync(globalCopilot)) {
      copilotTracesDbs.push(
        ...collectFiles(globalCopilot, (_p, n) => n === 'agent-traces.db' || n.endsWith('-traces.db'), 3),
      );
    }

    const wsStorage = join(userDir, 'workspaceStorage');
    if (existsSync(wsStorage)) {
      for (const wsId of safeReaddir(wsStorage)) {
        const wsPath = join(wsStorage, wsId);
        const traceDb = join(wsPath, 'github.copilot-chat', 'agent-traces.db');
        if (existsSync(traceDb)) copilotTracesDbs.push(traceDb);

        const chatDir = join(wsPath, 'chatSessions');
        if (existsSync(chatDir)) {
          for (const file of safeReaddir(chatDir)) {
            if (file.endsWith('.json')) {
              copilotChatSessions.push(join(chatDir, file));
            }
          }
        }
      }
    }
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
    copilotTracesDbs: Array.from(new Set(copilotTracesDbs)),
    copilotChatSessions: Array.from(new Set(copilotChatSessions)),
    claudeCodeJsonls: Array.from(new Set(claudeCodeJsonls)),
    antigravityTranscripts: Array.from(new Set(antigravityTranscripts)),
    codexJsonls: Array.from(new Set(codexJsonls)),
  };
}

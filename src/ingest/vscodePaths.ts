import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const VARIANTS = ['Code', 'Code - Insiders', 'VSCodium'];

/** VS Code's per-variant "User" data directory, across platforms. Only returns dirs that exist. */
export function candidateUserDirs(): string[] {
  const home = homedir();
  const plat = platform();
  const dirs: string[] = [];
  if (plat === 'darwin') {
    for (const v of VARIANTS) dirs.push(join(home, 'Library', 'Application Support', v, 'User'));
  } else if (plat === 'win32') {
    const appData = process.env['APPDATA'] || join(home, 'AppData', 'Roaming');
    for (const v of VARIANTS) dirs.push(join(appData, v, 'User'));
  } else {
    for (const v of VARIANTS) dirs.push(join(home, '.config', v, 'User'));
  }
  return dirs.filter((d) => existsSync(d));
}

/**
 * Candidate paths for Copilot Chat's global trace database, per
 * Hoxlegion/copilot-cost-tracker-vsc `src/parser/tracesDbReader.ts` (verified by reading
 * that project's source directly — see PLAN.md). This is a single GLOBAL file per VS
 * Code variant, not per-workspace: it's shared across every project open on the machine,
 * which is why span attribution to a specific workspace has to happen after the fact via
 * a repo-url attribute rather than by file location.
 */
export function candidateTracesDbPaths(): string[] {
  return candidateUserDirs().map((userDir) => join(userDir, 'globalStorage', 'github.copilot-chat', 'agent-traces.db'));
}

export function findExistingTracesDbPath(): string | null {
  return candidateTracesDbPaths().find((p) => existsSync(p)) ?? null;
}

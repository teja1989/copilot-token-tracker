#!/usr/bin/env node
// Phase 0 reconnaissance tool — see PLAN.md.
//
// Read-only, local-only, zero-dependency. Walks VS Code's workspaceStorage looking for
// Copilot Chat/Agent session data and prints a REDACTED structural summary: key names,
// value types, array lengths, and short enum-like strings (model id, role, status).
// Long strings and anything containing newlines (i.e. anything that could be prompt or
// response body text) is replaced with a placeholder. No network calls. Nothing is
// written anywhere except stdout.
//
// Usage: node tools/inspect-copilot-storage.mjs [--full-strings] [--max-sessions N]

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

const args = process.argv.slice(2);
const FULL_STRINGS = args.includes('--full-strings');
const maxIdx = args.indexOf('--max-sessions');
const MAX_SESSIONS = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : 5;

const SHORT_STRING_LIMIT = 60;

function candidateUserDirs() {
  const home = homedir();
  const plat = platform();
  const dirs = [];
  const variants = ['Code', 'Code - Insiders', 'VSCodium'];
  if (plat === 'darwin') {
    for (const v of variants) dirs.push(join(home, 'Library', 'Application Support', v, 'User'));
  } else if (plat === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    for (const v of variants) dirs.push(join(appData, v, 'User'));
  } else {
    for (const v of variants) dirs.push(join(home, '.config', v, 'User'));
  }
  return dirs.filter((d) => existsSync(d));
}

function redactString(s) {
  if (FULL_STRINGS) return JSON.stringify(s);
  const looksLikeContent = s.includes('\n') || s.length > SHORT_STRING_LIMIT;
  if (looksLikeContent) return `<string len=${s.length}>`;
  return JSON.stringify(s);
}

// Walks a parsed JSON value, printing a structural outline. Arrays only recurse into
// their first element (plus a length note) to avoid dumping every chat turn.
function describe(value, path, depth, lines) {
  const indent = '  '.repeat(depth);
  if (value === null) {
    lines.push(`${indent}${path}: null`);
  } else if (Array.isArray(value)) {
    lines.push(`${indent}${path}: array[${value.length}]`);
    if (value.length > 0 && depth < 8) {
      describe(value[0], `${path}[0]`, depth + 1, lines);
    }
  } else if (typeof value === 'object') {
    const keys = Object.keys(value);
    lines.push(`${indent}${path}: object{${keys.length} keys}`);
    if (depth < 8) {
      for (const k of keys) {
        describe(value[k], k, depth + 1, lines);
      }
    }
  } else if (typeof value === 'string') {
    lines.push(`${indent}${path}: string = ${redactString(value)}`);
  } else {
    // numbers, booleans — low risk, keep as-is (these are exactly the fields we need:
    // token/char counts, timestamps, flags).
    lines.push(`${indent}${path}: ${typeof value} = ${JSON.stringify(value)}`);
  }
}

function inspectChatSessionsDir(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  console.log(`    chatSessions/: ${files.length} session file(s)`);
  for (const f of files.slice(0, MAX_SESSIONS)) {
    const full = join(dir, f);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(full, 'utf8'));
    } catch (e) {
      console.log(`      [skip] ${f}: not valid JSON (${e.message})`);
      continue;
    }
    console.log(`      --- ${f} (${statSync(full).size} bytes) ---`);
    const lines = [];
    describe(parsed, '$', 3, lines);
    for (const l of lines) console.log(l);
  }
  if (files.length > MAX_SESSIONS) {
    console.log(`    ... ${files.length - MAX_SESSIONS} more session file(s) not shown (--max-sessions to raise)`);
  }
}

function main() {
  const userDirs = candidateUserDirs();
  if (userDirs.length === 0) {
    console.log('No VS Code User directory found on known paths for this OS. Nothing to inspect.');
    return;
  }

  for (const userDir of userDirs) {
    console.log(`\n=== ${userDir} ===`);
    const wsRoot = join(userDir, 'workspaceStorage');
    if (!existsSync(wsRoot)) {
      console.log('  (no workspaceStorage directory)');
      continue;
    }
    const hashes = readdirSync(wsRoot);
    console.log(`  workspaceStorage: ${hashes.length} workspace(s)`);

    for (const hash of hashes) {
      const wsDir = join(wsRoot, hash);
      let entries;
      try {
        entries = readdirSync(wsDir);
      } catch {
        continue;
      }

      const chatSessionsDir = join(wsDir, 'chatSessions');
      const stateDb = join(wsDir, 'state.vscdb');
      const hasChatSessions = existsSync(chatSessionsDir);
      const hasStateDb = existsSync(stateDb);
      if (!hasChatSessions && !hasStateDb) continue;

      console.log(`  --- workspace ${hash} ---`);
      if (hasStateDb) {
        console.log(`    state.vscdb: present (${statSync(stateDb).size} bytes) — not parsed by this script (SQLite; Phase 1 concern if chatSessions/ alone is insufficient)`);
      }
      if (hasChatSessions) {
        inspectChatSessionsDir(chatSessionsDir);
      }
    }
  }

  console.log('\nDone. Long/multi-line string values were redacted to "<string len=N>".');
  console.log('Re-run with --full-strings only if you are certain the output never leaves your machine —');
  console.log('it will then include actual short field values, which may still include workspace paths.');
}

main();

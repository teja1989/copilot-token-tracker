#!/usr/bin/env node
/**
 * AgentPulse — Cross-Platform Interactive Launcher (macOS, Linux, Windows)
 * Run via double-clicking `start.command` (macOS) or `start.bat` (Windows),
 * or `make launch` / `npm run launch`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  ensureBuilt,
  isProcessAlive,
  readPidInfo,
  showLogs,
  showStatus,
  startDaemon,
  stopDaemon,
} from './agentpulse-ctl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const NPM_CMD = IS_WIN ? 'npm.cmd' : 'npm';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function printBanner() {
  console.clear();
  console.log(`${C.cyan}${C.bold}`);
  console.log('   ⚡  A G E N T P U L S E');
  console.log(`   Local Multi-Model Token & Multi-Agent Telemetry Observatory${C.reset}`);
  const info = readPidInfo();
  if (info && isProcessAlive(info.pid)) {
    console.log(
      `   ${C.green}● RUNNING${C.reset} ${C.dim}(PID ${info.pid}) · http://127.0.0.1:${info.port}${C.reset}\n`,
    );
  } else {
    console.log(`   ${C.dim}○ STOPPED · Copilot · Claude Code · Antigravity · Codex · OTLP${C.reset}\n`);
  }
}

async function runDiagnostics() {
  ensureBuilt(false);
  console.log(`\n${C.cyan}▶ Running automated test suite...${C.reset}`);
  spawnSync(NPM_CMD, ['test'], { cwd: ROOT, stdio: 'inherit', shell: IS_WIN });

  console.log(`\n${C.cyan}▶ Checking local AI agent sources on this machine...${C.reset}`);
  const { discoverLocalSources } = await import(join(ROOT, 'dist', 'ingest', 'discovery.js'));
  const found = discoverLocalSources();
  console.log(
    `  ${C.dim}VS Code root dirs found: ${found.vscodeRootDirs.length > 0 ? found.vscodeRootDirs.join(', ') : 'none (use Option 5 to add a custom path)'}${C.reset}`,
  );
  const rows = [
    ['GitHub Copilot (traces DB)', found.copilotTracesDbs.length],
    ['GitHub Copilot (chat sessions)', found.copilotChatSessions.length],
    ['GitHub Copilot (Chat.log)', found.copilotChatLogs.length],
    ['Claude Code (JSONL)', found.claudeCodeJsonls.length],
    ['Antigravity (transcripts)', found.antigravityTranscripts.length],
    ['OpenAI Codex CLI (JSONL)', found.codexJsonls.length],
  ];
  for (const [label, count] of rows) {
    const badge = count > 0 ? `${C.green}● ${count} file(s)${C.reset}` : `${C.dim}○ not detected${C.reset}`;
    console.log(`  ${label.padEnd(34)} ${badge}`);
  }
  console.log('');
}

async function main() {
  if (process.argv.includes('--check')) {
    console.log(`AgentPulse Launcher OK (Node v${process.versions.node}, platform=${process.platform})`);
    process.exit(0);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      printBanner();
      console.log(`${C.bold}Choose an action:${C.reset}`);
      console.log(`  ${C.cyan}1)${C.reset} ${C.bold}Start in Background (Daemon)${C.reset} ${C.dim}(Auto-discover local agents & open dashboard)${C.reset}`);
      console.log(`  ${C.cyan}2)${C.reset} ${C.bold}Stop Background Server${C.reset}`);
      console.log(`  ${C.cyan}3)${C.reset} Status & Recent Logs ${C.dim}(Shows detected models & span counts)${C.reset}`);
      console.log(`  ${C.cyan}4)${C.reset} Start with Demo Multi-Agent Swarms`);
      console.log(`  ${C.cyan}5)${C.reset} Configure Custom Local Path ${C.dim}(VS Code / Copilot / Claude / Codex)${C.reset}`);
      console.log(`  ${C.cyan}6)${C.reset} Run Local Diagnostics & Tests`);
      console.log(`  ${C.cyan}7)${C.reset} Reinstall & Rebuild`);
      console.log(`  ${C.cyan}8)${C.reset} Exit\n`);

      const choice = (await rl.question(`${C.yellow}Select [1-8] (default 1): ${C.reset}`)).trim() || '1';

      if (choice === '1') {
        await startDaemon({ port: 4318, demo: false, noOpen: false });
        await rl.question(`\n${C.dim}Press Enter to return to menu (server stays running in background)...${C.reset}`);
      } else if (choice === '2') {
        await stopDaemon();
        await rl.question(`\n${C.dim}Press Enter to return to menu...${C.reset}`);
      } else if (choice === '3') {
        console.log('');
        await showStatus();
        console.log(`\n${C.bold}--- Recent Logs ---${C.reset}`);
        showLogs(25);
        await rl.question(`\n${C.dim}Press Enter to return to menu...${C.reset}`);
      } else if (choice === '4') {
        await stopDaemon();
        await startDaemon({ port: 4318, demo: true, noOpen: false });
        await rl.question(`\n${C.dim}Press Enter to return to menu (server stays running in background)...${C.reset}`);
      } else if (choice === '5') {
        ensureBuilt(false);
        const { saveGlobalConfig, getGlobalConfigPath } = await import(
          join(ROOT, 'dist', 'config', 'loadConfig.js')
        );
        console.log(`\n${C.bold}Add a custom directory to ${getGlobalConfigPath()}${C.reset}`);
        console.log(`  1) VS Code / Cursor / VSCodium data dir (e.g. C:\\Users\\you\\AppData\\Roaming\\Code)`);
        console.log(`  2) Copilot logs or chatSessions directory`);
        console.log(`  3) Claude Code projects directory`);
        console.log(`  4) Codex sessions directory`);
        const kind = (await rl.question('Choose type [1-4]: ')).trim();
        const dir = (await rl.question('Paste full folder path: ')).trim();
        if (dir) {
          const patch =
            kind === '2'
              ? { copilotChatLogDirs: [dir] }
              : kind === '3'
                ? { claudeDirs: [dir] }
                : kind === '4'
                  ? { codexDirs: [dir] }
                  : { vscodeDirs: [dir] };
          const saved = saveGlobalConfig(patch);
          console.log(`${C.green}✓ Saved custom path to ${saved}${C.reset}`);
        }
        await rl.question(`\n${C.dim}Press Enter to return to menu...${C.reset}`);
      } else if (choice === '6') {
        await runDiagnostics();
        await rl.question(`${C.dim}Press Enter to return to menu...${C.reset}`);
      } else if (choice === '7') {
        ensureBuilt(true);
        await rl.question(`\n${C.dim}Press Enter to return to menu...${C.reset}`);
      } else if (choice === '8' || choice.toLowerCase() === 'q') {
        console.log(`\n${C.cyan}Goodbye!${C.reset}\n`);
        break;
      } else {
        console.log(`${C.yellow}Invalid choice. Please enter 1-8.${C.reset}`);
        await new Promise((r) => setTimeout(r, 900));
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('Launcher error:', err);
  process.exit(1);
});

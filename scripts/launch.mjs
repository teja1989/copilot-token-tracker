#!/usr/bin/env node
/**
 * AgentPulse — Cross-Platform Interactive Launcher (macOS, Linux, Windows)
 * Run via double-clicking `start.command` (macOS) or `start.bat` (Windows),
 * or `npm run launch` / `node scripts/launch.mjs`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const NPM_CMD = IS_WIN ? 'npm.cmd' : 'npm';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  violet: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function printBanner() {
  console.clear();
  console.log(`${C.cyan}${C.bold}`);
  console.log('   ⚡  A G E N T P U L S E');
  console.log(`   Local Multi-Model Token & Multi-Agent Telemetry Observatory${C.reset}`);
  console.log(`${C.dim}   100% Local · Copilot · Claude Code · Antigravity · Codex · OTLP${C.reset}\n`);
}

function runSync(cmd, args, label) {
  console.log(`${C.cyan}▶ ${label}...${C.reset}`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: IS_WIN,
  });
  if (res.status !== 0) {
    console.error(`\n${C.red}✖ Step failed: ${label} (exit code ${res.status ?? 1})${C.reset}`);
    return false;
  }
  return true;
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    console.error(`${C.red}✖ Node.js v20+ is required (detected v${process.versions.node}).${C.reset}`);
    console.error('  Install from https://nodejs.org/ and try again.');
    process.exit(1);
  }
}

function ensureInstalledAndBuilt(forceRebuild = false) {
  const needsRootInstall = !existsSync(join(ROOT, 'node_modules'));
  const needsWebInstall = !existsSync(join(ROOT, 'web', 'node_modules'));
  const needsBuild =
    forceRebuild ||
    !existsSync(join(ROOT, 'dist', 'cli.js')) ||
    !existsSync(join(ROOT, 'web', 'dist', 'index.html'));

  if (needsRootInstall || forceRebuild) {
    if (!runSync(NPM_CMD, ['install'], 'Installing server dependencies')) return false;
  }
  if (needsWebInstall || forceRebuild) {
    if (!runSync(NPM_CMD, ['--prefix', 'web', 'install'], 'Installing dashboard dependencies')) return false;
  }
  if (needsBuild) {
    if (!runSync(NPM_CMD, ['run', 'build'], 'Building AgentPulse server & React dashboard')) return false;
  }
  return true;
}

function launchObservatory({ port = 4318, demo = false, openBrowser = true }) {
  if (!ensureInstalledAndBuilt(false)) return Promise.resolve();

  const args = [join(ROOT, 'dist', 'cli.js'), 'start', '--port', String(port)];
  if (demo) args.push('--demo');
  if (!openBrowser) args.push('--no-open');

  console.log(`\n${C.green}${C.bold}✓ Starting AgentPulse on http://127.0.0.1:${port}${C.reset}`);
  console.log(`${C.dim}  Press Ctrl+C at any time to stop the server and return to the menu.${C.reset}\n`);

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: 'inherit',
    });

    const onSigInt = () => {
      child.kill('SIGINT');
    };
    process.once('SIGINT', onSigInt);

    child.on('exit', () => {
      process.removeListener('SIGINT', onSigInt);
      resolve();
    });
  });
}

async function runDiagnostics() {
  if (!ensureInstalledAndBuilt(false)) return;
  console.log(`\n${C.cyan}▶ Running automated test suite...${C.reset}`);
  runSync(NPM_CMD, ['test'], 'Vitest unit & integration tests');

  console.log(`\n${C.cyan}▶ Checking local AI agent sources on this machine...${C.reset}`);
  const { discoverLocalSources } = await import(join(ROOT, 'dist', 'ingest', 'discovery.js'));
  const found = discoverLocalSources();
  console.log(`  ${C.dim}VS Code root dirs found: ${found.vscodeRootDirs.length > 0 ? found.vscodeRootDirs.join(', ') : 'none (set AGENTPULSE_VSCODE_DIR if using a custom path)'}${C.reset}`);
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
  checkNodeVersion();

  // Non-interactive quick check mode for CI / verification
  if (process.argv.includes('--check')) {
    console.log(`AgentPulse Launcher OK (Node v${process.versions.node}, platform=${process.platform})`);
    process.exit(0);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      printBanner();
      console.log(`${C.bold}Choose an action:${C.reset}`);
      console.log(`  ${C.cyan}1)${C.reset} ${C.bold}Launch Observatory${C.reset} ${C.dim}(Auto-discover local Copilot, Claude, Antigravity, Codex)${C.reset}`);
      console.log(`  ${C.cyan}2)${C.reset} ${C.bold}Launch Observatory + Demo Swarms${C.reset} ${C.dim}(Pre-load simulated multi-agent workflows)${C.reset}`);
      console.log(`  ${C.cyan}3)${C.reset} Custom Port / Options`);
      console.log(`  ${C.cyan}4)${C.reset} Run Local Diagnostics & Tests`);
      console.log(`  ${C.cyan}5)${C.reset} Reinstall & Rebuild`);
      console.log(`  ${C.cyan}6)${C.reset} Exit\n`);

      const choice = (await rl.question(`${C.yellow}Select [1-6] (default 1): ${C.reset}`)).trim() || '1';

      if (choice === '1') {
        rl.pause();
        await launchObservatory({ port: 4318, demo: false, openBrowser: true });
        rl.resume();
      } else if (choice === '2') {
        rl.pause();
        await launchObservatory({ port: 4318, demo: true, openBrowser: true });
        rl.resume();
      } else if (choice === '3') {
        const portStr = (await rl.question(`Port ${C.dim}(default 4318)${C.reset}: `)).trim();
        const port = Number(portStr) || 4318;
        const demoAns = (await rl.question(`Seed demo multi-agent workflows? ${C.dim}[y/N]${C.reset}: `)).trim().toLowerCase();
        const openAns = (await rl.question(`Auto-open browser? ${C.dim}[Y/n]${C.reset}: `)).trim().toLowerCase();
        rl.pause();
        await launchObservatory({
          port,
          demo: demoAns === 'y' || demoAns === 'yes',
          openBrowser: openAns !== 'n' && openAns !== 'no',
        });
        rl.resume();
      } else if (choice === '4') {
        await runDiagnostics();
        await rl.question(`${C.dim}Press Enter to return to menu...${C.reset}`);
      } else if (choice === '5') {
        ensureInstalledAndBuilt(true);
        await rl.question(`${C.dim}Press Enter to return to menu...${C.reset}`);
      } else if (choice === '6' || choice.toLowerCase() === 'q') {
        console.log(`\n${C.cyan}Goodbye!${C.reset}\n`);
        break;
      } else {
        console.log(`${C.yellow}Invalid choice. Please enter 1-6.${C.reset}`);
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

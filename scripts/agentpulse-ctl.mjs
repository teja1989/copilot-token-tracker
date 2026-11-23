#!/usr/bin/env node
/**
 * AgentPulse Daemon Controller (macOS, Linux, Windows)
 * Usage:
 *   node scripts/agentpulse-ctl.mjs <start|stop|restart|status|logs|install> [--port 4318] [--demo] [--no-open]
 */
import { exec, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const NPM_CMD = IS_WIN ? 'npm.cmd' : 'npm';

const STATE_DIR = join(homedir(), '.agentpulse');
const PID_FILE = join(STATE_DIR, 'agentpulse.pid');
const LOG_FILE = join(STATE_DIR, 'agentpulse.log');

function parseFlags(argv) {
  let port = Number(process.env.AGENTPULSE_PORT ?? 4318) || 4318;
  let demo = false;
  let noOpen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--port' || a === '-p') && argv[i + 1]) port = Number(argv[++i]) || port;
    else if (a === '--demo') demo = true;
    else if (a === '--no-open') noOpen = true;
  }
  return { port, demo, noOpen };
}

export function readPidInfo() {
  if (!existsSync(PID_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runSync(cmd, args, label) {
  console.log(`▶ ${label}...`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN });
  if (res.status !== 0) {
    console.error(`✖ Failed: ${label}`);
    process.exit(res.status ?? 1);
  }
}

export function ensureBuilt(force = false) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    console.error(`✖ Node.js v20+ is required (detected v${process.versions.node}).`);
    process.exit(1);
  }
  const alreadyPrebuilt =
    !force &&
    existsSync(join(ROOT, 'node_modules')) &&
    existsSync(join(ROOT, 'dist', 'cli.js')) &&
    existsSync(join(ROOT, 'web', 'dist', 'index.html'));
  if (alreadyPrebuilt) return;

  const needRoot = force || !existsSync(join(ROOT, 'node_modules'));
  const needWeb = force || (!existsSync(join(ROOT, 'web', 'node_modules')) && existsSync(join(ROOT, 'web', 'package.json')));
  const needBuild =
    force ||
    !existsSync(join(ROOT, 'dist', 'cli.js')) ||
    !existsSync(join(ROOT, 'web', 'dist', 'index.html'));

  if (needRoot) runSync(NPM_CMD, ['install'], 'Installing server dependencies');
  if (needWeb) runSync(NPM_CMD, ['--prefix', 'web', 'install'], 'Installing dashboard dependencies');
  if (needBuild) runSync(NPM_CMD, ['run', 'build'], 'Building AgentPulse server & dashboard');
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : IS_WIN
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function waitForHealth(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

export async function startDaemon(opts = {}) {
  const port = opts.port ?? 4318;
  const demo = Boolean(opts.demo);
  const noOpen = Boolean(opts.noOpen);

  const existing = readPidInfo();
  if (existing && isProcessAlive(existing.pid)) {
    const url = `http://127.0.0.1:${existing.port}`;
    console.log(`✓ AgentPulse is already running in background (PID ${existing.pid}) at ${url}`);
    if (!noOpen) openBrowser(url);
    return { alreadyRunning: true, pid: existing.pid, port: existing.port };
  }

  ensureBuilt(false);
  mkdirSync(STATE_DIR, { recursive: true });

  // Truncate/open fresh log file for this daemon run
  writeFileSync(LOG_FILE, '', 'utf8');
  const outFd = openSync(LOG_FILE, 'a');
  const errFd = openSync(LOG_FILE, 'a');

  const args = [join(ROOT, 'dist', 'cli.js'), 'start', '--port', String(port), '--no-open'];
  if (demo) args.push('--demo');

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', outFd, errFd],
    windowsHide: true,
  });
  child.unref();

  writeFileSync(
    PID_FILE,
    JSON.stringify(
      {
        pid: child.pid,
        port,
        startedAt: new Date().toISOString(),
        logFile: LOG_FILE,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const health = await waitForHealth(port, 8000);
  const url = `http://127.0.0.1:${port}`;
  if (health) {
    console.log(`✓ AgentPulse started in background (PID ${child.pid})`);
    console.log(`  Dashboard: ${url}`);
    console.log(`  Events:    ${health.totalEvents} loaded`);
    console.log(`  Logs:      ${LOG_FILE}`);
    if (!noOpen) openBrowser(url);
    return { started: true, pid: child.pid, port, health };
  } else {
    console.error(`✖ AgentPulse did not respond on ${url}. Check logs at ${LOG_FILE}`);
    showLogs(30);
    return { started: false, pid: child.pid, port };
  }
}

export async function stopDaemon() {
  const info = readPidInfo();
  if (!info) {
    console.log('○ AgentPulse is not running (no PID file found).');
    return false;
  }

  if (isProcessAlive(info.pid)) {
    try {
      if (IS_WIN) {
        spawnSync('taskkill', ['/PID', String(info.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(info.pid, 'SIGTERM');
      }
    } catch {
      // ignore
    }

    // Wait up to 2s for clean exit, then force kill
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && isProcessAlive(info.pid)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isProcessAlive(info.pid) && !IS_WIN) {
      try {
        process.kill(info.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
    console.log(`✓ Stopped AgentPulse (PID ${info.pid}).`);
  } else {
    console.log(`○ Cleaned up stale PID file (PID ${info.pid} was already stopped).`);
  }

  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
  return true;
}

export async function showStatus() {
  const info = readPidInfo();
  if (!info || !isProcessAlive(info.pid)) {
    console.log('○ Status: STOPPED');
    return { running: false };
  }

  let health = null;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/health`);
    if (res.ok) health = await res.json();
  } catch {
    // ignore
  }

  console.log(`● Status:    RUNNING (PID ${info.pid})`);
  console.log(`  Dashboard: http://127.0.0.1:${info.port}`);
  console.log(`  Started:   ${info.startedAt}`);
  if (health) {
    console.log(`  Events:    ${health.totalEvents} spans`);
    console.log(`  Uptime:    ${Math.round(health.uptimeMs / 1000)}s`);
  }
  console.log(`  Logs:      ${info.logFile}`);
  return { running: true, ...info, health };
}

export function showLogs(lines = 40) {
  if (!existsSync(LOG_FILE)) {
    console.log(`No log file yet at ${LOG_FILE}`);
    return;
  }
  const content = readFileSync(LOG_FILE, 'utf8').trim().split('\n');
  console.log(content.slice(-lines).join('\n'));
}

// CLI execution when invoked directly
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const cmd = (process.argv[2] ?? 'status').toLowerCase();
  const flags = parseFlags(process.argv.slice(3));

  (async () => {
    if (cmd === 'install') {
      ensureBuilt(true);
      console.log('✓ AgentPulse installed and built successfully.');
    } else if (cmd === 'start') {
      await startDaemon(flags);
    } else if (cmd === 'stop') {
      await stopDaemon();
    } else if (cmd === 'restart') {
      await stopDaemon();
      await startDaemon(flags);
    } else if (cmd === 'status') {
      await showStatus();
    } else if (cmd === 'logs') {
      showLogs(50);
    } else {
      console.log('Usage: node scripts/agentpulse-ctl.mjs <install|start|stop|restart|status|logs> [--port 4318] [--demo] [--no-open]');
      process.exit(1);
    }
  })().catch((err) => {
    console.error('Controller error:', err);
    process.exit(1);
  });
}

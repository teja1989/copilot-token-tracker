#!/usr/bin/env node
/**
 * Builds a self-contained, pre-built release zip (`release/agentpulse-v<version>.zip`)
 * including production-only node_modules so teammates can unzip and double-click
 * `start.command` (macOS) or `start.bat` (Windows) with ZERO git clone, ZERO npm install,
 * and ZERO build step.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const NPM_CMD = IS_WIN ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd = ROOT) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: IS_WIN });
  if (res.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';
const releaseName = `agentpulse-v${version}`;
const releaseDir = join(ROOT, 'release');
const stageDir = join(releaseDir, releaseName);
const zipPath = join(releaseDir, `${releaseName}.zip`);

console.log(`\n▶ Building ${releaseName}...`);
run(NPM_CMD, ['run', 'build'], ROOT);

console.log(`▶ Staging bundle in ${stageDir}...`);
rmSync(stageDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(join(stageDir, 'scripts'), { recursive: true });
mkdirSync(join(stageDir, 'web'), { recursive: true });

// Copy compiled server, compiled web UI, launchers, and docs
const copyList = [
  ['dist', 'dist'],
  ['web/dist', 'web/dist'],
  ['scripts/launch.mjs', 'scripts/launch.mjs'],
  ['scripts/agentpulse-ctl.mjs', 'scripts/agentpulse-ctl.mjs'],
  ['start.command', 'start.command'],
  ['start.bat', 'start.bat'],
  ['Makefile', 'Makefile'],
  ['agentpulse.config.example.json', 'agentpulse.config.example.json'],
  ['README.md', 'README.md'],
  ['package.json', 'package.json'],
  ['package-lock.json', 'package-lock.json'],
];

for (const [src, dest] of copyList) {
  const fullSrc = join(ROOT, src);
  if (!existsSync(fullSrc)) {
    console.error(`Missing required release file: ${src}`);
    process.exit(1);
  }
  cpSync(fullSrc, join(stageDir, dest), { recursive: true });
}

if (!IS_WIN) {
  chmodSync(join(stageDir, 'start.command'), 0o755);
  chmodSync(join(stageDir, 'scripts', 'launch.mjs'), 0o755);
  chmodSync(join(stageDir, 'scripts', 'agentpulse-ctl.mjs'), 0o755);
}

console.log('▶ Installing production-only runtime dependencies (no devDeps, no Vite)...');
run(NPM_CMD, ['ci', '--omit=dev', '--ignore-scripts'], stageDir);

console.log(`▶ Creating zip archive: ${zipPath}...`);
if (IS_WIN) {
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path "${stageDir}" -DestinationPath "${zipPath}" -Force`,
  ]);
} else {
  run('zip', ['-qr', zipPath, releaseName], releaseDir);
}

// Clean up unzipped staging directory, keeping only the zip
rmSync(stageDir, { recursive: true, force: true });

const sizeMb = (statSync(zipPath).size / (1024 * 1024)).toFixed(2);
console.log(`\n✓ Release bundle ready: ${zipPath} (${sizeMb} MB)`);
console.log('  Teammates just unzip and double-click start.command (macOS) or start.bat (Windows)!\n');

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeVersion = '22.22.0';

function targetTriple() {
  const argument = process.argv.slice(2).find((value) => value.startsWith('--target='));
  if (argument) return argument.slice('--target='.length);
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host:\s*(.+)$/m)?.[1]?.trim();
  if (!host) throw new Error('无法确定 Rust target triple，请传入 --target=<triple>');
  return host;
}

function nodeArchive(target) {
  if (target === 'x86_64-pc-windows-msvc') {
    return { name: `node-v${nodeVersion}-win-x64.zip`, executable: `node-v${nodeVersion}-win-x64/node.exe` };
  }
  if (target === 'aarch64-apple-darwin') {
    return { name: `node-v${nodeVersion}-darwin-arm64.tar.gz`, executable: `node-v${nodeVersion}-darwin-arm64/bin/node` };
  }
  throw new Error(`桌面版暂不支持 target: ${target}`);
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function ensureNode(target) {
  const archive = nodeArchive(target);
  const cacheDir = path.join(projectDir, '.cache', 'node-sidecars', `v${nodeVersion}`);
  const archivePath = path.join(cacheDir, archive.name);
  fs.mkdirSync(cacheDir, { recursive: true });
  const checksumsPath = path.join(cacheDir, 'SHASUMS256.txt');
  if (!fs.existsSync(checksumsPath)) {
    await download(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`, checksumsPath);
  }
  if (!fs.existsSync(archivePath)) {
    await download(`https://nodejs.org/dist/v${nodeVersion}/${archive.name}`, archivePath);
  }
  const expected = fs.readFileSync(checksumsPath, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.endsWith(`  ${archive.name}`))
    ?.split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
  if (!expected || expected !== actual) throw new Error(`Node sidecar 校验失败: ${archive.name}`);

  const extractDir = path.join(cacheDir, target);
  if (!fs.existsSync(path.join(extractDir, archive.executable))) {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    if (archive.name.endsWith('.zip')) {
      execFileSync('tar', ['-xf', archivePath, '-C', extractDir]);
    } else {
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir]);
    }
  }

  const binariesDir = path.join(projectDir, 'src-tauri', 'binaries');
  fs.mkdirSync(binariesDir, { recursive: true });
  const suffix = target.includes('windows') ? '.exe' : '';
  const destination = path.join(binariesDir, `node-${target}${suffix}`);
  fs.copyFileSync(path.join(extractDir, archive.executable), destination);
  if (!suffix) fs.chmodSync(destination, 0o755);
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

function installProductionDependencies(runtimeDir) {
  const args = ['ci', '--omit=dev', '--ignore-scripts'];
  const options = { cwd: runtimeDir, stdio: 'inherit' };
  const npmCli = process.env.npm_execpath;

  // Windows 上 .cmd 文件不能稳定地由 spawn/execFile 直接执行（Node 22
  // 会返回 EINVAL）。从 npm script 启动时直接让当前 Node 执行 npm CLI，
  // 同时保留直接运行本脚本时的兼容回退。
  if (npmCli) {
    execFileSync(process.execPath, [npmCli, ...args], options);
    return;
  }

  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    ...options,
    shell: process.platform === 'win32'
  });
}

function prepareRuntime() {
  const runtimeDir = path.join(projectDir, 'desktop-runtime');
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  ['dist', 'core', 'platforms', 'util', 'public'].forEach((directory) => {
    copyDirectory(path.join(projectDir, directory), path.join(runtimeDir, directory));
  });
  fs.rmSync(path.join(runtimeDir, 'platforms', 'test'), { recursive: true, force: true });
  ['package.json', 'package-lock.json', 'LICENSE'].forEach((file) => {
    fs.copyFileSync(path.join(projectDir, file), path.join(runtimeDir, file));
  });
  installProductionDependencies(runtimeDir);
}

const target = targetTriple();
await ensureNode(target);
prepareRuntime();
console.log(`桌面运行资源已准备完成: ${target}`);

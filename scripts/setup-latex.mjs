import { mkdir, writeFile, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Official, pinned Tectonic release. No npm dependencies or system PATH changes.
const version = '0.17.0';
const targets = {
  'win32-x64': 'x86_64-pc-windows-msvc.zip',
  'linux-x64': 'x86_64-unknown-linux-musl.tar.gz',
  'linux-arm64': 'aarch64-unknown-linux-musl.tar.gz',
  'darwin-x64': 'x86_64-apple-darwin.tar.gz',
  'darwin-arm64': 'aarch64-apple-darwin.tar.gz',
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error('Install Tectonic manually and set TECTONIC_PATH to its executable.');
const destination = fileURLToPath(new URL('../.tools/', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'folio-setup-'));
try {
  console.log(`Downloading Tectonic ${version} from its official GitHub release...`);
  const response = await fetch(`https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${version}/tectonic-${version}-${target}`);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const archive = path.join(temporary, target.endsWith('.zip') ? 'tectonic.zip' : 'tectonic.tar.gz');
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:FOLIO_ARCHIVE -DestinationPath $env:FOLIO_DESTINATION -Force'], {
      env: { ...process.env, FOLIO_ARCHIVE: archive, FOLIO_DESTINATION: temporary }, windowsHide: true, encoding: 'utf8',
    })
    : spawnSync('tar', ['-xzf', archive, '-C', temporary], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Could not extract Tectonic.');
  await mkdir(destination, { recursive: true });
  const binary = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic';
  await copyFile(path.join(temporary, binary), path.join(destination, binary));
  if (process.platform !== 'win32') {
    const { chmod } = await import('node:fs/promises');
    await chmod(path.join(destination, binary), 0o755);
  }
  console.log('LaTeX is ready. Run npm start. The first preview downloads and caches TeX packages.');
} finally { await rm(temporary, { recursive: true, force: true }); }

import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const localCompiler = path.join(root, '.tools', process.platform === 'win32' ? 'tectonic.exe' : 'tectonic');
let compiler = process.env.TECTONIC_PATH;
if (!compiler) {
  try { await access(localCompiler, constants.X_OK); compiler = localCompiler; }
  catch { compiler = 'tectonic'; }
}
const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']], ['/tokens.css', ['tokens.css', 'text/css']],
  ['/base.css', ['base.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']],
  ['/cv-model.js', ['cv-model.js', 'text/javascript']], ['/base.tex', ['base.tex', 'text/plain']],
]);
let compiling = false;

function json(res, status, message, detail) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ message, detail }));
}

async function compile(req, res) {
  if (compiling) return json(res, 429, 'The compiler is busy. Try again in a moment.');
  if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, 'Send LaTeX as JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 300_000) return json(res, 413, 'This document is too large (maximum 300 KB).');
    chunks.push(chunk);
  }
  let source;
  try { source = JSON.parse(Buffer.concat(chunks).toString('utf8')).source; }
  catch { return json(res, 400, 'The document request is invalid.'); }
  if (typeof source !== 'string' || !source.trim()) return json(res, 400, 'Add a LaTeX document to compile.');
  // The body was streamed above; acquire the compiler slot only after it is read.
  if (compiling) return json(res, 429, 'The compiler is busy. Try again in a moment.');
  compiling = true;
  let directory;
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'folio-cv-'));
    await writeFile(path.join(directory, 'cv.tex'), source);
    await new Promise((resolve, reject) => {
      const child = spawn(compiler, ['--untrusted', '--keep-logs', '--outdir', directory, 'cv.tex'], {
        cwd: directory, windowsHide: true,
        env: { ...process.env, TECTONIC_UNTRUSTED_MODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 300_000);
      const collect = chunk => { log = (log + chunk.toString()).slice(-16_000); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const cancel = () => { if (!res.writableEnded) child.kill(); };
      res.on('close', cancel);
      child.on('error', error => {
        clearTimeout(timeout); res.off('close', cancel);
        reject(new Error(error.code === 'ENOENT' ? 'LaTeX compiler not installed. Run npm run setup:latex, then restart the server.' : error.message));
      });
      child.on('close', code => {
        clearTimeout(timeout); res.off('close', cancel);
        if (code === 0) resolve();
        else reject(new Error(timedOut ? 'Compilation timed out. Check your source and try again.' : log || 'The LaTeX compiler stopped. Check the source and try again.'));
      });
    });
    const pdf = await readFile(path.join(directory, 'cv.pdf'));
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': pdf.length,
      'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="cv.pdf"',
      'X-PDF-Pages': String(pages),
    });
    res.end(pdf);
  } catch (error) {
    if (!res.destroyed) json(res, 422, 'Your PDF could not be compiled.', error.message);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    compiling = false;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // This is a local editor, not a public TeX execution service.
  const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!allowedHosts.includes(req.headers.host)) return json(res, 403, 'Use the local editor address.');
  if (req.headers.origin && !allowedHosts.some(host => req.headers.origin === `http://${host}`)) return json(res, 403, 'This request must come from the editor.');
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/api/compile' && req.method === 'POST') return await compile(req, res);
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, 'Method not allowed.');
    const asset = assets.get(url.pathname);
    if (!asset) return json(res, 404, 'File not found.');
    const data = await readFile(path.join(root, asset[0]));
    res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) json(res, 500, 'The editor could not complete the request.', error.message);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Folio is ready at http://localhost:${port}`));

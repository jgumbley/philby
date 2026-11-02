import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { stripVTControlCharacters } from 'node:util';
import { graphLock } from './wiki.mjs';

const module = fileURLToPath(new URL('./', import.meta.url));
const ttyd = join(module, '.tools/ttyd');
function command(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${program} failed: ${result.status ?? result.signal}`);
}
function identity(pid) {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return fields[0] === 'Z' ? null : fields[19];
  }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function saved(file) {
  if (!existsSync(file)) return null;
  const state = JSON.parse(readFileSync(file, 'utf8'));
  const current = identity(state.pid);
  if (current === null || current !== state.identity) return null;
  return state;
}
async function ready(state) {
  const response = await fetch(`http://127.0.0.1:${state.port}/`, { signal: AbortSignal.timeout(1000) });
  if (!response.ok || !(await response.text()).includes('ttyd')) throw Error('ttyd HTTP health check failed');
}
async function start(graph, file) {
  const port = Number(process.env.VIEWER_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('VIEWER_PORT must be 1–65535');
  const current = saved(file);
  if (current) {
    if (current.port !== port) throw Error(`Viewer already runs on port ${current.port}; stop it before changing ports`);
    await ready(current);
    console.log(`Viewer running: http://localhost:${port}/`);
    return;
  }
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => server.close(error => error ? reject(error) : resolve()));
  });
  command('node', [join(module, 'wiki.mjs'), 'lint']);
  const log = openSync(join(graph, '.graphwiki/viewer.log'), 'a', 0o600);
  const child = spawn(ttyd, ['-i', '0.0.0.0', '-p', String(port), '-W', '-t', 'titleFixed=Graphwiki', '-t', 'disableLeaveAlert=true', 'node', join(module, 'wiki.mjs'), 'browse'], {
    detached: true, stdio: ['ignore', log, log], env: { ...process.env, GRAPH_ROOT: graph },
  });
  closeSync(log);
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  const state = { pid: child.pid, identity: identity(child.pid), port };
  writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!saved(file)) throw Error(`ttyd exited; inspect ${join(graph, '.graphwiki/viewer.log')}`);
    try { await ready(state); console.log(`Viewer running: http://localhost:${port}/ (0.0.0.0, unauthenticated)`); return; }
    catch (error) { if (attempt === 29) { await stop(file); throw error; } }
  }
}
async function stop(file) {
  const state = saved(file);
  if (state) {
    process.kill(-state.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 50 && saved(file); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    if (saved(file)) throw Error('ttyd did not stop within five seconds');
  }
  if (existsSync(file)) unlinkSync(file);
  console.log('Viewer stopped');
}
async function capture() {
  const port = Number(process.env.VIEWER_PORT || 8080);
  const response = await fetch(`http://127.0.0.1:${port}/token`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw Error(`ttyd token request failed: HTTP ${response.status}`);
  const { token } = await response.json();
  const input = process.env.PROMPT_FILE ? readFileSync(process.env.PROMPT_FILE, 'utf8') : process.env.PROMPT || (process.stdin.isTTY ? '' : readFileSync(0, 'utf8'));
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, 'tty');
    socket.binaryType = 'arraybuffer';
    let output = '';
    let sent = false;
    let settle;
    const deadline = setTimeout(() => finish(Error('Viewer produced no terminal output within ten seconds')), 10000);
    function finish(error) {
      clearTimeout(deadline); clearTimeout(settle); socket.close();
      if (error) reject(error);
      else { console.log(stripVTControlCharacters(output)); resolve(); }
    }
    socket.onopen = () => socket.send(JSON.stringify({ AuthToken: token, columns: 100, rows: 30 }));
    socket.onerror = () => finish(Error('Viewer WebSocket failed'));
    socket.onmessage = event => {
      const bytes = Buffer.from(event.data);
      if (bytes[0] !== 48) return;
      output += bytes.subarray(1).toString('utf8');
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (!sent && input) { sent = true; socket.send(`0${input}`); return; }
        finish();
      }, 500);
    };
  });
}
async function main() {
  const operation = process.argv[2];
  if (operation === 'capture') return capture();
  if (operation === 'install') {
    if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('Local ttyd installation requires Linux x86_64');
    if (existsSync(ttyd)) { command(ttyd, ['--version']); return; }
    const response = await fetch('https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64');
    if (!response.ok) throw Error(`ttyd download failed: HTTP ${response.status}`);
    mkdirSync(join(module, '.tools'), { recursive: true });
    writeFileSync(ttyd, Buffer.from(await response.arrayBuffer()), { mode: 0o755 });
    chmodSync(ttyd, 0o755);
    command(ttyd, ['--version']);
    return;
  }
  if (operation === 'doctor') {
    for (const [program, args] of [[ttyd, ['--version']], ['cargo', ['--version']], ['flock', ['--version']]]) command(program, args);
    return;
  }
  if (!process.env.GRAPH_ROOT) throw Error('GRAPH_ROOT is required');
  const graph = realpathSync(process.env.GRAPH_ROOT);
  const file = join(graph, '.graphwiki/viewer.json');
  if (process.argv[3] !== 'locked') {
    command('flock', ['-w', '60', `${graphLock(graph)}.viewer`, 'node', fileURLToPath(import.meta.url), operation, 'locked']);
    return;
  }
  mkdirSync(join(graph, '.graphwiki'), { recursive: true });
  if (operation === 'start') return start(graph, file);
  if (operation === 'stop') return stop(file);
  if (operation !== 'status') throw Error(`Unknown viewer operation: ${operation}`);
  const state = saved(file);
  if (!state) throw Error('Viewer is stopped');
  await ready(state);
  console.log(`Viewer running: pid=${state.pid} http://localhost:${state.port}/ (0.0.0.0, unauthenticated)`);
}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });

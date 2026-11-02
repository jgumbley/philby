import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function prompt() {
  if (process.env.PROMPT_FILE) return readFileSync(process.env.PROMPT_FILE, 'utf8');
  if (process.env.PROMPT) return process.env.PROMPT;
  if (process.stdin.isTTY) throw Error('Supply PROMPT_FILE, prompt, or stdin');
  return readFileSync(0, 'utf8');
}

export function graphLock(graph) {
  const locks = join(tmpdir(), `philby-wiki-${process.getuid()}`);
  mkdirSync(locks, { recursive: true, mode: 0o700 });
  return join(locks, createHash('sha256').update(graph).digest('hex') + '.lock');
}

async function main() {
  const operation = process.argv[2];
  if (!['context', 'publish', 'index', 'lint', 'browse'].includes(operation)) throw Error('Unknown wiki operation');
  if (!process.env.GRAPH_ROOT) throw Error('GRAPH_ROOT is required');
  const graph = realpathSync(process.env.GRAPH_ROOT);
  const argument = operation === 'context' ? prompt() : operation === 'publish' ? process.env.CHANGE || '' : '';
  if (['context', 'publish'].includes(operation) && !argument.trim()) throw Error(operation === 'context' ? 'Nonempty search prompt required' : 'CHANGE is required');
  const lock = graphLock(graph);
  const engine = fileURLToPath(new URL('./', import.meta.url));
  await new Promise((resolve, reject) => {
    const invocation = ['make', '--no-print-directory', '-s', '-C', engine, 'invoke'];
    const command = operation === 'browse' ? invocation : ['flock', '-w', '60', lock, ...invocation];
    const child = spawn(command[0], command.slice(1), {
      stdio: 'inherit',
      env: { ...process.env, MAKEFLAGS: '', MAKEOVERRIDES: '', MFLAGS: '', OPERATION: operation, GRAPH_ROOT: graph, ARGUMENT: argument, GRAPHWIKI_LOCK: lock },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(Error(`Wiki ${operation} failed: ${signal || code}`)));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}

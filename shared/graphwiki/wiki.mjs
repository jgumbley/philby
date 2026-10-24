import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function prompt() {
  if (process.env.PROMPT_FILE) return readFileSync(process.env.PROMPT_FILE, 'utf8');
  if (process.env.PROMPT) return process.env.PROMPT;
  if (process.stdin.isTTY) throw Error('Supply PROMPT_FILE, prompt, or stdin');
  return readFileSync(0, 'utf8');
}

async function main() {
  const operation = process.argv[2];
  if (!['context', 'publish', 'index', 'lint'].includes(operation)) throw Error('Unknown wiki operation');
  if (!process.env.GRAPH_ROOT) throw Error('GRAPH_ROOT is required');
  const graph = realpathSync(process.env.GRAPH_ROOT);
  const argument = operation === 'context' ? prompt() : operation === 'publish' ? process.env.CHANGE || '' : '';
  if (['context', 'publish'].includes(operation) && !argument.trim()) throw Error(operation === 'context' ? 'Nonempty search prompt required' : 'CHANGE is required');
  const locks = join(tmpdir(), `philby-wiki-${process.getuid()}`);
  mkdirSync(locks, { recursive: true, mode: 0o700 });
  const lock = join(locks, createHash('sha256').update(graph).digest('hex') + '.lock');
  const engine = fileURLToPath(new URL('./', import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn('flock', ['-w', '60', lock, 'make', '--no-print-directory', '-s', '-C', engine, 'invoke'], {
      stdio: 'inherit',
      env: { ...process.env, MAKEFLAGS: '', MAKEOVERRIDES: '', MFLAGS: '', OPERATION: operation, GRAPH_ROOT: graph, ARGUMENT: argument },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(Error(`Wiki ${operation} failed: ${signal || code}`)));
  });
}

main().catch(error => { console.error(String(error)); process.exitCode = 1; });

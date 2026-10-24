import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const { readPrompt, research } = await import(pathToFileURL(join(process.cwd(), 'shared/research.mjs')).href);
const env = { OPENROUTER_API_KEY: 'test-research-credential' };
const completion = (content: unknown = 'Use the documented command.', finish = 'stop') => ({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] });

test('research preserves prompt precedence and literal input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'philby-research-'));
  const literal = 'First line\n"quotes" $HOME `literal` $(literal) \'quoted\'\n';
  const promptFile = join(directory, 'prompt.txt');
  const inputFile = join(directory, 'stdin.txt');
  writeFileSync(promptFile, literal);
  writeFileSync(inputFile, literal + 'stdin');
  const fd = openSync(inputFile, 'r');
  try {
    assert.equal(readPrompt({ PROMPT_FILE: relative(process.cwd(), promptFile), PROMPT: 'ignored' }, { isTTY: true }), literal);
    assert.equal(readPrompt({ PROMPT: literal }, { isTTY: true }), literal);
    assert.equal(readPrompt({}, { fd, isTTY: false }), literal + 'stdin');
    assert.throws(() => readPrompt({}, { isTTY: true }), /Supply PROMPT_FILE/);
    assert.throws(() => readPrompt({ PROMPT: ' \n' }, { isTTY: true }), /nonempty/);
    writeFileSync(promptFile, ' \n');
    assert.throws(() => readPrompt({ PROMPT_FILE: promptFile, PROMPT: 'ignored' }, { isTTY: true }), /nonempty/);
    assert.throws(() => readPrompt({ PROMPT_FILE: join(directory, 'missing'), PROMPT: 'ignored' }), /ENOENT/);
  } finally { closeSync(fd); rmSync(directory, { recursive: true, force: true }); }
});

test('research requests bounded OpenRouter search and fetch using the exact catalog model', async () => {
  for (const requested of [undefined, 'openrouter/z-ai/glm-5.2']) {
    let calls = 0;
    const answer = await research('Find the next step.\nKeep $HOME literal.', {
      env: { ...env, RESEARCH_MODEL: requested },
      fetch: async (url: string, options: RequestInit) => {
        calls++;
        assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
        assert.equal(options.method, 'POST');
        assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${env.OPENROUTER_API_KEY}`);
        assert.equal(new Headers(options.headers).get('Content-Type'), 'application/json');
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.signal.aborted, false);
        const request = JSON.parse(String(options.body));
        assert.equal(request.model, requested ? 'z-ai/glm-5.2' : 'openai/gpt-5.5');
        assert.equal(request.stream, false);
        assert.equal(request.messages.at(-1).content, 'Find the next step.\nKeep $HOME literal.');
        assert.deepEqual(request.tools, [{ type: 'openrouter:web_search' }, { type: 'openrouter:web_fetch' }]);
        assert.equal(request.max_tool_calls, 6);
        return Response.json({ ...completion('  Use [the docs](https://example.com/docs).\n'), usage: { total_tokens: 20 }, annotations: [{ ignored: true }] });
      },
    });
    assert.equal(answer, 'Use [the docs](https://example.com/docs).');
    assert.equal(calls, 1);
  }
});

test('research rejects missing credentials and unsupported model names before calling OpenRouter', async () => {
  let calls = 0;
  const fetch = async () => { calls++; throw Error('Unexpected HTTP request'); };
  await assert.rejects(research('question', { env: {}, fetch }), /OPENROUTER_API_KEY/);
  await assert.rejects(research(' \n', { env, fetch }), /nonempty/);
  for (const model of ['not-a-model', 'openai/gpt-5.5:online']) {
    await assert.rejects(research('question', { env: { ...env, RESEARCH_MODEL: model }, fetch }), /unavailable|omit :online/);
  }
  assert.equal(calls, 0);
});

test('research surfaces HTTP, malformed, incomplete and empty responses without retrying', async () => {
  const responses: [() => Response, RegExp][] = [
    [() => Response.json({ error: { message: 'Rate limited' } }, { status: 429 }), /HTTP 429.*Rate limited/],
    [() => new Response('<html>bad gateway</html>', { status: 502 }), /invalid JSON.*502/],
    [() => new Response('not JSON'), /invalid JSON/],
    [() => Response.json({ error: { message: 'Tool failed' } }), /Tool failed/],
    [() => Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'error', error: { message: 'Provider failed' } }] }), /Provider failed/],
    [() => Response.json({ choices: [] }), /invalid answer/],
    [() => Response.json(completion(null)), /invalid answer/],
    [() => Response.json(completion('partial', 'length')), /did not complete.*length/],
    [() => Response.json(completion(' \n')), /empty answer/],
  ];
  for (const [response, expected] of responses) {
    let calls = 0;
    await assert.rejects(research('question', { env, fetch: async () => { calls++; return response(); } }), expected);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(research('question', { env, fetch: async () => { calls++; throw Error(`Connection failed for ${env.OPENROUTER_API_KEY}`); } }), error => {
    assert.match(String(error), /Connection failed/);
    assert.ok(!String(error).includes(env.OPENROUTER_API_KEY));
    return true;
  });
  assert.equal(calls, 1);
});

test('root and shared Make research preserve caller inputs and return only text without pane state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'philby-research-make-'));
  const preload = join(directory, 'mock.mjs');
  const promptFile = join(directory, 'prompt.txt');
  const state = join(directory, 'state');
  const panes = join(directory, 'panes');
  const literal = 'Two lines\n"quotes" $HOME `literal` $(literal) \'single\'';
  writeFileSync(promptFile, literal);
  writeFileSync(preload, `globalThis.fetch = async (url, options) => {
    if (url !== 'https://openrouter.ai/api/v1/chat/completions') throw Error('Unexpected endpoint');
    if (options.headers.Authorization !== 'Bearer test-research-credential') throw Error('Environment credential was not preserved');
    const content = JSON.parse(options.body).messages.at(-1).content;
    if (content === 'fail-request') return Response.json({error:{message:'Research unavailable'}},{status:503});
    return Response.json({choices:[{message:{content},finish_reason:'stop'}],usage:{total_tokens:20}});
  };`);
  function make(args: string[], input = ''): Promise<{ code: number | null, out: string, err: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('make', ['--no-print-directory', '-s', ...args], {
        cwd: process.cwd(),
        env: { ...process.env, ...env, PROMPT: '', PROMPT_FILE: '', RESEARCH_MODEL: '', NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, PHILBY_HOME: state, PHILBY_PANES_DIR: panes, PHILBY_TEST_PROVIDER: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '', err = '';
      child.stdout.on('data', chunk => out += chunk);
      child.stderr.on('data', chunk => err += chunk);
      child.on('error', reject);
      child.on('close', code => resolve({ code, out, err }));
      child.stdin.end(input);
    });
  }
  try {
    for (const args of [
      ['research'],
      ['research', `prompt=${literal}`],
      ['research', `PROMPT_FILE=${relative(process.cwd(), promptFile)}`, 'prompt=ignored'],
      ['-C', 'shared', 'research', `PROMPT_FILE=${relative(join(process.cwd(), 'shared'), promptFile)}`, 'prompt=ignored'],
    ]) {
      const result = await make(args, literal);
      assert.equal(result.code, 0, result.err);
      assert.equal(result.out, literal + '\n');
    }
    const failure = await make(['research'], 'fail-request');
    assert.notEqual(failure.code, 0);
    assert.equal(failure.out, '');
    assert.match(failure.err, /HTTP 503.*Research unavailable/);
    assert.equal(existsSync(state), false);
    assert.equal(existsSync(panes), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('research timeout covers the initial request and response body', async () => {
  for (const stage of ['request', 'body']) {
    const controller = new AbortController();
    let calls = 0;
    const fetch = async (_url: string, options: RequestInit) => {
      calls++;
      const wait = () => new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
        controller.abort(new DOMException('Timed out', 'TimeoutError'));
      });
      if (stage === 'request') return wait();
      return { ok: true, status: 200, json: wait };
    };
    await assert.rejects(research('question', { env, fetch, signal: controller.signal }), /timed out/);
    assert.equal(calls, 1);
  }
});

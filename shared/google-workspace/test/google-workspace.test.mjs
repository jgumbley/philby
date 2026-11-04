import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const makefile = join(root, 'shared', 'Makefile');
let directory;
let bin;
let sequence = 0;

async function invoke({target = 'read', cwd = directory, vars = {}, env: supplied = {}, stdin = '', account = 'reader@example.com'} = {}) {
  const env = {...process.env};
  for (const name of Object.keys(env)) {
    if (name.startsWith('GOG_') || ['MAKEFLAGS', 'MFLAGS', 'MAKEOVERRIDES', 'GOOGLE_ACCOUNT', 'URL', 'SPACE', 'TYPE', 'SINCE', 'OUTPUT', 'RANGE', 'MAX_BYTES', 'MAX_SLIDES', 'PROMPT_FILE', 'PROMPT', 'prompt', 'CREDENTIALS_FILE'].includes(name)) delete env[name];
  }
  const log = join(directory, `calls-${sequence++}.jsonl`);
  await writeFile(log, '');
  Object.assign(env, {PATH: `${bin}:${env.PATH}`, GOG_TEST_LOG: log}, supplied);
  if (account !== null) env.GOOGLE_ACCOUNT = account;
  const args = ['--no-print-directory', '-s', '-f', makefile, `google-workspace-${target}`, ...Object.entries(vars).map(([name, value]) => `${name}=${value}`)];
  const child = spawn('make', args, {cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', error => {
    if (error.code !== 'EPIPE') child.emit('error', error);
  });
  child.stdin.end(stdin);
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      reject(Error(`Google Workspace command timed out\n${stderr}`));
    }, 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({code, signal, stdout, stderr}); });
  });
  result.calls = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return result;
}

function success(result) {
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

function failure(result) {
  assert.notEqual(result.code, 0);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.trim());
}

function readonly(calls) {
  assert.ok(calls.length > 0);
  for (const args of calls) {
    assert.ok(args.includes('--readonly'), JSON.stringify(args));
    assert.ok(args.includes('--no-input'), JSON.stringify(args));
    const index = args.indexOf('--account');
    assert.ok(index >= 0, JSON.stringify(args));
    assert.equal(args[index + 1], 'reader@example.com');
  }
}

before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'philby-google-workspace-')));
  bin = join(directory, 'bin');
  await mkdir(bin);
  const source = await readFile(new URL('./fake-gog.mjs', import.meta.url), 'utf8');
  await writeFile(join(bin, 'gog'), `#!${process.execPath}\n${source}`, {mode: 0o700});
});

after(async () => {
  if (directory) await rm(directory, {recursive: true, force: true});
});

test('diagnostics inspect only local metadata and login requires an interactive terminal', async () => {
  const installation = await invoke({target: 'diagnose', account: null});
  assert.match(JSON.parse(success(installation)).version, /9\.99\.0/);
  assert.equal(installation.calls.length, 1);
  const registration = await invoke({target: 'diagnose'});
  const payload = JSON.parse(success(registration));
  assert.equal(payload.account, 'reader@example.com');
  assert.deepEqual(payload.services, ['chat', 'drive', 'docs', 'sheets', 'slides']);
  assert.doesNotMatch(registration.stdout, /other@example\.com/);
  assert.ok(registration.calls.every(args => !args.includes('--check')));
  const login = await invoke({target: 'login'});
  failure(login);
  assert.match(login.stderr, /interactive terminal/);
  assert.equal(login.calls.length, 0);
});

test('client and output modes remain explicit when gog environment defaults differ', async () => {
  const env = {GOG_JSON: '1', GOG_PLAIN: '1', GOG_CLIENT: 'other'};
  const text = await invoke({vars: {URL: 'https://docs.google.com/document/d/docId/edit'}, env});
  assert.equal(success(text), 'Body for docId\n');
  const messages = await invoke({target: 'messages', vars: {SPACE: 'spaces/team'}, env});
  assert.equal(JSON.parse(success(messages)).messages.length, 3);
  const diagnostic = await invoke({target: 'diagnose', env});
  assert.equal(JSON.parse(success(diagnostic)).account, 'reader@example.com');
  for (const args of [...text.calls, ...messages.calls, ...diagnostic.calls]) {
    assert.ok(args.includes('--plain=false'), JSON.stringify(args));
    assert.equal(args[args.indexOf('--client') + 1], 'default');
  }
  assert.ok(text.calls.every(args => args.includes('--json=false')));
  assert.ok(messages.calls.every(args => args.includes('--json')));
  assert.ok(diagnostic.calls.find(args => args.includes('list')).includes('--json'));
  assert.ok(diagnostic.calls.find(args => args.includes('--version')).includes('--json=false'));
});

test('document inputs preserve prompt precedence and report unreadable explicit files', async () => {
  const promptFile = join(directory, 'url.txt');
  await writeFile(promptFile, 'https://docs.google.com/document/d/fromFile/edit\n');
  const file = await invoke({vars: {PROMPT_FILE: promptFile, prompt: 'https://docs.google.com/document/d/fromPrompt/edit'}, stdin: 'https://docs.google.com/document/d/fromStdin/edit'});
  assert.match(success(file), /Body for fromFile/);
  readonly(file.calls);
  assert.match(success(await invoke({vars: {prompt: 'https://docs.google.com/document/d/fromPrompt/edit'}, stdin: 'https://docs.google.com/document/d/fromStdin/edit'})), /Body for fromPrompt/);
  assert.match(success(await invoke({env: {PROMPT: 'https://docs.google.com/document/d/fromEnvironment/edit'}, stdin: 'https://docs.google.com/document/d/fromStdin/edit'})), /Body for fromEnvironment/);
  assert.match(success(await invoke({stdin: 'https://docs.google.com/document/d/fromStdin/edit\n'})), /Body for fromStdin/);
  failure(await invoke({vars: {PROMPT_FILE: join(directory, 'missing.txt'), prompt: 'https://docs.google.com/document/d/fromPrompt/edit'}}));
});

test('invalid inputs fail without using Google or inventing an account', async () => {
  for (const options of [
    {account: null, vars: {URL: 'https://docs.google.com/document/d/docId/edit'}},
    {vars: {URL: 'https://docs.google.com.evil.example/document/d/docId/edit'}},
    {vars: {URL: 'http://docs.google.com/document/d/docId/edit'}},
    {vars: {URL: 'https://example.com/document/d/docId/edit'}},
    {target: 'export', vars: {SPACE: 'spaces/team', OUTPUT: join(directory, 'missing-since.json')}},
    {target: 'messages', vars: {SPACE: '--help'}},
  ]) {
    const result = await invoke(options);
    failure(result);
    assert.equal(result.calls.length, 0);
  }
});

test('Make passes literal filenames without shell expansion', async () => {
  const cwd = join(directory, 'literal inputs');
  await mkdir(cwd);
  const literal = '$HOME $(shell touch injected) `touch injected` " quote';
  const input = `url ${literal}.txt`;
  const output = `result ${literal}.txt`;
  await writeFile(join(cwd, input), 'https://docs.google.com/document/d/docId/edit');
  const result = await invoke({cwd, vars: {PROMPT_FILE: input, OUTPUT: output}});
  assert.deepEqual(JSON.parse(success(result)), {output: join(cwd, output)});
  assert.match(await readFile(join(cwd, output), 'utf8'), /Body for docId/);
  assert.deepEqual((await readdir(cwd)).sort(), [input, output].sort());
  assert.equal((await stat(join(cwd, output))).mode & 0o777, 0o600);
});

test('native Drive documents use their readers and binary files require downloads', async () => {
  assert.match(success(await invoke({vars: {URL: 'https://drive.google.com/file/d/docId/view'}})), /Body for docId/);
  assert.match(success(await invoke({vars: {URL: 'https://docs.google.com/spreadsheets/d/sheetId/edit', RANGE: 'Sheet 1!A1:B2'}})), /Heading\tValue/);
  assert.match(success(await invoke({vars: {URL: 'https://docs.google.com/spreadsheets/d/sheetId/edit'}})), /Heading,Value/);
  const slides = await invoke({vars: {URL: 'https://docs.google.com/presentation/d/slidesId/edit'}});
  const text = success(slides);
  assert.match(text, /Text for slide_one/);
  assert.match(text, /Notes for slide_two/);
  assert.ok(text.indexOf('Text for slide_one') < text.indexOf('Text for slide_two'));
  failure(await invoke({vars: {URL: 'https://drive.google.com/file/d/binaryId/view'}}));
});

test('text limits apply to docs, sheet ranges and slides with visible truncation', async () => {
  for (const vars of [
    {URL: 'https://docs.google.com/document/d/docId/edit'},
    {URL: 'https://docs.google.com/spreadsheets/d/sheetId/edit', RANGE: 'A1:B2'},
    {URL: 'https://docs.google.com/presentation/d/slidesId/edit'},
  ]) {
    const result = await invoke({vars: {...vars, MAX_BYTES: '80'}, env: {GOG_TEST_TEXT: 'é'.repeat(200)}});
    const text = success(result);
    assert.ok(Buffer.byteLength(text) <= 240, text);
    assert.ok(!text.includes('\uFFFD'));
    assert.match(text + result.stderr, /truncat/i);
  }
  const slides = await invoke({vars: {URL: 'https://docs.google.com/presentation/d/slidesId/edit', MAX_SLIDES: '1'}});
  assert.match(success(slides), /Text for slide_one/);
  assert.doesNotMatch(slides.stdout, /Text for slide_two/);
  assert.match(slides.stdout + slides.stderr, /truncat|limit|omitt/i);
});

test('chat reads collect pages, order messages and filter spaces without writes', async () => {
  const messages = await invoke({target: 'messages', vars: {SPACE: 'spaces/team'}});
  const payload = JSON.parse(success(messages));
  assert.deepEqual(payload.messages.map(message => message.text), ['Old message', 'Middle message', 'New message']);
  readonly(messages.calls);
  assert.ok(messages.calls[0].includes('--all'));
  const spaces = await invoke({target: 'spaces', vars: {TYPE: 'direct'}});
  const listed = JSON.parse(success(spaces)).spaces;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].resource, 'spaces/direct');
  assert.equal(listed[0].lastMessageTime, '2026-02-03T12:00:00Z');
  readonly(spaces.calls);
  assert.ok(spaces.calls[0].includes('--all'));
});

test('exports filter by timestamp and output files are exclusive', async () => {
  const output = join(directory, 'chat.json');
  const vars = {SPACE: 'spaces/team', SINCE: '2026-02-01T00:00:00Z', OUTPUT: output};
  assert.deepEqual(JSON.parse(success(await invoke({target: 'export', vars}))), {output});
  const original = await readFile(output);
  const data = JSON.parse(original);
  assert.equal(data.space, 'spaces/team');
  assert.equal(data.since, vars.SINCE);
  assert.equal(data.messageCount, 2);
  assert.equal(data.threadCount, 1);
  assert.deepEqual(data.messages.map(message => message.text), ['Middle message', 'New message']);
  failure(await invoke({target: 'export', vars}));
  assert.deepEqual(await readFile(output), original);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  failure(await invoke({target: 'export', vars: {...vars, SINCE: 'yesterday', OUTPUT: join(directory, 'invalid-date.json')}}));
});

test('downloads preserve binary bytes and never overwrite files', async () => {
  const output = join(directory, 'download.bin');
  const vars = {URL: 'https://drive.google.com/file/d/binaryId/view', OUTPUT: output};
  const result = await invoke({target: 'download', vars, env: {GOG_TEST_EXTENSION: '.pdf'}});
  assert.deepEqual(JSON.parse(success(result)), {output});
  assert.deepEqual(await readFile(output), Buffer.from([0, 255, 128, 10, 42]));
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  readonly(result.calls);
  failure(await invoke({target: 'download', vars}));
  assert.deepEqual(await readFile(output), Buffer.from([0, 255, 128, 10, 42]));
});

test('output symlinks are rejected without changing their destinations', async () => {
  const original = join(directory, 'symlink-destination.txt');
  await writeFile(original, 'Saved work');
  const existing = join(directory, 'existing-link');
  const dangling = join(directory, 'dangling-link');
  await symlink(original, existing);
  await symlink(join(directory, 'absent-destination.txt'), dangling);
  for (const target of ['read', 'download']) {
    for (const output of [existing, dangling]) {
      const result = await invoke({target, vars: {URL: 'https://docs.google.com/document/d/docId/edit', OUTPUT: output}});
      failure(result);
      assert.equal(result.calls.length, 0);
    }
  }
  assert.equal(await readFile(original, 'utf8'), 'Saved work');
});

test('client failures and malformed responses surface without partial output', async () => {
  const rejected = await invoke({target: 'spaces', env: {GOG_TEST_FAILURE: 'chat messages'}});
  failure(rejected);
  assert.match(rejected.stderr, /permission denied/);
  failure(await invoke({vars: {URL: 'https://docs.google.com/spreadsheets/d/sheetId/edit', RANGE: 'A1:B2'}, env: {GOG_TEST_MALFORMED: 'sheets get'}}));
});

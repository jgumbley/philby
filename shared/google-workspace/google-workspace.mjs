import {spawn} from 'node:child_process';
import {constants, readFileSync} from 'node:fs';
import {access, chmod, copyFile, lstat, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';

const services = 'chat,drive,docs,sheets,slides';

async function command(binary, args, interactive = false) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(binary, args, {stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe']});
    const output = [];
    const errors = [];
    let size = 0;
    let failure;
    const stop = reason => {
      failure = Error(reason);
      child.kill('SIGKILL');
    };
    const cancel = signal => stop(`${binary} interrupted by ${signal}`);
    const interrupt = () => cancel('SIGINT');
    const terminate = () => cancel('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    const timer = interactive ? undefined : setTimeout(() => stop(`${binary} exceeded 120 seconds`), 120000);
    for (const [stream, chunks] of [[child.stdout, output], [child.stderr, errors]]) {
      stream?.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) stop(`${binary} response exceeded 64 MiB`);
        else chunks.push(chunk);
      });
    }
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    };
    child.once('error', error => {
      cleanup();
      reject(error.code === 'ENOENT' ? Error(`${binary} is required on PATH`) : error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      const stderr = Buffer.concat(errors).toString('utf8').trim();
      if (failure) reject(failure);
      else if (code !== 0) reject(Error(`${binary} failed (${signal || code})${stderr ? `: ${stderr}` : ''}`));
      else {
        if (stderr) process.stderr.write(`${stderr}\n`);
        resolveCommand(Buffer.concat(output).toString('utf8'));
      }
    });
  });
}

function required(name) {
  const value = process.env[name];
  if (!value?.trim()) throw Error(`${name} is required`);
  return value;
}

function account() {
  const value = required('GOOGLE_ACCOUNT');
  if (!/^[^\s@]+@[^\s@]+$/.test(value)) throw Error('GOOGLE_ACCOUNT must be an email address');
  return value;
}

function positive(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error(`${name} must be a positive integer`);
  return Number(value);
}

function parseJSON(text) {
  try { return JSON.parse(text); }
  catch { throw Error('gog returned invalid JSON'); }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`Invalid gog ${label} response`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw Error(`Invalid gog ${label} response`);
  return value;
}

async function gog(args, json = true) {
  return client(['--readonly', '--no-input', '--account', account(), ...args], json);
}

async function client(args, json = false, interactive = false) {
  const output = await command('gog', ['--client', 'default', '--plain=false', json ? '--json' : '--json=false', ...args], interactive);
  return json ? parseJSON(output) : output;
}

async function target() {
  let value;
  if (process.env.URL) value = process.env.URL;
  else if (process.env.PROMPT_FILE) value = await readFile(process.env.PROMPT_FILE, 'utf8');
  else if (process.env.PROMPT) value = process.env.PROMPT;
  else {
    if (process.stdin.isTTY) throw Error('Supply URL, PROMPT_FILE, prompt, or stdin');
    value = readFileSync(0, 'utf8');
  }
  value = value.trim();
  if (/^[A-Za-z0-9_-]+$/.test(value)) return {kind: 'drive', id: value};
  let url;
  try { url = new globalThis.URL(value); }
  catch { throw Error('Supply a Google Workspace URL or file ID'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !['docs.google.com', 'drive.google.com'].includes(url.hostname)) {
    throw Error('URL must be an HTTPS docs.google.com or drive.google.com URL');
  }
  const patterns = url.hostname === 'docs.google.com'
    ? [['doc', /^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)(?:\/|$)/], ['sheet', /^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)(?:\/|$)/], ['slides', /^\/presentation\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)(?:\/|$)/]]
    : [['drive', /^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/]];
  for (const [kind, pattern] of patterns) {
    const match = url.pathname.match(pattern);
    if (match) return {kind, id: match[1]};
  }
  if (url.hostname === 'drive.google.com' && ['/open', '/uc'].includes(url.pathname) && /^[A-Za-z0-9_-]+$/.test(url.searchParams.get('id') || '')) {
    return {kind: 'drive', id: url.searchParams.get('id')};
  }
  throw Error('Unsupported Google Workspace URL; supply a document or file URL');
}

function limited(text, maxBytes) {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return `${bytes.subarray(0, end).toString('utf8')}\n[truncated at ${maxBytes} bytes]\n`;
}

async function outputPath(mandatory = false) {
  const path = mandatory ? required('OUTPUT') : process.env.OUTPUT;
  if (!path) return null;
  const output = resolve(path);
  try {
    await lstat(output);
    throw Error('OUTPUT already exists; choose a new file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!(await stat(dirname(output))).isDirectory()) throw Error('OUTPUT directory does not exist');
  return output;
}

async function emit(value, output) {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  if (output) {
    await writeFile(output, text, {flag: 'wx', mode: 0o600});
    process.stdout.write(`${JSON.stringify({output})}\n`);
  } else process.stdout.write(text);
}

async function scratch(fn) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'philby-google-workspace-')));
  try { return await fn(directory); }
  finally { await rm(directory, {recursive: true, force: true}); }
}

async function metadata(id) {
  const response = object(await gog(['drive', 'get', id]), 'Drive');
  const file = object(response.file, 'Drive file');
  if (typeof file.mimeType !== 'string') throw Error('Invalid gog Drive MIME type');
  return file;
}

async function readSlides(id, maxSlides) {
  const listing = object(await gog(['slides', 'list-slides', id]), 'Slides');
  const slides = array(listing.slides, 'Slides list');
  if (typeof listing.title !== 'string') throw Error('Invalid gog presentation title');
  const sections = [listing.title];
  for (const slide of slides.slice(0, maxSlides)) {
    if (!Number.isInteger(slide.number) || typeof slide.objectId !== 'string') throw Error('Invalid gog slide entry');
    const contents = object(await gog(['slides', 'read-slide', id, slide.objectId]), 'slide');
    const elements = array(contents.textElements, 'slide text');
    if (typeof contents.notes !== 'string' || elements.some(element => typeof element?.text !== 'string')) throw Error('Invalid gog slide text or notes');
    sections.push(`Slide ${slide.number}\n${elements.map(element => element.text).join('\n')}${contents.notes ? `\nSpeaker notes:\n${contents.notes}` : ''}`);
  }
  if (slides.length > maxSlides) sections.push(`[truncated: ${maxSlides} of ${slides.length} slides]`);
  return `${sections.join('\n\n')}\n`;
}

async function readDocument() {
  const selected = await target();
  const maxBytes = positive('MAX_BYTES', 100000);
  const maxSlides = positive('MAX_SLIDES', 40);
  const output = await outputPath();
  let kind = selected.kind;
  if (kind === 'drive') {
    const file = await metadata(selected.id);
    kind = {'application/vnd.google-apps.document': 'doc', 'application/vnd.google-apps.spreadsheet': 'sheet', 'application/vnd.google-apps.presentation': 'slides'}[file.mimeType];
    if (!kind) throw Error('Drive file is not a Docs, Sheets or Slides document; use google-workspace-download');
  }
  let text;
  if (kind === 'doc') text = await gog(['docs', 'cat', selected.id, '--all-tabs', '--max-bytes', '0'], false);
  else if (kind === 'slides') text = await readSlides(selected.id, maxSlides);
  else if (process.env.RANGE) {
    const response = object(await gog(['sheets', 'get', selected.id, process.env.RANGE]), 'Sheets');
    const values = array(response.values, 'Sheets values');
    if (values.some(row => !Array.isArray(row) || row.some(cell => !['string', 'number', 'boolean'].includes(typeof cell) && cell !== null))) throw Error('Invalid gog Sheets rows');
    text = `${values.map(row => row.map(cell => String(cell ?? '')).join('\t')).join('\n')}\n`;
  } else {
    text = await scratch(async directory => {
      const path = join(directory, 'sheet.csv');
      await gog(['sheets', 'export', selected.id, '--format', 'csv', '--out', path]);
      return readFile(path, 'utf8');
    });
  }
  await emit(limited(text, maxBytes), output);
}

function space() {
  const value = required('SPACE');
  if (!/^spaces\/[A-Za-z0-9_-]+$/.test(value)) throw Error('SPACE must be a spaces/... resource from google-workspace-spaces');
  return value;
}

function messageTime(message) {
  if (!message || typeof message.resource !== 'string' || typeof message.createTime !== 'string' || !Number.isFinite(Date.parse(message.createTime))) throw Error('Invalid gog Chat message');
  return Date.parse(message.createTime);
}

async function messages(resource, latest = false) {
  const response = object(await gog(['chat', 'messages', 'list', resource, ...(latest ? ['--max', '1', '--order', 'createTime desc'] : ['--all', '--order', 'createTime asc'])]), 'Chat messages');
  const result = array(response.messages, 'Chat messages');
  for (const message of result) messageTime(message);
  return result.sort((a, b) => messageTime(a) - messageTime(b));
}

async function listSpaces() {
  const type = process.env.TYPE || 'all';
  const types = {all: null, space: 'SPACE', direct: 'DIRECT_MESSAGE', group: 'GROUP_CHAT'};
  if (!Object.hasOwn(types, type)) throw Error('TYPE must be all, space, direct or group');
  const output = await outputPath();
  const response = object(await gog(['chat', 'spaces', 'list', '--all']), 'Chat spaces');
  const spaces = [];
  for (const entry of array(response.spaces, 'Chat spaces')) {
    if (typeof entry?.resource !== 'string' || typeof entry.type !== 'string') throw Error('Invalid gog Chat space');
    if (types[type] && entry.type !== types[type]) continue;
    const recent = await messages(entry.resource, true);
    spaces.push({...entry, lastMessageTime: recent.length ? recent[recent.length - 1].createTime : null});
  }
  spaces.sort((a, b) => (a.lastMessageTime ? Date.parse(a.lastMessageTime) : -Infinity) - (b.lastMessageTime ? Date.parse(b.lastMessageTime) : -Infinity) || a.resource.localeCompare(b.resource));
  await emit({spaces}, output);
}

async function exportMessages() {
  const resource = space();
  const since = required('SINCE');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(since) || !Number.isFinite(Date.parse(since))) throw Error('SINCE must be an RFC3339 timestamp with timezone');
  const output = await outputPath(true);
  const recent = (await messages(resource)).filter(message => messageTime(message) >= Date.parse(since));
  await emit({space: resource, since, exportedAt: new Date().toISOString(), messageCount: recent.length, threadCount: new Set(recent.map(message => message.thread || 'UNTHREADED')).size, messages: recent}, output);
}

async function download() {
  const {id} = await target();
  const output = await outputPath(true);
  await scratch(async directory => {
    const response = object(await gog(['drive', 'download', id, '--out', join(directory, 'download')]), 'Drive download');
    if (typeof response.path !== 'string') throw Error('Invalid gog download path');
    const path = resolve(response.path);
    if (!path.startsWith(`${directory}${sep}`) || !(await lstat(path)).isFile()) throw Error('gog download must be a regular file inside its temporary directory');
    await chmod(path, 0o600);
    await copyFile(path, output, constants.COPYFILE_EXCL);
  });
  process.stdout.write(`${JSON.stringify({output})}\n`);
}

async function diagnose() {
  const version = (await client(['--version'])).trim();
  const result = {version};
  if (process.env.GOOGLE_ACCOUNT) {
    const selected = account();
    const response = object(await client(['auth', 'list', '--no-input'], true), 'auth list');
    const saved = array(response.accounts, 'auth accounts').filter(entry => entry.email === selected && (!entry.client || entry.client === 'default'));
    if (saved.length !== 1 || saved[0].error || saved[0].auth !== 'oauth') throw Error('No usable default-client OAuth registration for GOOGLE_ACCOUNT; run google-workspace-login');
    result.account = selected;
    result.services = array(saved[0].services, 'auth services');
    result.authorization = 'registered locally; live access not checked';
  }
  await emit(result);
}

async function credentials() {
  const path = resolve(required('CREDENTIALS_FILE'));
  await access(path, constants.R_OK);
  await client(['auth', 'credentials', 'set', path, '--no-input']);
  process.stdout.write('Google OAuth client registered.\n');
}

async function login() {
  const selected = account();
  if (!process.stdin.isTTY) throw Error('google-workspace-login requires an interactive terminal');
  await client(['auth', 'add', selected, '--services', services, '--readonly', '--drive-scope', 'readonly'], false, true);
}

try {
  const operation = process.argv[2];
  if (operation === 'credentials') await credentials();
  else if (operation === 'login') await login();
  else if (operation === 'diagnose') await diagnose();
  else if (operation === 'read') await readDocument();
  else if (operation === 'spaces') await listSpaces();
  else if (operation === 'messages') {
    const resource = space();
    const output = await outputPath();
    await emit({messages: await messages(resource)}, output);
  }
  else if (operation === 'export') await exportMessages();
  else if (operation === 'download') await download();
  else throw Error('Expected credentials, login, diagnose, read, spaces, messages, export or download');
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}

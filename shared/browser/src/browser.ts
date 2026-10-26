import puppeteer, { DEBUG_PREFIXES, type Browser, type Page, type ConnectionTransport } from 'puppeteer-core';
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createConnection, createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Name = 'chrome' | 'firefox';
type View = {name: Name; pane: string; pid: number; dead: boolean};
type Runtime = {
  root: string; panesRoot: string; runtimeDir: string;
  openBrowser(name: Name, command: string[], cwd: string): {pane: string; started: boolean};
  browserViews(): View[];
  browserSocket(name: Name): string;
  closeBrowserPane(name: Name, pane: string, pid: number): void;
  terminateBrowser(name: Name, pane: string, pid: number): void;
};
type Request = {op: string; id?: string; source?: string; tab?: string; cwd?: string; caller?: string; clientPid?: number; endpoint?: string};
type Client = {socket: Socket; done: boolean; request?: Request};
type Job = {client: Client; request: Request; timer: ReturnType<typeof setTimeout>};
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor as new (...args: string[]) => (browser: Browser, page?: Page) => Promise<unknown>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const moduleRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function errorText(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
}

function script() {
  const env = process.env;
  if (!env.PROMPT_FILE && !env.PROMPT && process.stdin.isTTY) throw Error('Supply PROMPT_FILE, prompt, or stdin');
  const source = env.PROMPT_FILE ? readFileSync(env.PROMPT_FILE, 'utf8') : env.PROMPT || readFileSync(0, 'utf8');
  if (!source.trim()) throw Error('A nonempty Puppeteer script is required');
  new AsyncFunction('browser', 'page', source);
  return source;
}

function endpoint(name: Name) {
  const value = process.env.BROWSER_ENDPOINT || (name === 'firefox' ? 'ws://127.0.0.1:9222/session' : undefined);
  if (value && !['ws:', 'wss:'].includes(new URL(value).protocol)) throw Error('BROWSER_ENDPOINT must be a WebSocket URL');
  return value;
}

function lock(name: Name) {
  const directory = join(tmpdir(), `philby-browser-${process.getuid!()}`);
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const file = join(directory, `${name}.sqlite`);
  const database = new DatabaseSync(file);
  try {
    chmodSync(file, 0o600);
    database.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    database.close();
    throw Error(`Cannot own ${name}; another browser service may be running: ${errorText(error)}`);
  }
  return database;
}

function firefoxTransport(url: string, disconnected: () => void): Promise<ConnectionTransport> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const transport: ConnectionTransport = {
      send: message => socket.send(message),
      close: () => socket.close(),
    };
    socket.addEventListener('open', () => resolve(transport));
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') { socket.close(); return; }
      transport.onmessage?.(event.data);
    });
    socket.addEventListener('error', () => reject(Error('Firefox browser connection failed')));
    socket.addEventListener('close', () => {
      transport.onclose?.();
      disconnected();
      reject(Error('Firefox browser connection closed before opening'));
    });
  });
}

async function serve(runtime: Runtime, name: Name, path: string) {
  const selectedEndpoint = endpoint(name);
  const database = lock(name);
  let browser: Browser | undefined;
  let version: string | undefined;
  let active: Job | undefined;
  let watchdog: ReturnType<typeof spawn> | undefined;
  let closing: Promise<void> | undefined;
  let disconnecting = false;
  const teardownErrors: unknown[] = [];
  const queue: Job[] = [];
  const clients = new Set<Client>();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {});
  const state = () => ({
    browser: name, version, state: closing ? 'closing' : !version ? 'connecting' : active ? 'busy' : 'ready',
    pid: process.pid, pane: process.env.TMUX_PANE,
    active: active ? {id: active.request.id, op: active.request.op, caller: active.request.caller} : null,
    queued: queue.length,
  });
  const publish = () => {
    const current = state();
    console.log(`${name}: ${current.state}${current.active ? ` — ${current.active.op} from ${current.active.caller} (${current.active.id})` : ''}; queued=${current.queued}`);
  };
  const send = (client: Client, data: string) => {
    if (client.done || client.socket.destroyed) return Promise.resolve();
    client.done = true;
    return new Promise<void>(resolve => {
      client.socket.once('close', resolve);
      client.socket.end(data, resolve);
    });
  };
  const finish = (client: Client, response: {value?: unknown; error?: string}) => send(client, JSON.stringify(response) + '\n');
  const server = createServer(socket => {
    const client: Client = {socket, done: false};
    clients.add(client);
    let data = '';
    socket.setEncoding('utf8');
    socket.setTimeout(15000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => {
      clients.delete(client);
      if (client.done || closing) return;
      const queued = queue.findIndex(job => job.client === client);
      if (queued !== -1) {
        clearTimeout(queue[queued].timer);
        queue.splice(queued, 1);
        publish();
      } else if (active?.client === client) {
        void shutdown(Error('Active browser caller disconnected; inspect the page before retrying'));
      } else if (client.request?.op === 'connect' && !version && ![...clients].some(other => other.request?.op === 'connect' && !other.done)) {
        void shutdown(Error('Browser connection cancelled by its caller'));
      }
    });
    socket.on('data', chunk => {
      if (client.request || client.done) return;
      data += chunk;
      if (Buffer.byteLength(data) > 4 * 1024 * 1024) { void finish(client, {error: 'Browser command too large'}); return; }
      if (!data.includes('\n')) return;
      socket.setTimeout(0);
      try {
        const request = JSON.parse(data.split('\n')[0]) as Request;
        client.request = request;
        if (!request || typeof request.op !== 'string') throw Error('Invalid browser request');
        if (closing) throw Error('Browser service is closing');
        if (request.endpoint && request.endpoint !== selectedEndpoint) throw Error('Browser endpoint differs from the open service; disconnect before choosing another endpoint');
        if (request.op === 'status') { void finish(client, {value: state()}); return; }
        if (request.op === 'connect') {
          void ready.then(() => finish(client, {value: state()}), error => finish(client, {error: errorText(error)}));
          return;
        }
        if (request.op === 'disconnect') { void shutdown(undefined, client); return; }
        if (!version || !browser) throw Error('Browser is still connecting; wait for browser-connect');
        if (!['tabs', 'run'].includes(request.op) || !request.id || !request.cwd || !Number.isSafeInteger(request.clientPid) || request.clientPid! <= 0) throw Error('Invalid browser work request');
        if (request.op === 'run') {
          if (typeof request.source !== 'string' || !request.source.trim()) throw Error('A nonempty Puppeteer script is required');
          new AsyncFunction('browser', 'page', request.source);
        }
        const job: Job = {client, request, timer: setTimeout(() => {
          const index = queue.indexOf(job);
          if (index === -1) return;
          queue.splice(index, 1);
          void finish(client, {error: 'Browser request waited more than 60 seconds; it did not run'});
          publish();
        }, 60000)};
        queue.push(job);
        socket.write(JSON.stringify({event: 'queued'}) + '\n');
        publish();
        void drain();
      } catch (error) { void finish(client, {error: errorText(error)}); }
    });
  });
  const startupTimer = setTimeout(() => { void shutdown(Error('Browser connection exceeded 120 seconds')); }, 120000);

  function shutdown(reason?: Error, requester?: Client): Promise<void> {
    if (closing) return closing;
    closing = (async () => {
      await Promise.resolve();
      clearTimeout(startupTimer);
      watchdog?.stdin?.end();
      if (active) clearTimeout(active.timer);
      for (const job of queue) clearTimeout(job.timer);
      queue.length = 0;
      rejectReady(reason || Error('Browser service disconnected'));
      server.close();
      rmSync(path, {force: true});
      publish();
      const forced = setTimeout(() => {
        console.error('Browser shutdown exceeded 2 seconds; terminating unfinished work');
        process.exit(1);
      }, 2000);
      const responses = [...clients].filter(client => client !== requester).map(client => finish(client, {error: reason?.message || 'Browser service disconnected; inspect the page before retrying'}));
      disconnecting = true;
      try { if (browser) await browser.disconnect(); }
      catch (error) { teardownErrors.push(error); }
      database.close();
      const message = [reason?.message, ...teardownErrors.map(errorText)].filter(Boolean).join('\n');
      if (requester) responses.push(finish(requester, message ? {error: message} : {value: {disconnected: true}}));
      await Promise.all(responses);
      if (message) console.error(`Error: ${message}`);
      else console.log(`${name}: disconnected; browser left open`);
      clearTimeout(forced);
      process.exit(message ? 1 : 0);
    })();
    return closing;
  }

  async function drain() {
    if (active || closing || !browser) return;
    const job = queue.shift();
    if (!job) return;
    clearTimeout(job.timer);
    active = job;
    job.timer = setTimeout(() => { void shutdown(Error('Browser script exceeded 120 seconds; inspect the page before retrying')); }, 120000);
    publish();
    const cwd = process.cwd();
    const guard = spawn(process.execPath, [fileURLToPath(new URL('./watchdog.js', import.meta.url)), String(process.pid), String(job.request.clientPid)], {stdio: ['pipe', 'pipe', 'inherit']});
    watchdog = guard;
    guard.stdin!.on('error', () => {});
    const guarded = once(guard, 'close');
    let stoppingGuard: Promise<void> | undefined;
    const stopGuard = () => stoppingGuard ||= (async () => {
      guard.stdin!.end();
      await guarded;
      if (watchdog === guard) watchdog = undefined;
    })();
    guard.once('exit', () => {
      if (!guard.stdin!.writableEnded && !closing) void shutdown(Error('Browser watchdog exited unexpectedly; unfinished work stopped'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        guard.stdout!.once('data', () => resolve());
        guard.once('error', reject);
        guard.once('exit', () => reject(Error('Browser watchdog exited before starting')));
      });
      if (closing || job.client.socket.destroyed) return;
      job.client.socket.write(JSON.stringify({event: 'started', pane: process.env.TMUX_PANE, pid: process.pid}) + '\n');
      process.chdir(job.request.cwd!);
      let result: unknown;
      if (job.request.op === 'tabs') {
        result = await Promise.all((await browser.pages()).map(async page => ({url: page.url(), title: await page.title()})));
      } else {
        let page: Page | undefined;
        if (job.request.tab) {
          const selector = job.request.tab.toLowerCase();
          const matches = [];
          for (const candidate of await browser.pages()) {
            if (candidate.url().toLowerCase().includes(selector) || (await candidate.title()).toLowerCase().includes(selector)) matches.push(candidate);
          }
          if (matches.length !== 1) throw Error(`TAB: expected one match, found ${matches.length}. Use browser-tabs to choose a unique URL or title substring.`);
          page = matches[0];
        }
        result = await new AsyncFunction('browser', 'page', job.request.source!)(browser, page);
      }
      const response = JSON.stringify({value: result === undefined ? null : result}) + '\n';
      await stopGuard();
      if (!closing) await send(job.client, response);
    } catch (error) {
      const response = JSON.stringify({error: errorText(error)}) + '\n';
      await stopGuard();
      if (!closing) await send(job.client, response);
    } finally {
      await stopGuard();
      process.chdir(cwd);
      clearTimeout(job.timer);
      active = undefined;
      if (!closing) { publish(); void drain(); }
    }
  }

  mkdirSync(runtime.runtimeDir, {recursive: true, mode: 0o700});
  rmSync(path, {force: true});
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  chmodSync(path, 0o600);
  for (const signal of signals) process.once(signal, () => { void shutdown(Error(`Browser service interrupted by ${signal}`)); });
  process.once('uncaughtException', error => { void shutdown(error); });
  process.once('unhandledRejection', error => { void shutdown(Error(errorText(error))); });
  publish();
  try {
    const lost = () => { if (!closing) void shutdown(Error('Browser connection lost; reconnect explicitly and inspect the page before retrying')); };
    const transport = name === 'firefox' ? await firefoxTransport(selectedEndpoint!, lost) : undefined;
    const connected = await puppeteer.connect({
      ...(transport ? {transport} : selectedEndpoint ? {browserWSEndpoint: selectedEndpoint} : {channel: 'chrome'}),
      protocol: name === 'firefox' ? 'webDriverBiDi' : 'cdp',
      ...(name === 'firefox' ? {capabilities: {alwaysMatch: {browserName: 'firefox'}}} : {}),
      defaultViewport: null,
      protocolTimeout: 30000,
      wsOptions: {handshakeTimeout: 120000},
      logger: prefix => prefix === DEBUG_PREFIXES.error ? (...errors) => { if (disconnecting) teardownErrors.push(...errors); } : undefined,
    });
    browser = connected;
    if (closing) { await connected.disconnect(); return; }
    connected.once('disconnected', lost);
    version = await connected.version();
    if (!(name === 'firefox' ? /^firefox\//i : /^(?:headless)?chrome\//i).test(version)) throw Error(`Expected ${name}, connected to ${version}`);
    clearTimeout(startupTimer);
    resolveReady();
    publish();
  } catch (error) { await shutdown(Error(errorText(error))); }
}

async function call(runtime: Runtime, name: Name, path: string, request: Request) {
  const socket = createConnection(path);
  socket.setEncoding('utf8');
  let timer: ReturnType<typeof setTimeout>;
  let running: {pane: string; pid: number} | undefined;
  let terminate = false;
  let data = '';
  const interrupted = (signal: string) => {
    terminate = !!running;
    socket.destroy(Error(`Browser command interrupted by ${signal}; inspect the page before retrying`));
  };
  for (const signal of signals) process.on(signal, interrupted);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      let replied = false;
      const deadline = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          terminate = !!running;
          socket.destroy(Error('Browser command timed out; inspect the page before retrying'));
        }, ms);
      };
      deadline(request.op === 'connect' ? 121000 : ['tabs', 'run'].includes(request.op) ? 61000 : 5000);
      socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
      socket.on('data', chunk => {
        data += chunk;
        while (data.includes('\n')) {
          const index = data.indexOf('\n');
          const line = data.slice(0, index);
          data = data.slice(index + 1);
          try {
            const response = JSON.parse(line);
            if (response.event === 'queued') continue;
            if (response.event === 'started') { running = {pane: response.pane, pid: response.pid}; deadline(121000); continue; }
            replied = true;
            response.error ? reject(Error(response.error)) : resolve(response.value);
            socket.end();
          } catch (error) { reject(error); socket.destroy(); }
        }
      });
      socket.on('error', reject);
      socket.on('close', () => { if (!replied) reject(Error('Browser pane closed before replying; inspect the page before retrying')); });
    });
  } finally {
    clearTimeout(timer!);
    for (const signal of signals) process.removeListener(signal, interrupted);
    socket.destroy();
    if (terminate && running) {
      const until = Date.now() + 2500;
      while (Date.now() < until && runtime.browserViews().some(view => view.name === name && view.pane === running!.pane && view.pid === running!.pid && !view.dead)) await sleep(50);
      if (runtime.browserViews().some(view => view.name === name && view.pane === running!.pane && view.pid === running!.pid && !view.dead)) runtime.terminateBrowser(name, running.pane, running.pid);
    }
  }
}

async function main() {
  const action = process.argv[2];
  if (!['connect', 'disconnect', 'status', 'tabs', 'run', 'serve'].includes(action)) throw Error('Expected connect, disconnect, status, tabs, or run');
  const name = process.env.BROWSER;
  if (name !== 'chrome' && name !== 'firefox') throw Error('Supply BROWSER=chrome or BROWSER=firefox');
  const source = action === 'run' ? script() : undefined;
  const selectedEndpoint = endpoint(name);
  const runtime = await import(pathToFileURL(join(moduleRoot, 'dist', 'tmux', 'index.js')).href) as Runtime;
  const path = runtime.browserSocket(name);
  if (action === 'serve') { await serve(runtime, name, path); return; }
  const request: Request = {
    op: action, id: randomUUID(), source, tab: process.env.TAB, cwd: process.cwd(),
    caller: process.env.PHILBY_PANE || 'shell', clientPid: process.pid, endpoint: process.env.BROWSER_ENDPOINT || undefined,
  };
  let result: unknown;
  if (action === 'connect') {
    const env = [
      `PHILBY_ROOT=${runtime.root}`, `PHILBY_PANES_DIR=${runtime.panesRoot}`, `TMPDIR=${tmpdir()}`,
      `BROWSER=${name}`, `BROWSER_ENDPOINT=${selectedEndpoint || ''}`,
      ...(process.env.PHILBY_TMUX_SOCKET ? [`PHILBY_TMUX_SOCKET=${process.env.PHILBY_TMUX_SOCKET}`] : []),
    ];
    const opened = runtime.openBrowser(name, ['env', ...env, process.execPath, '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), 'serve'], runtime.root);
    const until = Date.now() + 10000;
    for (;;) {
      try { result = await call(runtime, name, path, request); break; }
      catch (error) {
        if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
        const view = runtime.browserViews().find(view => view.name === name && view.pane === opened.pane);
        if (!view || view.dead) throw Error(`Browser connection failed in pane ${opened.pane}; inspect that pane`);
        if (Date.now() >= until) throw Error(`Browser service did not start in pane ${opened.pane}; inspect that pane`);
        await sleep(50);
      }
    }
  } else if (action === 'disconnect') {
    const view = runtime.browserViews().find(view => view.name === name);
    if (!view || view.dead) {
      if (view) runtime.closeBrowserPane(name, view.pane, view.pid);
      result = {disconnected: true};
    } else {
      try { result = await call(runtime, name, path, request); }
      catch (error) {
        if (runtime.browserViews().some(current => current.name === name && current.pane === view.pane && current.pid === view.pid && !current.dead)) runtime.terminateBrowser(name, view.pane, view.pid);
        throw Error(`${errorText(error)}; browser service terminated, inspect the page before retrying`);
      }
      const until = Date.now() + 3000;
      while (runtime.browserViews().some(current => current.name === name && current.pane === view.pane && current.pid === view.pid && !current.dead)) {
        if (Date.now() >= until) {
          runtime.terminateBrowser(name, view.pane, view.pid);
          throw Error('Browser service did not exit after disconnect; it was terminated');
        }
        await sleep(25);
      }
    }
  } else {
    try { result = await call(runtime, name, path, request); }
    catch (error) {
      if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || '')) throw Error(`No connected ${name} browser pane; run browser-connect BROWSER=${name}`);
      throw error;
    }
  }
  await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(result === undefined ? null : result, null, 2) + '\n', error => error ? reject(error) : resolve()));
}

main().then(() => { if (process.argv[2] !== 'serve') process.exit(0); }, error => {
  process.stderr.write(`Error: ${errorText(error)}\n`, () => process.exit(1));
});

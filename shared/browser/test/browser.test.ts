import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const executables = process.platform === 'darwin'
  ? { chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', firefox: '/Applications/Firefox.app/Contents/MacOS/firefox' }
  : { chrome: '/usr/bin/google-chrome', firefox: '/usr/bin/firefox' };

for (const browser of ['chrome', 'firefox'] as const) {
  test(`${browser}: a persistent browser pane preserves sessions and owns serialized work`, { timeout: 180_000 }, async t => {
    const directory = mkdtempSync('/tmp/philby-browser-');
    let startedRequests = 0;
    let signalStarted!: () => void;
    const actionStarted = new Promise<void>(resolve => { signalStarted = resolve; });
    let signalInterrupted!: (pid: number) => void;
    const interruptedAction = new Promise<number>(resolve => { signalInterrupted = resolve; });
    let signalHeld!: () => void;
    let heldResponse: ServerResponse | undefined;
    const heldAction = new Promise<void>(resolve => { signalHeld = resolve; });
    const server = createServer((request, response) => {
      if (request.url === '/hold') {
        heldResponse = response;
        signalHeld();
        return;
      }
      if (request.url?.startsWith('/interrupt?pid=')) {
        const pid = Number(new URL(request.url, 'http://127.0.0.1').searchParams.get('pid'));
        response.end('{}');
        signalInterrupted(pid);
        return;
      }
      if (request.url === '/started') {
        startedRequests++;
        response.end('{}');
        signalStarted();
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end(`<title>Philby Browser ${request.url}</title><textarea id="field"></textarea><button id="commit" onclick="document.querySelector('#output').textContent=document.querySelector('#field').value">Copy</button><pre id="output"></pre><script>document.addEventListener('keydown',event=>window.lastKey=event.key)</script>`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    let child: ChildProcess | null = null;
    let finished: Promise<unknown> | undefined;
    let disconnect: (() => Promise<string>) | undefined;
    let cleanupTmux: (() => void) | undefined;
    const launch = () => puppeteer.launch({
      browser,
      executablePath: executables[browser],
      userDataDir: join(directory, 'profile'),
      headless: true,
      defaultViewport: null,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    try {
      const owner = await launch();
      child = owner.process();
      assert.ok(child);
      finished = once(child, 'close');
      const initialPages = await owner.pages();
      const first = await owner.newPage();
      for (const initial of initialPages) await initial.close();
      await first.goto(`${url}/first`);
      await first.evaluate(() => {
        document.cookie = 'fixture=kept;path=/';
        localStorage.setItem('fixture', 'kept');
      });
      const second = await owner.newPage();
      await second.goto(`${url}/second`);
      const endpoint = owner.wsEndpoint();
      await owner.disconnect();

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        BROWSER: browser,
        BROWSER_ENDPOINT: endpoint,
        TMPDIR: directory,
        PHILBY_PANES_DIR: join(directory, 'panes'),
        PHILBY_TMUX_SOCKET: `philby-browser-${process.pid}-${browser}`,
        PHILBY_PANE: 'browser-test',
      };
      for (const name of ['PROMPT', 'PROMPT_FILE', 'TAB', 'TMUX', 'TMUX_PANE']) delete env[name];
      cleanupTmux = () => {
        const args = ['-L', env.PHILBY_TMUX_SOCKET!];
        const listing = spawnSync('tmux', [...args, 'list-panes', '-a', '-F', '#{pane_pid}\t#{pane_dead}\t#{@philby_browser}'], { env, encoding: 'utf8' });
        if (listing.status !== 0) {
          assert.match(listing.stderr, /no server running|No such file or directory/);
          return;
        }
        for (const line of listing.stdout.trim().split('\n')) {
          const [pid, dead, type] = line.split('\t');
          if (dead !== '0' || !['chrome', 'firefox'].includes(type)) continue;
          assert.ok(Number.isInteger(Number(pid)) && Number(pid) > 1);
          try { process.kill(Number(pid), 'SIGKILL'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        }
        const stopped = spawnSync('tmux', [...args, 'kill-server'], { env, encoding: 'utf8' });
        if (stopped.status !== 0) assert.match(stopped.stderr, /no server running|No such file or directory/);
      };
      function invoke(target: string, variables: NodeJS.ProcessEnv = {}, input?: string, args: string[] = []) {
        const command = spawn('make', ['--no-print-directory', '-s', '-C', join(root, 'shared'), `browser-${target}`, ...args], {
          cwd: root,
          env: { ...env, ...variables },
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        });
        const result = new Promise<string>((resolve, reject) => {
          let out = '', err = '';
          command.stdout.on('data', chunk => { out += chunk; });
          command.stderr.on('data', chunk => { err += chunk; });
          command.on('error', reject);
          command.on('close', (code, signal) => code === 0 ? resolve(out) : reject(Error(`${target}: ${code ?? signal}\n${out}${err}`)));
          command.stdin.end(input);
        });
        return { result, cancel: (signal: NodeJS.Signals = 'SIGTERM') => { assert.ok(command.pid); process.kill(-command.pid, signal); } };
      }
      const make = (target: string, variables: NodeJS.ProcessEnv = {}, input?: string, args: string[] = []) => invoke(target, variables, input, args).result;
      disconnect = () => make('disconnect');
      const run = async (body: string, variables: NodeJS.ProcessEnv = { TAB: '/first' }) => JSON.parse(await make('run', variables, body));
      const status = async () => JSON.parse(await make('status'));
      const connect = async () => JSON.parse(await make('connect'));
      const until = async (ready: () => boolean | Promise<boolean>) => {
        const limit = Date.now() + 10000;
        while (!await ready()) {
          if (Date.now() >= limit) throw Error('Timed out waiting for browser lifecycle state');
          await sleep(50);
        }
      };
      const stopped = () => until(async () => {
        try { await status(); return false; }
        catch { return true; }
      });

      await assert.rejects(run('return 1;'), /connect|not running|not started|unavailable|ENOENT/i);
      const started = await Promise.all([connect(), connect(), connect()]);
      assert.equal(new Set(started.map(service => service.pid)).size, 1);

      await t.test('reuses one pane and process without replacing pages, cookies or storage', async () => {
        const initial = await status();
        assert.equal(initial.browser, browser);
        assert.equal(typeof initial.version, 'string');
        assert.equal(initial.state, 'ready');
        assert.ok(Number.isInteger(initial.pid) && initial.pid > 1);
        assert.equal(typeof initial.pane, 'string');
        assert.equal(initial.active, null);
        assert.equal(initial.queued, 0);
        assert.equal((await connect()).pid, initial.pid);
        await assert.rejects(make('connect', { BROWSER_ENDPOINT: 'ws://127.0.0.1:1/session' }), /endpoint|different|already|mismatch/i);
        assert.deepEqual(JSON.parse(await make('tabs')).map((page: { url: string; title: string }) => page.url).sort(), [`${url}/first`, `${url}/second`]);
        assert.deepEqual(await run('return await page.evaluate(() => ({cookie: document.cookie, stored: localStorage.getItem("fixture")}));'), { cookie: 'fixture=kept', stored: 'kept' });
        assert.equal(await run('return await page.title();', { TAB: 'PHILBY BROWSER /FIRST' }), 'Philby Browser /first');
        assert.equal(await run('return page === undefined;', {}), true);
        assert.equal(await run('', { PROMPT: 'await browser.pages();' }), null);
        assert.equal((await status()).pid, initial.pid);
        if (existsSync(env.PHILBY_PANES_DIR!)) assert.ok(readdirSync(env.PHILBY_PANES_DIR!, { recursive: true }).every(file => !String(file).endsWith('durable.sqlite')));
      });

      await t.test('requires an unambiguous page and reports script failures without repetition', async () => {
        const initial = await status();
        await assert.rejects(run('return await page.title();', { TAB: 'Philby Browser' }), /found 2|matched 2|2 matches/i);
        await assert.rejects(run('return await page.title();', { TAB: 'missing-page' }), /found 0|matched 0|0 matches/i);
        await assert.rejects(run('await page.evaluate(() => { window.attempts = (window.attempts || 0) + 1; }); throw Error("fixture-action-failure");'), /fixture-action-failure/);
        assert.equal(await run('return await page.evaluate(() => window.attempts);'), 1);
        assert.equal((await status()).pid, initial.pid);
      });

      await t.test('preserves literal script input and validates it before dispatch', async () => {
        const value = 'quotes: \' " $HOME `literal` $(literal)\nsecond line';
        const body = `return ${JSON.stringify(value)};`;
        const file = join(directory, 'script.js');
        writeFileSync(file, body);
        assert.equal(await run(body), value);
        assert.equal(JSON.parse(await make('run', {}, undefined, [`prompt=${body}`])), value);
        assert.equal(JSON.parse(await make('run', { PROMPT_FILE: file, PROMPT: 'throw Error("wrong-prompt");' }, 'throw Error("wrong-stdin");')), value);
        await assert.rejects(make('run', {}, 'return ('), /SyntaxError|Unexpected token|Unexpected end/i);
        await assert.rejects(make('run', {}, '  '), /script|prompt|nonempty|required/i);
        await assert.rejects(make('run', { PROMPT_FILE: join(directory, 'missing-script.js'), PROMPT: body }), /ENOENT/);
        await assert.rejects(make('status', { BROWSER: '' }), /BROWSER/);
      });

      if (browser === 'chrome') await t.test('rejects an endpoint for the wrong browser', async () => {
        try {
          await assert.rejects(make('connect', { BROWSER: 'firefox' }), /firefox|capabilit|browser|session/i);
          assert.equal((await status()).browser, 'chrome');
        } finally { await make('disconnect', { BROWSER: 'firefox' }); }
      });

      if (browser === 'firefox') await t.test('reports an occupied Firefox session without taking ownership', async () => {
        await make('disconnect');
        const held = await puppeteer.connect({ browserWSEndpoint: endpoint, protocol: 'webDriverBiDi', defaultViewport: null });
        try {
          const start = performance.now();
          await assert.rejects(make('connect'), /session|connection/i);
          assert.ok(performance.now() - start < 5000, 'An occupied session must fail promptly');
          assert.equal((await held.pages()).length, 2);
        } finally {
          await held.disconnect();
        }
        await connect();
        assert.equal(await run('return (await browser.pages()).length;', {}), 2);
      });

      await t.test('uses locators, keyboard, evaluation and screenshots on existing pages', async () => {
        const step = async (label: string, body: string) => {
          try { return await run(body); }
          catch (error) { throw Error(`${label}: ${String(error)}`); }
        };
        const value = 'hello\n"quoted" $HOME `literal`';
        await step('activate page', 'await page.bringToFront();');
        await step('fill existing field', 'await page.locator("#field").fill("replace this");');
        await step('clear existing field', 'await page.locator("#field").fill("");');
        assert.equal(await run('return await page.$eval("#field", element => element.value);'), '');
        await step('fill literal text', `await page.locator("#field").fill(${JSON.stringify(value)});`);
        await step('click button', 'await page.locator("#commit").click();');
        assert.equal(await run('return await page.$eval("#output", element => element.textContent);'), value);
        await step('press key', 'await page.keyboard.press("Enter");');
        assert.equal(await run('return await page.evaluate(() => window.lastKey);'), 'Enter');
        const screenshot = join(directory, 'page.png');
        await step('capture screenshot', `await page.screenshot({path:${JSON.stringify(screenshot)}});`);
        assert.deepEqual(readFileSync(screenshot).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        await run(`await page.goto(${JSON.stringify(`${url}/third`)});`, { TAB: '/second' });
        assert.equal(await run('return await page.title();', { TAB: '/third' }), 'Philby Browser /third');
      });

      await t.test('serializes independent callers through the same process', async () => {
        const initial = await status();
        const before = JSON.parse(await make('tabs'));
        await run('await page.evaluate(() => { window.counter = 0; });');
        const values = await Promise.all([1, 2, 3].map(() => run('return await page.evaluate(async () => { const previous = window.counter; await new Promise(resolve => setTimeout(resolve, 80)); return window.counter = previous + 1; });')));
        assert.deepEqual(values.sort(), [1, 2, 3]);
        assert.deepEqual(JSON.parse(await make('tabs')), before);
        assert.deepEqual(await run('return await page.evaluate(() => ({cookie: document.cookie, stored: localStorage.getItem("fixture")}));'), { cookie: 'fixture=kept', stored: 'kept' });
        assert.equal((await status()).pid, initial.pid);
      });

      await t.test('reports busy state and removes cancelled queued work without running it', async () => {
        const initial = await status();
        const active = invoke('run', {}, `await fetch(${JSON.stringify(`${url}/hold`)}); return "active-complete";`);
        const activeOutcome = active.result.then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([heldAction, activeOutcome.then(outcome => { throw 'error' in outcome ? outcome.error : Error('Action ended before queue inspection'); })]);
          const cancelled = invoke('run', { TAB: '/first' }, 'await page.evaluate(() => { window.cancelledRuns = (window.cancelledRuns || 0) + 1; });');
          const cancelledOutcome = cancelled.result.then(() => undefined, error => error as Error);
          const surviving = invoke('run', {}, 'return "queued-complete";');
          const survivingOutcome = surviving.result.then(value => ({ value }), error => ({ error }));
          await until(async () => (await status()).queued === 2);
          const busy = await status();
          assert.equal(busy.state, 'busy');
          assert.equal(busy.pid, initial.pid);
          assert.equal(busy.active.op, 'run');
          assert.equal(busy.active.caller, 'browser-test');
          cancelled.cancel();
          assert.ok(await cancelledOutcome instanceof Error);
          await until(async () => (await status()).queued === 1);
          heldResponse!.end('{}');
          const activeResult = await activeOutcome;
          if ('error' in activeResult) throw activeResult.error;
          assert.equal(JSON.parse(activeResult.value), 'active-complete');
          const survivingResult = await survivingOutcome;
          if ('error' in survivingResult) throw survivingResult.error;
          assert.equal(JSON.parse(survivingResult.value), 'queued-complete');
          assert.equal(await run('return await page.evaluate(() => window.cancelledRuns || 0);'), 0);
          assert.equal((await status()).pid, initial.pid);
        } finally {
          if (heldResponse && !heldResponse.writableEnded) heldResponse.end('{}');
          await activeOutcome;
        }
      });

      await t.test('disconnects explicitly without closing browser pages and reconnects on request', async () => {
        const before = JSON.parse(await make('tabs'));
        const initial = await status();
        assert.equal(JSON.parse(await make('disconnect')).disconnected, true);
        assert.notEqual((await connect()).pid, initial.pid);
        assert.deepEqual(JSON.parse(await make('tabs')), before);
        assert.equal(JSON.parse(await make('disconnect')).disconnected, true);
        assert.equal(JSON.parse(await make('disconnect')).disconnected, true);
        await assert.rejects(make('tabs'), /connect|not running|not started|unavailable|ENOENT/i);
        assert.notEqual((await connect()).pid, initial.pid);
        assert.deepEqual(JSON.parse(await make('tabs')), before);
      });

      await t.test('active caller cancellation stops live Node timers and fails queued work', async () => {
        const initial = await status();
        const active = invoke('run', { TAB: '/first' }, `const unfinished = new Promise(resolve => setTimeout(resolve, 60000)); await fetch(${JSON.stringify(`${url}/interrupt?pid=`)} + process.pid); await unfinished;`);
        const outcome = active.result.then(() => undefined, error => error as Error);
        const pid = await Promise.race([interruptedAction, outcome.then(error => { throw error ?? Error('Action ended before interruption'); })]);
        assert.equal(pid, initial.pid);
        const queued = invoke('run', { TAB: '/first' }, 'await page.evaluate(() => { window.abortedQueueRuns = (window.abortedQueueRuns || 0) + 1; });');
        const queuedOutcome = queued.result.then(() => undefined, error => error as Error);
        await until(async () => (await status()).queued === 1);
        active.cancel();
        assert.ok(await outcome instanceof Error);
        assert.match(String(await queuedOutcome), /cancel|closed|disconnect|stopp|interrupt|connection/i);
        await stopped();
        await assert.rejects(run('return 1;'), /connect|not running|not started|unavailable|ENOENT/i);
        assert.notEqual((await connect()).pid, initial.pid);
        assert.equal(await run('return await page.evaluate(() => window.abortedQueueRuns || 0);'), 0);
        assert.equal(await run('return await page.title();'), 'Philby Browser /first');
      });

      await t.test('active caller cancellation can terminate a synchronous infinite script', async () => {
        const initial = await status();
        const marker = join(directory, 'loop-started');
        const active = invoke('run', {}, `const fs = await import("node:fs"); fs.writeFileSync(${JSON.stringify(marker)}, "started"); while (true) {}`);
        const outcome = active.result.then(() => undefined, error => error as Error);
        await until(() => existsSync(marker));
        active.cancel();
        assert.ok(await outcome instanceof Error);
        await until(() => {
          try { process.kill(initial.pid, 0); return false; }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; }
        });
        await assert.rejects(make('tabs'), /connect|not running|not started|unavailable|ENOENT|closed/i);
        if (browser === 'firefox') {
          await assert.rejects(connect(), /session|connection failed/i);
          const pane = spawnSync('tmux', ['-L', env.PHILBY_TMUX_SOCKET!, 'capture-pane', '-p', '-t', initial.pane], { env, encoding: 'utf8' });
          assert.equal(pane.status, 0, pane.stderr);
          assert.match(pane.stdout, /session.*(?:already|active)|(?:already|active).*session|Maximum number/i);
          t.diagnostic(pane.stdout.split('\n').filter(line => /session|Maximum number/i.test(line)).join(' '));
          child!.kill('SIGTERM');
          await finished;
          const restarted = await launch();
          child = restarted.process();
          assert.ok(child);
          finished = once(child, 'close');
          const restoredPages = await restarted.pages();
          const first = await restarted.newPage();
          for (const restored of restoredPages) await restored.close();
          await first.goto(`${url}/first`);
          env.BROWSER_ENDPOINT = restarted.wsEndpoint();
          await restarted.disconnect();
        }
        await connect();
        assert.equal(await run('return await page.title();'), 'Philby Browser /first');
      });

      if (browser === 'chrome') await t.test('a lost caller terminates blocking result serialization independently', async () => {
        const initial = await status();
        const marker = join(directory, 'serialization-started');
        const active = invoke('run', {}, `const fs = await import("node:fs"); return {toJSON() { fs.writeFileSync(${JSON.stringify(marker)}, "started"); while (true) {} }};`);
        const outcome = active.result.then(() => undefined, error => error as Error);
        await until(() => existsSync(marker));
        active.cancel('SIGKILL');
        assert.ok(await outcome instanceof Error);
        await until(() => {
          try { process.kill(initial.pid, 0); return false; }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; }
        });
        await assert.rejects(make('tabs'), /connect|not running|not started|unavailable|ENOENT|closed/i);
        await connect();
        assert.equal(await run('return await page.title();'), 'Philby Browser /first');
      });

      await t.test('surfaces a lost connection without repeating the active action', async () => {
        const pending = run('return await page.evaluate(async () => { await fetch("/started"); return await new Promise(() => {}); });');
        const outcome = pending.then(() => undefined, error => error as Error);
        await Promise.race([actionStarted, outcome.then(error => { throw error ?? Error('Action ended before disconnect'); })]);
        child!.kill('SIGTERM');
        await finished;
        assert.match(String(await outcome), /closed|disconnected|connection|socket|TargetCloseError|Protocol error/i);
        assert.equal(startedRequests, 1);
        await stopped();
        await assert.rejects(make('tabs'), /connect|not running|not started|unavailable|ENOENT|closed/i);
        await assert.rejects(connect(), /ECONNREFUSED|connect|closed|socket/i);
        const recovered = await launch();
        child = recovered.process();
        assert.ok(child);
        finished = once(child, 'close');
        env.BROWSER_ENDPOINT = recovered.wsEndpoint();
        await recovered.disconnect();
        assert.equal((await connect()).state, 'ready');
        assert.equal(await run('return await browser.version();', {}), (await status()).version);
      });
    } finally {
      try { if (disconnect) await disconnect(); }
      finally {
        try { cleanupTmux?.(); }
        finally {
          if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          if (finished) await finished;
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
      }
    }
  });
}

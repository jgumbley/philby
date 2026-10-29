import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {encodeKittyCommand, installKittyNavigation} from '../kitty.js';

const esc = '\x1b';
const prefix = `${esc}P@kitty-cmd`;
const suffix = `${esc}\\`;
const privateValue = 'private-kitty-environment-value';
const windowTree = [{id: 1, tabs: [{id: 2, windows: [
  {id: 17, is_self: false, env: {TOKEN: privateValue}},
  {id: 42, is_self: true, env: {TOKEN: privateValue}},
]}]}];

class Input extends EventEmitter {
  isRaw = false;
  paused = true;
  setRawMode(raw: boolean) {this.isRaw = raw; return this;}
  isPaused() {return this.paused;}
  pause() {this.paused = true; return this;}
  resume() {this.paused = false; return this;}
}

function unpack(wire: string, depth: number) {
  for (let layer = 0; layer < depth; layer++) {
    assert.ok(wire.startsWith(`${esc}Ptmux;`));
    assert.ok(wire.endsWith(suffix));
    wire = wire.slice(7, -2).replaceAll(esc + esc, esc);
  }
  assert.ok(wire.startsWith(prefix));
  assert.ok(wire.endsWith(suffix));
  return JSON.parse(wire.slice(prefix.length, -suffix.length));
}

function harness(responses: unknown[] = [{ok: true, data: JSON.stringify(windowTree)}, {ok: true}], depth = 0) {
  const input = new Input();
  const output = new EventEmitter() as EventEmitter & {write: (value: string) => boolean};
  const wires: string[] = [];
  const commands: {cmd: string; payload: Record<string, unknown>}[] = [];
  const existing = () => {};
  input.on('data', existing);
  output.write = value => {
    wires.push(String(value));
    commands.push(unpack(String(value), depth));
    const response = responses[commands.length - 1];
    if (response !== undefined) queueMicrotask(() => {
      const text = `${prefix}${JSON.stringify(response)}${suffix}`;
      for (let index = 0; index < text.length; index += 3) input.emit('data', Buffer.from(text.slice(index, index + 3)));
    });
    return true;
  };
  const install = () => installKittyNavigation(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream, depth);
  const restored = (raw = false, paused = true) => {
    assert.equal(input.isRaw, raw);
    assert.equal(input.isPaused(), paused);
    assert.deepEqual(input.listeners('data'), [existing]);
    for (const event of ['error', 'end', 'close']) assert.equal(input.listenerCount(event), 0, event);
    assert.equal(output.listenerCount('error'), 0);
  };
  return {input, output, wires, commands, install, restored};
}

test('Kitty protocol encoding wraps each nested tmux layer exactly once', () => {
  const command = {cmd: 'ls', version: [0, 43, 1], no_response: false, payload: {self: true}};
  const direct = prefix + JSON.stringify(command) + suffix;
  const once = `${esc}Ptmux;${direct.replaceAll(esc, esc + esc)}${suffix}`;
  const twice = `${esc}Ptmux;${once.replaceAll(esc, esc + esc)}${suffix}`;
  assert.equal(encodeKittyCommand(command, 0), direct);
  assert.equal(encodeKittyCommand(command, 1), once);
  assert.equal(encodeKittyCommand(command, 2), twice);
});

test('installation uses the responding Kitty window and awaits chunked acknowledgements', async () => {
  const rig = harness(undefined, 2);
  const pending = rig.install();
  assert.equal(rig.commands.length, 1);
  await pending;
  assert.deepEqual(rig.commands.map(command => command.cmd), ['ls', 'load-config']);
  assert.deepEqual(rig.commands[0].payload, {self: true});
  assert.deepEqual(rig.commands[1].payload.override, [
    'map=--when-focus-on id:42 cmd+alt+right send_key ctrl+end',
    'map=--when-focus-on id:42 cmd+alt+left send_key ctrl+home',
  ]);
  assert.equal(rig.wires.join('').includes(privateValue), false);
  rig.restored();
});

test('installation restores raw mode and pauses input before tmux takes ownership', async () => {
  const rig = harness();
  rig.input.isRaw = true;
  rig.input.resume();
  await rig.install();
  rig.restored(true, true);
});

test('rejected commands and invalid window responses fail without leaking private data', async () => {
  const cases = [
    [{ok: false, error: 'Remote control is disabled'}],
    [{ok: true, data: JSON.stringify(windowTree)}, {ok: false, error: 'Mapping rejected'}],
    [{ok: true, data: privateValue}],
    [{ok: true, data: JSON.stringify([{tabs: [{windows: [{id: 17, env: {TOKEN: privateValue}}]}]}])}],
    [{ok: true, data: JSON.stringify([{tabs: [{windows: [{id: 17, is_self: true}, {id: 42, is_self: true}]}]}])}],
  ];
  for (const responses of cases) {
    const rig = harness(responses);
    await assert.rejects(rig.install(), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(privateValue), false);
      return true;
    });
    assert.equal(rig.wires.join('').includes(privateValue), false);
    rig.restored();
  }
});

test('timeout, cancellation and stream failures restore terminal state and listeners', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const timeout = harness([]);
  const pending = assert.rejects(timeout.install(), /timed out|timeout/i);
  t.mock.timers.tick(3001);
  await pending;
  timeout.restored();
  for (const interrupt of [
    (rig: ReturnType<typeof harness>) => rig.input.emit('data', Buffer.from('\x03')),
    (rig: ReturnType<typeof harness>) => rig.input.emit('error', Error('Input failed')),
    (rig: ReturnType<typeof harness>) => rig.output.emit('error', Error('Output failed')),
    (rig: ReturnType<typeof harness>) => rig.input.emit('end'),
  ]) {
    const rig = harness([]);
    const failed = assert.rejects(rig.install());
    interrupt(rig);
    await failed;
    rig.restored();
  }
  const writeFailure = harness([]);
  writeFailure.output.write = () => {throw Error('Write failed');};
  await assert.rejects(writeFailure.install(), /Write failed/);
  writeFailure.restored();
});

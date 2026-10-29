import { StringDecoder } from 'node:string_decoder';

const prefix = '\x1bP@kitty-cmd';
const terminator = '\x1b\\';

export function encodeKittyCommand(command: object, depth: number): string {
  if (!Number.isSafeInteger(depth) || depth < 0) throw Error('Invalid tmux passthrough depth');
  let encoded = `${prefix}${JSON.stringify(command)}${terminator}`;
  for (let i = 0; i < depth; i++) encoded = `\x1bPtmux;${encoded.replaceAll('\x1b', '\x1b\x1b')}${terminator}`;
  return encoded;
}

function request(input: NodeJS.ReadStream, output: NodeJS.WriteStream, depth: number, cmd: string, payload: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let received = '';
    let settled = false;
    const finish = (error?: Error, data?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off('data', read);
      input.off('error', fail);
      input.off('end', ended);
      output.off('error', fail);
      if (error) reject(error);
      else resolve(data);
    };
    const fail = (error: Error) => finish(error);
    const ended = () => finish(Error(`Kitty ${cmd} failed: terminal input ended`));
    const read = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
      if (text.includes('\x03')) return finish(Error('Kitty navigation setup cancelled with Ctrl+C'));
      received += text;
      const start = received.indexOf(prefix);
      if (start < 0) return;
      const end = received.indexOf(terminator, start + prefix.length);
      if (end < 0) return;
      let response: { ok?: boolean; data?: unknown; error?: string };
      try {
        response = JSON.parse(received.slice(start + prefix.length, end));
      } catch {
        return finish(Error(`Kitty ${cmd} failed: invalid response`));
      }
      if (!response || response.ok !== true) return finish(Error(`Kitty ${cmd} failed: ${response?.error || 'missing success acknowledgement'}`));
      finish(undefined, response.data);
    };
    const timer = setTimeout(() => finish(Error(`Kitty ${cmd} timed out waiting for a response`)), 3000);
    input.on('data', read);
    input.on('error', fail);
    input.on('end', ended);
    output.on('error', fail);
    try {
      input.resume();
      output.write(encodeKittyCommand({ cmd, version: [0, 43, 1], no_response: false, payload }, depth));
    } catch (error) {
      finish(error instanceof Error ? error : Error(String(error)));
    }
  });
}

function currentWindow(data: unknown): number {
  let windows: { id: number; is_self?: boolean }[];
  try {
    if (typeof data !== 'string') throw Error();
    const listing = JSON.parse(data) as { tabs: { windows: { id: number; is_self?: boolean }[] }[] }[];
    windows = listing.flatMap(window => window.tabs.flatMap(tab => tab.windows)).filter(window => window.is_self === true);
  } catch {
    throw Error('Kitty returned an invalid window listing');
  }
  if (windows.length !== 1 || !Number.isSafeInteger(windows[0].id) || windows[0].id < 0) throw Error('Kitty did not identify exactly one current window');
  return windows[0].id;
}

export async function installKittyNavigation(input: NodeJS.ReadStream, output: NodeJS.WriteStream, depth: number): Promise<void> {
  const raw = input.isRaw;
  try {
    input.setRawMode(true);
    const id = currentWindow(await request(input, output, depth, 'ls', { self: true }));
    await request(input, output, depth, 'load-config', {
      override: [
        `map=--when-focus-on id:${id} cmd+alt+right send_key ctrl+end`,
        `map=--when-focus-on id:${id} cmd+alt+left send_key ctrl+home`
      ]
    });
  } finally {
    input.setRawMode(raw);
    input.pause();
  }
}

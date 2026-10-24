import { createConnection, createServer, type Server } from 'node:net';
import { chmodSync, rmSync } from 'node:fs';
import { paths } from './store.js';
export type Command = { op: string; [key: string]: unknown };
export async function running(name:string) {try {return await request(name,{op:'status'});}catch(e){if(['ENOENT','ECONNREFUSED'].includes((e as NodeJS.ErrnoException).code || ''))return undefined;throw e;}}
export function request(name: string, command: Command): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(paths(name).socket);
    let data = '';
    socket.setTimeout(command.op==='close'?90000:15000, () => socket.destroy(Error('Pane command timed out')));
    socket.on('connect', () => socket.write(JSON.stringify(command) + '\n'));
    socket.on('data', chunk => {
      data += chunk;
      if (data.includes('\n')) {
        socket.end();
        try { const result = JSON.parse(data.split('\n')[0]); result.error ? reject(Error(result.error)) : resolve(result.value); } catch(e) { reject(e); }
      }
    });
    socket.on('error', reject);
    socket.on('end', () => { if (!data.includes('\n')) reject(Error('Pane closed before acknowledgement')); });
  });
}
export async function listen(name: string, operation: (cmd: Command) => Promise<unknown>): Promise<Server> {
  const path = paths(name).socket;
  rmSync(path, { force: true });
  const server = createServer(socket => {
    let data = ''; let handled = false;
    socket.setTimeout(15000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      if (handled) return;
      data += chunk;
      if (Buffer.byteLength(data) > 4 * 1024 * 1024) { handled = true; socket.end(JSON.stringify({error:'Command too large'})+'\n'); return; }
      if (!data.includes('\n')) return;
      handled = true;
      try {
        const command=JSON.parse(data.split('\n')[0]);
        if(command.op==='close') socket.setTimeout(90000);
        socket.end(JSON.stringify({ value: await operation(command) }) + '\n');
      }
      catch(e) { socket.end(JSON.stringify({ error: String(e) }) + '\n'); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  chmodSync(path, 0o600);
  return server;
}

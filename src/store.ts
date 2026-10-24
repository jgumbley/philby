import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, mkdtempSync, cpSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';

export const root = resolve(process.env.PHILBY_ROOT || fileURLToPath(new URL('../../', import.meta.url)));
if(existsSync(join(root,'.env'))) process.loadEnvFile(join(root,'.env'));
if(process.env.PHILBY_HOME) throw Error('PHILBY_HOME is no longer supported; use PHILBY_PANES_DIR for complete pane directories');
export const panesRoot = resolve(process.env.PHILBY_PANES_DIR || join(root,'panes'));
export const runtimeDir = join(tmpdir(), `philby-${process.getuid!()}-${createHash('sha256').update(panesRoot).digest('hex').slice(0,16)}`);
export function slug(value: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value) || value.length > 64) throw Error('Slug must be 1–64 lowercase letters, digits or hyphens, beginning with a letter or digit');
  return value;
}
export function paths(name: string) {
  slug(name);
  if(existsSync(join(root,'.philby','panes',name))) throw Error(`Pane ${name} has legacy state; close old panes and run make -C shared migrate-state`);
  const tools = join(panesRoot, name);
  const state = join(tools, '.state');
  const socketDir = runtimeDir;
  return { state, tools, socketDir, socket: join(socketDir, `${name}.sock`) };
}
export function paneTypes() {
  return readdirSync(join(root,'pane-types'),{withFileTypes:true}).filter(entry=>entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(entry.name)).map(entry=>entry.name).sort((a,b)=>a==='plain'?-1:b==='plain'?1:a.localeCompare(b));
}
export function configured(name: string) {
  const p=paths(name);
  return ['.pane-type','SCOPE.md','AGENTS.md','Makefile'].some(file=>existsSync(join(p.tools,file))) || existsSync(join(p.state,'durable.sqlite'));
}
export function prepare(name: string, type?: string) {
  const p = paths(name);
  if(type!==undefined && !paneTypes().includes(type)) throw Error(`Unknown pane type: ${type}`);
  if(existsSync(join(p.tools,'AGENTS.md')) && !existsSync(join(p.tools,'SCOPE.md'))) throw Error(`Pane ${name} uses AGENTS.md; rename it to SCOPE.md before opening`);
  const marker=join(p.tools,'.pane-type');
  if(configured(name)) {
    const saved=existsSync(marker)?readFileSync(marker,'utf8').trim():'plain';
    if(type!==undefined && type!==saved) throw Error(`Pane ${name} already exists with type ${saved}`);
    if(existsSync(marker)) {
      for(const file of ['SCOPE.md','Makefile']) readFileSync(join(p.tools,file),'utf8');
    } else {
      for (const [file, content] of [['SCOPE.md',''],['Makefile','.DEFAULT_GOAL := help\n.PHONY: help\nhelp:\n\t@echo "No pane tools yet. Build and document tools here as responsibilities require."\n']]) {
        try { writeFileSync(join(p.tools,file),content,{flag:'wx'}); } catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error; }
      }
    }
  } else {
    mkdirSync(dirname(p.tools),{recursive:true});
    const staging=mkdtempSync(join(dirname(p.tools),'.creating-'));
    try {
      cpSync(join(root,'pane-types',type || 'plain'),staging,{recursive:true,errorOnExist:true,force:false});
      for(const file of ['SCOPE.md','Makefile']) readFileSync(join(staging,file),'utf8');
      writeFileSync(join(staging,'.pane-type'),`${type || 'plain'}\n`,{flag:'wx'});
      if(existsSync(p.tools)) {
        const files=readdirSync(staging);
        for(const file of files) if(existsSync(join(p.tools,file))) throw Error(`Pane creation would overwrite ${join(p.tools,file)}`);
        for(const file of files.filter(file=>file!=='.pane-type')) renameSync(join(staging,file),join(p.tools,file));
        renameSync(join(staging,'.pane-type'),marker);
      } else renameSync(staging,p.tools);
    } finally {rmSync(staging,{recursive:true,force:true});}
  }
  mkdirSync(p.state, { recursive: true, mode: 0o700 });
  mkdirSync(p.socketDir, { recursive: true, mode: 0o700 });
  return p;
}
export function lock(name: string) {
  const db = new DatabaseSync(join(prepare(name).state, 'lock.sqlite'));
  try { db.exec('BEGIN EXCLUSIVE'); } catch (error) { db.close(); if((error as {errcode:number}).errcode===5) throw Error(`Pane ${name} is already running`); throw error; }
  return () => db.close();
}
export type Envelope = { id: string; from: string; to: string; content: string; kind: 'input' | 'update'; mode: 'steer' | 'followUp' };
export type Check = { id: string; prompt: string; timezone: string; intervalMs?: number; daily?: string; next: number; paused: boolean; task?: number };
export function nextDeadline(check: Pick<Check, 'intervalMs'|'daily'|'timezone'>, after: number): number {
  if (!DateTime.now().setZone(check.timezone).isValid) throw Error('Invalid timezone');
  if (check.intervalMs !== undefined) {
    if (!Number.isSafeInteger(check.intervalMs) || check.intervalMs < 1000) throw Error('Interval must be an integer of at least 1000 ms');
    if (check.daily) throw Error('Choose intervalMs or daily');
    return after + check.intervalMs;
  }
  if (!check.daily || !/^([01]\d|2[0-3]):[0-5]\d$/.test(check.daily)) throw Error('daily must be HH:mm');
  const [hour, minute] = check.daily.split(':').map(Number);
  const local = DateTime.fromMillis(after, { zone: check.timezone });
  let next = local.set({ hour, minute, second: 0, millisecond: 0 });
  if (next.toMillis() <= after) next = local.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
  return next.toMillis();
}
export class Store {
  db: DatabaseSync;
  constructor(readonly name: string) {
    const state=paths(name).state;
    mkdirSync(state,{recursive:true,mode:0o700});
    this.db = new DatabaseSync(join(state, 'app.sqlite'));
    try {this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, body TEXT NOT NULL, placed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS updates (id TEXT PRIMARY KEY, body TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0);`);
    } catch(error) {this.db.close();throw error;}
  }
  accept(e: Envelope) {
    slug(e.from); slug(e.to);
    if (e.to !== this.name) throw Error('Wrong receiving pane');
    if (!e.id || !e.content.trim()) throw Error('Request ID and nonempty content required');
    if(!['input','update'].includes(e.kind) || !['steer','followUp'].includes(e.mode)) throw Error('Invalid message kind or mode');
    const body = JSON.stringify(e);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT body FROM inbox WHERE id=?').get(e.id);
      if (prior && prior.body !== body) throw Error('Request ID conflict in receiving pane');
      this.db.prepare('INSERT OR IGNORE INTO inbox(id,body) VALUES (?,?)').run(e.id, body);
      this.db.exec('COMMIT');
      return e.id;
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  pending(): Envelope[] {
    return this.db.prepare('SELECT body FROM inbox WHERE placed=0 ORDER BY rowid').all().map(r => JSON.parse(String(r.body)));
  }
  placed(e: Envelope) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (e.kind === 'update') this.db.prepare('INSERT OR IGNORE INTO updates(id,body) VALUES (?,?)').run(e.id, JSON.stringify(e));
      this.db.prepare('UPDATE inbox SET placed=1 WHERE id=?').run(e.id);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  updates(mark = false) {
    const rows = this.db.prepare('SELECT body,seen FROM updates ORDER BY rowid').all();
    if (mark) this.db.exec('UPDATE updates SET seen=1');
    return rows.map(r => ({ ...JSON.parse(String(r.body)), seen: !!r.seen }));
  }
  close() { this.db.close(); }
}
export function envelope(from: string, to: string, content: string, options: Partial<Envelope> = {}): Envelope {
  return { id: randomUUID(), from: slug(from), to: slug(to), content, kind: 'input', mode: 'followUp', ...options };
}

export function locked(name: string) {
  const path=join(paths(name).state,'lock.sqlite');
  if(!existsSync(path)) return false;
  const db=new DatabaseSync(path);
  try {db.exec('BEGIN EXCLUSIVE');return false;}catch(error){if((error as {errcode:number}).errcode===5)return true;throw error;}finally{db.close();}
}

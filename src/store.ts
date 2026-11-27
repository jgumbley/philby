import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, mkdtempSync, cpSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { root } from './config.js';

export { root };
if(process.env.PHILBY_HOME) throw Error('PHILBY_HOME is no longer supported; use PHILBY_FRAMES_DIR for complete frame directories');
if(process.env.PHILBY_PANES_DIR) throw Error('PHILBY_PANES_DIR was renamed to PHILBY_FRAMES_DIR; migrate the directory with make frame-migrate INPUT=old-directory');
export const framesRoot = resolve(process.env.PHILBY_FRAMES_DIR || join(root,'frames'));
export const runtimeDir = join(tmpdir(), `philby-${process.getuid!()}-${createHash('sha256').update(framesRoot).digest('hex').slice(0,16)}`);
export function validateFrameId(value: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value) || value.length > 64) throw Error('Frame ID must be 1–64 lowercase letters, digits or hyphens, beginning with a letter or digit');
  return value;
}
export function paths(id: string) {
  validateFrameId(id);
  if(existsSync(join(root,'.philby','frames',id))) throw Error(`Frame ${id} has unsupported legacy state; migrate it with a prior Philby version before opening`);
  if(existsSync(join(root,'.philby','panes',id))) throw Error(`Frame ${id} has unsupported legacy state; migrate it with a prior Philby version before opening`);
  if(!process.env.PHILBY_FRAMES_DIR && existsSync(join(root,'panes'))) throw Error('Legacy panes/ directory exists; run make frame-migrate before opening frames');
  const tools = join(framesRoot, id);
  const state = join(tools, '.state');
  const socketDir = runtimeDir;
  return { state, tools, socketDir, socket: join(socketDir, `${id}.sock`) };
}
export function frameTypes() {
  return readdirSync(join(root,'frame-types'),{withFileTypes:true}).filter(entry=>entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(entry.name)).map(entry=>entry.name).sort((a,b)=>a==='plain'?-1:b==='plain'?1:a.localeCompare(b));
}
export function configured(id: string) {
  const p=paths(id);
  return ['.frame-type','SCOPE.md','AGENTS.md','Makefile'].some(file=>existsSync(join(p.tools,file))) || existsSync(join(p.state,'durable.sqlite'));
}
export function lastUsed(id: string) {
  const {state}=paths(id);
  return Math.max(...['last-used','durable.sqlite','durable.sqlite-wal'].map(file=>
    statSync(join(state,file),{throwIfNoEntry:false})?.mtimeMs ?? 0
  ));
}
export function markUsed(id: string) {
  writeFileSync(join(paths(id).state,'last-used'),'',{mode:0o600});
}
export function prepare(id: string, type?: string) {
  const p = paths(id);
  if(existsSync(join(p.tools,'AGENTS.md')) && !existsSync(join(p.tools,'SCOPE.md'))) throw Error(`Frame ${id} uses AGENTS.md; rename it to SCOPE.md before opening`);
  const marker=join(p.tools,'.frame-type');
  if(configured(id)) {
    const saved=existsSync(marker)?readFileSync(marker,'utf8').trim():'plain';
    if(type!==undefined && type!==saved) throw Error(`Frame ${id} already exists with type ${saved}`);
    if(existsSync(marker)) {
      for(const file of ['SCOPE.md','Makefile']) readFileSync(join(p.tools,file),'utf8');
    } else {
      for (const [file, content] of [['SCOPE.md',''],['Makefile','.DEFAULT_GOAL := help\n.PHONY: help\nhelp:\n\t@echo "No frame tools yet. Build and document tools here as responsibilities require."\n']]) {
        try { writeFileSync(join(p.tools,file),content,{flag:'wx'}); } catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error; }
      }
    }
  } else {
    if(type!==undefined && !frameTypes().includes(type)) throw Error(`Unknown frame type: ${type}`);
    mkdirSync(dirname(p.tools),{recursive:true});
    const staging=mkdtempSync(join(dirname(p.tools),'.creating-'));
    try {
      cpSync(join(root,'frame-types',type || 'plain'),staging,{recursive:true,errorOnExist:true,force:false});
      for(const file of ['SCOPE.md','Makefile']) readFileSync(join(staging,file),'utf8');
      writeFileSync(join(staging,'.frame-type'),`${type || 'plain'}\n`,{flag:'wx'});
      if(existsSync(p.tools)) {
        const files=readdirSync(staging);
        for(const file of files) if(existsSync(join(p.tools,file))) throw Error(`Frame creation would overwrite ${join(p.tools,file)}`);
        for(const file of files.filter(file=>file!=='.frame-type')) renameSync(join(staging,file),join(p.tools,file));
        renameSync(join(staging,'.frame-type'),marker);
      } else renameSync(staging,p.tools);
    } finally {rmSync(staging,{recursive:true,force:true});}
  }
  if(!existsSync(join(p.tools,'frame.env'))) {
    try {writeFileSync(join(p.tools,'.env.schema'),'# @defaultRequired=true\n# @defaultSensitive=true\n',{flag:'wx'});}
    catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;}
  }
  mkdirSync(p.state, { recursive: true, mode: 0o700 });
  mkdirSync(p.socketDir, { recursive: true, mode: 0o700 });
  return p;
}
export function lock(id: string) {
  const db = new DatabaseSync(join(prepare(id).state, 'lock.sqlite'));
  try { db.exec('BEGIN EXCLUSIVE'); } catch (error) { db.close(); if((error as {errcode:number}).errcode===5) throw Error(`Frame ${id} is already running`); throw error; }
  return () => db.close();
}
export function locked(id: string) {
  const path=join(paths(id).state,'lock.sqlite');
  if(!existsSync(path)) return false;
  const db=new DatabaseSync(path);
  try {db.exec('BEGIN EXCLUSIVE');return false;}catch(error){if((error as {errcode:number}).errcode===5)return true;throw error;}finally{db.close();}
}

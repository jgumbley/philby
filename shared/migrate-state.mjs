import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(process.env.PHILBY_ROOT || fileURLToPath(new URL('../',import.meta.url)));
const panes=resolve(process.env.PHILBY_PANES_DIR || join(root,'panes'));
const legacy=join(root,'.philby');
const directory=join(legacy,'panes');
const locks=[];
function hold(file) {
  if(!existsSync(file)) return;
  const db=new DatabaseSync(file);
  try {db.exec('BEGIN EXCLUSIVE');locks.push(db);}
  catch(error) {db.close();throw Error(`Close all old panes before moving state: ${file}`,{cause:error});}
}
function inventory(path) {
  return readdirSync(path,{withFileTypes:true}).flatMap(entry=>{
    const file=join(path,entry.name);
    if(entry.isSymbolicLink()) throw Error(`State contains a symlink: ${file}`);
    return entry.isDirectory()?inventory(file).map(([name,hash])=>[join(entry.name,name),hash]):[[entry.name,createHash('sha256').update(readFileSync(file)).digest('hex')]];
  }).sort(([a],[b])=>a.localeCompare(b));
}
try {
  if(!existsSync(directory)) {
    console.log(JSON.stringify({moved:0}));
  } else {
    hold(join(legacy,'open.sqlite'));
    const names=readdirSync(directory);
    for(const name of names) {
      if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw Error(`Unexpected legacy state entry: ${name}`);
      hold(join(directory,name,'lock.sqlite'));
      if(name!=='philby' && existsSync(join(panes,name,'.state'))) throw Error(`State already exists for ${name}; refusing to overwrite it`);
    }
    const unexpected=readdirSync(legacy).filter(name=>name!=='panes' && !/^open\.sqlite(?:-wal|-shm|-journal)?$/.test(name));
    if(unexpected.length) throw Error(`Unexpected legacy files: ${unexpected.join(', ')}`);
    let moved=0;
    for(const name of names.filter(name=>name!=='philby')) {
      const source=join(directory,name),pane=join(panes,name),destination=join(pane,'.state');
      const before=inventory(source);
      mkdirSync(pane,{recursive:true,mode:0o700});
      if(existsSync(join(pane,'Makefile'))) {
        const ignore=join(pane,'.gitignore');
        const contents=existsSync(ignore)?readFileSync(ignore,'utf8'):'';
        if(!contents.split(/\r?\n/).some(line=>line==='.state/' || line==='/.state/')) writeFileSync(ignore,`${contents}${contents && !contents.endsWith('\n')?'\n':''}.state/\n`);
      }
      renameSync(source,destination);
      if(JSON.stringify(inventory(destination))!==JSON.stringify(before)) throw Error(`State verification failed for ${name}`);
      moved++;
    }
    for(const db of locks.splice(0)) db.close();
    if(names.includes('philby')) {
      rmSync(join(directory,'philby'),{recursive:true});
      rmSync(join(panes,'philby'),{recursive:true,force:true});
    }
    rmdirSync(directory);
    rmSync(legacy,{recursive:true});
    console.log(JSON.stringify({moved,removedCoordinator:names.includes('philby'),verified:true}));
  }
} finally {
  for(const db of locks) db.close();
}

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const name=process.env.slug;
if(!name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw Error('Supply slug=<pane-slug>');
const relative=`panes/${name}`,directory=join(root,relative);
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const list=(output)=>output.split('\0').filter(Boolean);
const privateFile=file=>/\.(?:wav|dtsnd|dtprj|sqlite3?(?:-.*)?|db(?:-.*)?|log|jsonl)$/i.test(file) || /(^|\/)(?:\.env(?:\..*)?|\.philby|\.state|state|conversations|sessions)(\/|$)/.test(file);
function files(path=directory,prefix='') {
  return readdirSync(path).sort().flatMap(name=>{
    if(name==='.git') return [];
    const file=join(path,name),relative=join(prefix,name),stat=lstatSync(file);
    if(stat.isSymbolicLink()) throw Error(`Inspect symlink before splitting: ${relative}`);
    return stat.isDirectory()?files(file,relative):[relative];
  });
}
function inventory() {
  return Object.fromEntries(files().map(file=>[file,createHash('sha256').update(readFileSync(join(directory,file))).digest('hex')]));
}
function verify() {
  if(!existsSync(join(directory,'.git')) || !lstatSync(join(directory,'.git')).isDirectory()) throw Error('Pane must contain its own .git directory');
  if(git(directory,'rev-parse','--show-toplevel').trim()!==directory) throw Error('Pane repository root is incorrect');
  if(git(directory,'rev-parse','--absolute-git-dir').trim()!==join(directory,'.git')) throw Error('Pane Git metadata is outside its directory');
  const entries=list(git(root,'ls-files','--stage','-z','--',relative));
  if(entries.length) throw Error('Philby still tracks the pane');
  git(root,'check-ignore','--',relative);
  const tracked=list(git(directory,'ls-files','-z'));
  if(tracked.some(privateFile)) throw Error('Pane tracks an artifact or private state');
  console.log(JSON.stringify({repository:directory,trackedSourceFiles:tracked.length,localFiles:files().length,ownership:'independent',parentTracksPane:false}));
}
try {
  const operation=process.argv[2];
  if(operation==='inspect') {
    const entries=files();
    console.log(JSON.stringify({directory,localFiles:entries.length,wavFiles:entries.filter(file=>/\.wav$/i.test(file)).length,parentTrackedFiles:list(git(root,'ls-files','-z','--',relative)),independentRepository:existsSync(join(directory,'.git')) && lstatSync(join(directory,'.git')).isDirectory()}));
  } else if(operation==='init') {
    if(existsSync(join(directory,'.git'))) throw Error('Pane already has Git metadata; inspect it before continuing');
    if(!existsSync(join(directory,'.gitignore'))) throw Error('Add pane source/artifact ignore rules first');
    git(root,'check-ignore','--no-index','--',relative);
    const before=inventory(),tracked=list(git(root,'ls-files','-z','--',relative));
    git(directory,'init','--initial-branch=main');
    git(directory,'add','--','.');
    const added=list(git(directory,'diff','--cached','--name-only','-z'));
    if(added.some(privateFile)) throw Error('Initial source selection includes an artifact or private state; repair the pane ignore rules');
    if(!added.length || added.some(file=>readFileSync(join(directory,file)).includes(0))) throw Error('Initial source selection is empty or includes binary data');
    git(directory,'commit','-m',`Initialize ${name} pane repository`);
    if(tracked.length) git(root,'rm','--cached','--',...tracked);
    const after=inventory();
    if(Object.entries(before).some(([file,hash])=>after[file]!==hash)) throw Error('Pane files changed during repository initialization; inspect the working tree');
    verify();
  } else if(operation==='verify') verify();
  else throw Error('Use inspect, init or verify');
} catch(error) {
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
}

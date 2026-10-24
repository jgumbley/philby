import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { root, panesRoot, runtimeDir, prepare } from '../src/store.js';
import { running } from '../src/ipc.js';

const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const server=()=>process.env.PHILBY_TMUX_SOCKET || `philby-${createHash('sha256').update(panesRoot).digest('hex').slice(0,12)}`;
function tmux(args:string[], allowFailure=false) {
  const result=spawnSync('tmux',['-L',server(),'-f',join(root,'tmux','philby.conf'),...args],{encoding:'utf8'});
  if(result.error) throw result.error;
  if(!allowFailure && result.status!==0) throw Error(result.stderr || String(result.error));
  return result;
}
const quote=(s:string)=>`'${s.replaceAll("'", "'\\''")}'`;
function launch(action:string,name?:string) {
  const keys=['PHILBY_TEST_PROVIDER','PI_MODEL_ID'];
  const env=['PHILBY_ROOT='+root,'PHILBY_PANES_DIR='+panesRoot,'PHILBY_TMUX_SOCKET='+server(),...keys.filter(k=>process.env[k]).map(k=>`${k}=${process.env[k]}`)];
  return ['env','-u','slug',...env,process.execPath,'--disable-warning=ExperimentalWarning',cli,action,...(name?[name]:[])].map(quote).join(' ');
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function openingLock() {
  mkdirSync(runtimeDir,{recursive:true,mode:0o700});
  const mutex=new DatabaseSync(join(runtimeDir,'open.sqlite'));mutex.exec('PRAGMA busy_timeout=15000; BEGIN EXCLUSIVE');
  return mutex;
}
async function attach(name:string) {
  if(process.stdin.isTTY && process.env.PHILBY_DETACHED!=='1') {
    if(process.env.TMUX?.split(',')[0]===tmux(['display-message','-p','#{socket_path}']).stdout.trim()) return;
    const child=spawn('tmux',['-L',server(),'attach-session','-t','philby'],{stdio:'inherit'});
    await new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`tmux exited ${code}`)));});
  } else console.log(name);
}
export async function openPane(name:string,type?:string) {
  const mutex=openingLock();
  let target:string;
  try {
    prepare(name,type);
    const current=await running(name);
    const windows=tmux(['list-windows','-t','philby','-F','#{window_id}\t#{window_name}'],true).stdout || '';
    const existing=windows.split('\n').find(s=>s.split('\t')[1]===name)?.split('\t')[0];
    if(current) {if(!existing) throw Error(`${name} is running without a tmux view`); target=existing;}
    else {
      if(existing) tmux(['kill-window','-t',existing],true);
      const command=launch('serve',name);
      const has=tmux(['has-session','-t','philby'],true).status===0;
      target=tmux(has?['new-window','-d','-P','-F','#{window_id}','-t','philby:','-n',name,'-c',root,command]:['new-session','-d','-P','-F','#{window_id}','-s','philby','-n',name,'-c',root,command]).stdout.trim();
      tmux(['select-pane','-t',target,'-T',name]);
      let ready=false;
      for(let i=0;i<200;i++) {if(await running(name)){ready=true;break;}await sleep(100);}
      if(!ready) {const capture=tmux(['capture-pane','-p','-t',target],true).stdout;throw Error(`Pane ${name} failed to start. ${capture}`);}
    }
    tmux(['set-option','-g','@philby_new_window',launch('new')]);
    tmux(['select-window','-t',target]);
    const view=tmux(['list-panes','-t',target,'-F','#{pane_id}\t#{pane_title}']).stdout.trim().split('\n').filter(line=>line.split('\t')[1]===name);
    if(view.length!==1) throw Error(`Expected one agent view for ${name}`);
    tmux(['select-pane','-t',view[0].split('\t')[0]]);
  } finally {mutex.close();}
  await attach(name);
}
export async function openSelector() {
  const mutex=openingLock();
  try {
    const windows=tmux(['list-windows','-t','philby','-F','#{window_id}\t#{window_name}'],true).stdout || '';
    let target=windows.split('\n').find(s=>s.split('\t')[1]==='+')?.split('\t')[0];
    if(!target) {
      const has=tmux(['has-session','-t','philby'],true).status===0;
      const command=launch('name');
      target=tmux(has?['new-window','-d','-P','-F','#{window_id}','-t','philby:','-n','+','-c',root,command]:['new-session','-d','-P','-F','#{window_id}','-s','philby','-n','+','-c',root,command]).stdout.trim();
    }
    tmux(['set-option','-g','@philby_new_window',launch('new')]);
    tmux(['select-window','-t',target]);
  } finally {mutex.close();}
  if(process.stdin.isTTY) await attach('+');
}
export function listViews() {
  const panes=tmux(['list-panes','-a','-F','tmux\t#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}\t#{window_name}\t#{pane_current_command}'],true);
  if(panes.status!==0 && !/^(no server running on |error connecting to .* \(No such file or directory\))/.test(panes.stderr)) throw Error(panes.stderr);
  return '\nView\tTmux target\tPane ID\tWindow\tCommand\n'+panes.stdout;
}
export function openShell() {
  tmux(['new-window','-t','philby:','-c',root]);
}
export function stopServer() {
  tmux(['kill-server'],true);
}

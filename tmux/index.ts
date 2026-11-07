import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { root, panesRoot, runtimeDir, prepare } from '../src/store.js';
import { piAgentDir } from '../src/config.js';
import { running } from '../src/ipc.js';
import { installKittyNavigation } from './kitty.js';
import { withTmuxPassthrough } from './kitty-route.js';

export { root, panesRoot, runtimeDir };
type BrowserName = 'chrome' | 'firefox';
type BrowserView = {name:BrowserName;pane:string;pid:number;dead:boolean};

const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const server=()=>process.env.PHILBY_TMUX_SOCKET || `philby-${createHash('sha256').update(panesRoot).digest('hex').slice(0,12)}`;
function tmux(args:string[], allowFailure=false) {
  const result=spawnSync('tmux',['-L',server(),'-f',join(root,'tmux','philby.conf'),...args],{encoding:'utf8'});
  if(result.error) throw result.error;
  if(!allowFailure && result.status!==0) throw Error(result.stderr || String(result.error));
  return result;
}
function paneList(format:string) {
  const result=tmux(['list-panes','-a','-F',format],true);
  if(result.status!==0 && !/^(no server running on |error connecting to .* \(No such file or directory\))/.test(result.stderr)) throw Error(result.stderr);
  return result.stdout;
}
const quote=(s:string)=>`'${s.replaceAll("'", "'\\''")}'`;
function launch(action:string,name?:string) {
  const keys=['PHILBY_TEST_PROVIDER'];
  const env=['PHILBY_ROOT='+root,'PHILBY_PANES_DIR='+panesRoot,'PHILBY_TMUX_SOCKET='+server(),'PI_CODING_AGENT_DIR='+piAgentDir,...keys.filter(k=>process.env[k]).map(k=>`${k}=${process.env[k]}`)];
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
    if(process.platform==='darwin' && process.env.KITTY_WINDOW_ID) {
      if(!process.stdout.isTTY) throw Error('Kitty navigation requires terminal output; stdout is redirected');
      await withTmuxPassthrough(depth=>installKittyNavigation(process.stdin,process.stdout,depth));
    }
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
  return '\nView\tTmux target\tPane ID\tWindow\tCommand\n'+paneList('tmux\t#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}\t#{window_name}\t#{pane_current_command}');
}
export function openShell() {
  tmux(['new-window','-t','philby:','-c',root]);
}
export function browserViews():BrowserView[] {
  return paneList('#{session_name}\t#{pane_id}\t#{pane_pid}\t#{pane_dead}\t#{@philby_browser}').trim().split('\n').flatMap(line=>{
    const [session,pane,pid,dead,name]=line.split('\t');
    return session==='philby' && (name==='chrome' || name==='firefox') ? [{name,pane,pid:Number(pid),dead:dead==='1'}] : [];
  });
}
export function browserSocket(name:BrowserName) {
  return join(runtimeDir,`@b${createHash('sha256').update(`${server()}:${name}`).digest('hex').slice(0,16)}.sock`);
}
function killBrowser(view:BrowserView) {
  if(!view.dead) {
    try {process.kill(view.pid,'SIGKILL');}
    catch(error) {if((error as NodeJS.ErrnoException).code!=='ESRCH') throw error;}
  }
}
export function openBrowser(name:BrowserName,command:string[],cwd:string):{pane:string;started:boolean} {
  if(name!=='chrome' && name!=='firefox') throw Error('Expected chrome or firefox');
  if(command.length<2) throw Error('Browser service requires a command and arguments');
  const mutex=openingLock();
  try {
    const views=browserViews().filter(view=>view.name===name);
    if(views.length>1) throw Error(`Multiple browser service panes for ${name}`);
    let pane=views[0]?.pane;
    const started=!pane || views[0].dead;
    const title=`@browser-${name}`;
    if(pane && started) tmux(['respawn-pane','-t',pane,'-c',cwd,...command]);
    if(!pane) {
      const windows=tmux(['list-windows','-t','philby','-F','#{window_name}'],true).stdout.trim().split('\n');
      if(windows.includes(title)) throw Error(`Window ${title} is not an owned browser service`);
      const has=tmux(['has-session','-t','philby'],true).status===0;
      pane=tmux(has?['new-window','-d','-P','-F','#{pane_id}','-t','philby:','-n',title,'-c',cwd,...command]:['new-session','-d','-P','-F','#{pane_id}','-s','philby','-n',title,'-c',cwd,...command]).stdout.trim();
      tmux(['set-option','-p','-t',pane,'@philby_browser',name]);
    }
    tmux(['select-pane','-t',pane,'-T',title]);
    tmux(['set-option','-g','@philby_new_window',launch('new')]);
    tmux(['select-window','-t',pane]);
    tmux(['select-pane','-t',pane]);
    return {pane,started};
  } finally {mutex.close();}
}
export function closeBrowserPane(name:BrowserName,pane:string,pid:number) {
  const mutex=openingLock();
  try {
    const view=browserViews().find(view=>view.name===name && view.pane===pane);
    if(!view) {
      if(!paneList('#{pane_id}').trim().split('\n').includes(pane)) return;
      throw Error(`Pane ${pane} is not an owned ${name} browser service`);
    }
    if(view.pid!==pid) throw Error(`Pane ${pane} is not the expected ${name} browser service process`);
    killBrowser(view);
    const result=tmux(['kill-pane','-t',pane],true);
    if(result.status!==0 && browserViews().some(view=>view.pane===pane)) throw Error(result.stderr);
  } finally {mutex.close();}
}
export function terminateBrowser(name:BrowserName,pane:string,pid:number) {
  const mutex=openingLock();
  try {
    const view=browserViews().find(view=>view.name===name && view.pane===pane && view.pid===pid);
    if(!view) throw Error(`Pane ${pane} is not the expected ${name} browser service process`);
    killBrowser(view);
  } finally {mutex.close();}
}
export async function closeBrowsers() {
  const failures:Error[]=[];
  for(const view of browserViews().filter(view=>!view.dead)) {
    try {
      await new Promise<void>((resolve,reject)=>{
        const socket=createConnection(browserSocket(view.name));
        const timeout=setTimeout(()=>socket.destroy(Error(`Timed out disconnecting ${view.name} browser service`)),5000);
        let data='';let answered=false;
        socket.on('connect',()=>socket.write(JSON.stringify({op:'disconnect'})+'\n'));
        socket.on('data',chunk=>{
          data+=chunk;
          if(answered || !data.includes('\n')) return;
          answered=true;
          try {
            const result=JSON.parse(data.split('\n')[0]);
            if(result.error) throw Error(result.error);
            if(result.value?.disconnected!==true) throw Error(`Invalid disconnect response from ${view.name} browser service`);
            resolve();
          } catch(error) {reject(error);}
          finally {socket.destroy();}
        });
        socket.on('error',reject);
        socket.on('close',()=>{clearTimeout(timeout);if(!answered) reject(Error(`${view.name} browser service closed before disconnect acknowledgement`));});
      });
    } catch(error) {
      const errors=[error];
      try {
        if(browserViews().some(current=>current.name===view.name && current.pane===view.pane && current.pid===view.pid && !current.dead)) terminateBrowser(view.name,view.pane,view.pid);
      } catch(failure) {errors.push(failure);}
      failures.push(Error(`Failed to disconnect ${view.name}; unfinished work may have been interrupted. Inspect the page before retrying.\n${errors.map(String).join('\n')}`));
    }
  }
  if(failures.length) throw Error(failures.map(String).join('\n'));
}
export function stopServer() {
  tmux(['kill-server'],true);
}

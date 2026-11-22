import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { root, framesRoot, runtimeDir, prepare, markUsed, paths, validateFrameId } from '../src/store.js';
import { invocationEnvironment, piAgentDir } from '../src/config.js';
import { request, running } from '../src/ipc.js';
import { installKittyNavigation } from './kitty.js';
import { withTmuxPassthrough } from './kitty-route.js';

export { root, framesRoot, runtimeDir };
type BrowserName = 'chrome' | 'firefox';
type BrowserView = {name:BrowserName;pane:string;pid:number;dead:boolean};

const launcher=fileURLToPath(new URL('../src/launch.js',import.meta.url));
const server=()=>process.env.PHILBY_TMUX_SOCKET || `philby-${createHash('sha256').update(framesRoot).digest('hex').slice(0,12)}`;
const launchDirectory=()=>join(runtimeDir,`launch-${createHash('sha256').update(server()).digest('hex').slice(0,16)}`);
const environmentFiles=new Map<boolean,string>();
function tmux(args:string[], allowFailure=false,timeout?:number) {
  const result=spawnSync('tmux',['-L',server(),'-f',join(root,'tmux','philby.conf'),...args],{encoding:'utf8',timeout});
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
function launch(action:string,...args:string[]) {
  const owned=action==='pane-run';
  let environmentFile=environmentFiles.get(owned);
  if(!environmentFile) {
    const env:NodeJS.ProcessEnv={...(owned?process.env:invocationEnvironment),PHILBY_ROOT:root,PHILBY_FRAMES_DIR:framesRoot,PHILBY_TMUX_SOCKET:server(),PI_CODING_AGENT_DIR:piAgentDir};
    for(const key of ['id','TYPE','MAKEFLAGS','MAKEOVERRIDES','MFLAGS','MAKELEVEL']) delete env[key];
    if(!owned) delete env.PHILBY_FRAME;
    mkdirSync(launchDirectory(),{recursive:true,mode:0o700});
    environmentFile=join(launchDirectory(),`${randomUUID()}.json`);
    writeFileSync(environmentFile,JSON.stringify(env),{flag:'wx',mode:0o600});
    environmentFiles.set(owned,environmentFile);
  }
  return [process.execPath,'--disable-warning=ExperimentalWarning',launcher,environmentFile,action,...args].map(quote).join(' ');
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export function installCloseBinding() {
  tmux(['set-option','-g','@philby_close_view',launch('close-view'),';',
    'source-file',join(root,'tmux','close.conf')]);
}
function installControls() {
  tmux(['set-option','-g','@philby_new_window',launch('new')]);
  installCloseBinding();
}
function openingLock() {
  mkdirSync(runtimeDir,{recursive:true,mode:0o700});
  const mutex=new DatabaseSync(join(runtimeDir,'open.sqlite'));mutex.exec('PRAGMA busy_timeout=15000; BEGIN EXCLUSIVE');
  return mutex;
}
async function attach(id:string) {
  if(process.stdin.isTTY && process.env.PHILBY_DETACHED!=='1') {
    if(process.env.TMUX?.split(',')[0]===tmux(['display-message','-p','#{socket_path}']).stdout.trim()) return;
    if(process.platform==='darwin' && process.env.KITTY_WINDOW_ID) {
      if(!process.stdout.isTTY) throw Error('Kitty navigation requires terminal output; stdout is redirected');
      await withTmuxPassthrough(depth=>installKittyNavigation(process.stdin,process.stdout,depth));
    }
    const child=spawn('tmux',['-L',server(),'attach-session','-t','philby'],{stdio:'inherit'});
    await new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`tmux exited ${code}`)));});
  } else console.log(id);
}
export async function openFrame(id:string,type?:string) {
  const mutex=openingLock();
  let target:string;
  try {
    prepare(id,type);
    const current=await running(id);
    const existing=ownerWindow(id);
    if(current) {if(!existing) throw Error(`${id} is running without a tmux view`); target=existing;}
    else {
      closeFramePanes(id);
      if(existing) tmux(['kill-window','-t',existing],true);
      const command=launch('serve',id);
      const has=tmux(['has-session','-t','philby'],true).status===0;
      target=tmux(has?['new-window','-d','-P','-F','#{window_id}','-t','philby:','-n',id,'-c',root,command]:['new-session','-d','-P','-F','#{window_id}','-s','philby','-n',id,'-c',root,command]).stdout.trim();
      tmux(['select-pane','-t',target,'-T',id]);
      const pane=tmux(['display-message','-p','-t',target,'#{pane_id}']).stdout.trim();
      identifyOwner(target,pane,id);
      let ready=false;
      for(let i=0;i<200;i++) {if(await running(id)){ready=true;break;}await sleep(100);}
      if(!ready) {const capture=tmux(['capture-pane','-p','-t',target],true).stdout;throw Error(`Frame ${id} failed to start. ${capture}`);}
    }
    installControls();
    tmux(['select-window','-t',target]);
    const agent=tmux(['show-options','-wqv','-t',target,'@philby_agent']).stdout.trim();
    tmux(['select-pane','-t',agent]);
    markUsed(id);
  } finally {mutex.close();}
  await attach(id);
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
    installControls();
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
type PaneSource = 'frame' | 'shared';
function paneName(name:string) {
  if(typeof name!=='string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw Error('Pane name must be 1–64 lowercase letters, digits or hyphens, beginning with a letter or digit');
  return name;
}
function paneRecipe(name:string,target:string,source:PaneSource) {
  paneName(name);
  if(typeof target!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(target)) throw Error('Supply a named Make target');
  if(source!=='frame' && source!=='shared') throw Error('Pane source must be frame or shared');
}
function identifyOwner(window:string,pane:string,id:string) {
  tmux(['set-option','-w','-t',window,'@philby_frame',id,';',
    'set-option','-w','-t',window,'@philby_agent',pane]);
}
function ownerWindow(id:string) {
  const rows=paneList('#{session_name}\t#{window_id}\t#{window_name}\t#{pane_id}\t#{pane_title}\t#{@philby_frame}\t#{@philby_agent}\t#{@philby_pane}\t#{pane_start_command}').split('\n').map(line=>line.split('\t'));
  const found=rows.filter(([session,,name,pane,title,frame,agent,child,command])=>session==='philby' && !child && (
    (frame===id && agent===pane) || (!frame && name===id && title===id && command.includes(launcher) && command.includes(quote('serve')))
  ));
  if(found.length>1) throw Error(`Multiple agent windows for ${id}`);
  const row=found[0];
  if(row && !row[5]) identifyOwner(row[1],row[3],id);
  return row?.[1];
}
function paneLog(id:string,name:string) {
  return join(paths(id).tools,'panes',paneName(name),'out.log');
}
export function listFramePanes(id:string) {
  validateFrameId(id);
  const format='#{session_name}\t#{@philby_frame}\t#{window_id}\t#{pane_id}\t#{@philby_view}\t#{@philby_pane}\t#{@philby_target}\t#{@philby_source}';
  return paneList(format).split('\n').flatMap(line=>{
    const [session,owner,window,pane,view,name,target,source]=line.split('\t');
    return session==='philby' && owner===id && pane===view && name ? [{name,window,pane,target,source,log:paneLog(id,name)}] : [];
  });
}
export function startPane(id:string,name:string,target:string,source:PaneSource='frame') {
  validateFrameId(id);
  paneRecipe(name,target,source);
  const owner=ownerWindow(id);
  if(!owner) throw Error(`Frame ${id} has no agent window`);
  const views=listFramePanes(id);
  const existing=views.find(view=>view.name===name);
  const log=paneLog(id,name);
  if(existing) {
    if(existing.target!==target || existing.source!==source) throw Error(`Pane ${name} already uses a different Make target`);
    return {name,pane:existing.pane,log,started:false};
  }
  for(const directory of [dirname(dirname(log)),dirname(log)]) {
    mkdirSync(directory,{recursive:true,mode:0o700});
    if(!lstatSync(directory).isDirectory()) throw Error(`Pane directory must be a directory: ${directory}`);
  }
  const fd=openSync(log,constants.O_APPEND|constants.O_CREAT|constants.O_WRONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile() || stat.nlink!==1) throw Error(`Pane log must be a regular file with a single link: ${log}`);
    fchmodSync(fd,0o600);
  } finally {closeSync(fd);}
  const anchor=views.at(-1)?.window ?? owner;
  const channel=`philby-pane-${randomUUID()}`;
  const pane=tmux(['new-window','-adP','-F','#{pane_id}','-t',anchor,'-n',name,'-c',paths(id).tools,launch('pane-run',id,name,target,source,channel)]).stdout.trim();
  try {
    tmux(['set-option','-w','-t',pane,'@philby_frame',id,';',
      'set-option','-w','-t',pane,'@philby_pane',name,';',
      'set-option','-w','-t',pane,'@philby_target',target,';',
      'set-option','-w','-t',pane,'@philby_source',source,';',
      'set-option','-w','-t',pane,'@philby_view',pane,';',
      'select-pane','-t',pane,'-T',name,';',
      'pipe-pane','-O','-t',pane,`exec cat >> #{q:pane_start_path}/panes/${name}/out.log`,';',
      'wait-for','-S',channel,';','wait-for',channel+'-ready'],false,3000);
    const error=tmux(['show-options','-pqv','-t',pane,'@philby_launch_error']).stdout.trim();
    if(error) throw Error(error);
  } catch(error) {
    tmux(['kill-window','-t',pane],true);
    throw Error(`Could not start pane ${name}: ${error instanceof Error?error.message:error}. See ${log}`);
  }
  return {name,pane,log,started:true};
}
export function stopPane(id:string,name:string) {
  paneName(name);
  const view=listFramePanes(id).find(view=>view.name===name);
  if(!view) throw Error(`Frame ${id} has no pane named ${name}`);
  removePane(view.pane);
}
function removePane(pane:string) {
  const result=tmux(['kill-pane','-t',pane],true);
  if(result.status!==0 && paneList('#{pane_id}').split('\n').includes(pane)) throw Error(result.stderr);
}
export function closeFramePanes(id:string) {
  for(const view of listFramePanes(id)) removePane(view.pane);
}
export async function closeView(id:string,pane:string,kind:'frame'|'pane') {
  validateFrameId(id);
  if(!/^%\d+$/.test(pane)) throw Error('Expected a tmux pane ID');
  const mutex=openingLock();
  let closing:Promise<unknown>|undefined;
  try {
    const row=paneList('#{session_name}\t#{pane_id}\t#{@philby_frame}\t#{@philby_agent}\t#{@philby_view}\t#{pane_dead}')
      .split('\n').map(line=>line.split('\t')).find(([session,target,owner])=>session==='philby' && target===pane && owner===id);
    if(!row) return;
    const [,,,agent,view,dead]=row;
    if(kind==='frame' ? agent!==pane : view!==pane) throw Error('Selected terminal ownership changed');
    if(kind==='frame' && dead==='0' && await running(id)) {
      closing=request(id,{op:'close',pane});
    } else {
      if(kind==='frame') closeFramePanes(id);
      removePane(pane);
    }
  } finally {mutex.close();}
  if(closing) {
    await closing;
    removePane(pane);
  }
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
    installControls();
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
  rmSync(launchDirectory(),{recursive:true,force:true});
  environmentFiles.clear();
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root=resolve('.');
const fixture=`import {createServer} from 'node:net';
import {writeFileSync,rmSync} from 'node:fs';
const [path,marker,mode,literal]=process.argv.slice(2);
const server=createServer(socket=>{
  let input='';
  socket.on('data',chunk=>{
    input+=chunk;
    if(!input.includes('\\n')) return;
    if(JSON.parse(input.split('\\n')[0]).op!=='disconnect') throw Error('Unexpected operation');
    if(mode==='reject') {socket.end(JSON.stringify({error:'Fixture refuses disconnect'})+'\\n');return;}
    writeFileSync(marker,JSON.stringify({disconnected:true,literal,pid:process.pid}));
    socket.end(JSON.stringify({value:{disconnected:true}})+'\\n');
    server.close(()=>{rmSync(path,{force:true});process.exit(0);});
  });
});
rmSync(path,{force:true});
server.listen(path,()=>{
  writeFileSync(1,'Browser fixture ready\\n');
  writeFileSync(marker,JSON.stringify({pid:process.pid,literal}));
  if(mode==='block') while(true) {}
});`;

function workspace(framesRoot?:string) {
  const directory=mkdtempSync(join(tmpdir(),'philby-browser-tmux-'));
  const server=`philby-browser-test-${process.pid}-${directory.split('-').at(-1)}`;
  const env={...process.env,PHILBY_FRAMES_DIR:framesRoot || join(directory,'frames'),PHILBY_TMUX_SOCKET:server,PHILBY_DETACHED:'1'};
  const file=join(directory,'service.mjs');writeFileSync(file,fixture);
  const run=(program:string,args:string[])=>new Promise<string>((resolve,reject)=>{
    const child=spawn(program,args,{env,cwd:root,stdio:['ignore','pipe','pipe']});let out='',err='';
    child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
    child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error(`${program} exited ${code}: ${out}${err}`)));
  });
  const adapter=(source:string)=>run(process.execPath,['--input-type=module','-e',`const m=await import('./dist/tmux/index.js');${source}`]);
  const tmux=(...args:string[])=>run('tmux',['-L',server,...args]);
  const cleanup=()=>run('make',['--no-print-directory','cleanup']);
  return {directory,env,file,adapter,tmux,cleanup,dispose:()=>{spawnSync('tmux',['-L',server,'kill-server']);rmSync(directory,{recursive:true,force:true});}};
}

async function until(check:()=>Promise<boolean>) {
  for(let i=0;i<100;i++) {if(await check()) return;await new Promise(resolve=>setTimeout(resolve,50));}
  throw Error('Timed out');
}

test('browser windows share one raw process, retain failures and disconnect during workspace cleanup',async()=>{
  const w=workspace();
  try {
    const socket=(await w.adapter("process.stdout.write(m.browserSocket('chrome'))")).trim();
    const marker=join(w.directory,'result.json');
    const literal="spaces 'quotes' $HOME `literal` $(literal)";
    const command=(mode:string)=>[process.execPath,w.file,socket,marker,mode,literal];
    const open=(mode:string)=>w.adapter(`console.log(JSON.stringify(m.openBrowser('chrome',${JSON.stringify(command(mode))},${JSON.stringify(w.directory)})))`).then(JSON.parse);
    const opened=await Promise.all([open('block'),open('block')]);
    assert.equal(opened[0].pane,opened[1].pane);
    assert.equal(opened.filter(view=>view.started).length,1);
    await until(async()=>existsSync(marker));
    const views=JSON.parse(await w.adapter('console.log(JSON.stringify(m.browserViews()))'));
    assert.equal(views.length,1);assert.equal(views[0].name,'chrome');assert.equal(views[0].dead,false);
    assert.deepEqual(JSON.parse(readFileSync(marker,'utf8')),{pid:views[0].pid,literal});
    assert.equal(existsSync(w.env.PHILBY_FRAMES_DIR),false);
    assert.match(await w.adapter('process.stdout.write(m.listViews())'),/@browser-chrome/);
    const ordinary=(await w.tmux('new-window','-d','-P','-F','#{pane_id}','-t','philby:','-n','shell','sleep','60')).trim();
    await assert.rejects(w.adapter(`m.closeBrowserPane('chrome',${JSON.stringify(ordinary)},${views[0].pid})`),/not an owned chrome/);
    await assert.rejects(w.adapter(`m.terminateBrowser('chrome',${JSON.stringify(views[0].pane)},${views[0].pid+1})`),/not the expected chrome/);
    await w.adapter(`m.terminateBrowser('chrome',${JSON.stringify(views[0].pane)},${views[0].pid})`);
    await until(async()=>JSON.parse(await w.adapter('console.log(JSON.stringify(m.browserViews()))'))[0]?.dead===true);
    assert.match(await w.tmux('capture-pane','-p','-t',views[0].pane),/Pane is dead \(signal (?:kill|9)\b/);
    assert.throws(()=>process.kill(views[0].pid,0),{code:'ESRCH'});
    const reopened=await open('ok');
    assert.deepEqual(reopened,{pane:views[0].pane,started:true});
    await until(async()=>JSON.parse(readFileSync(marker,'utf8')).pid!==views[0].pid);
    await assert.rejects(w.adapter(`m.closeBrowserPane('chrome',${JSON.stringify(reopened.pane)},${views[0].pid})`),/not the expected chrome/);
    await w.cleanup();
    assert.equal(JSON.parse(readFileSync(marker,'utf8')).disconnected,true);
    assert.deepEqual(JSON.parse(await w.adapter('console.log(JSON.stringify(m.browserViews()))')),[]);
    assert.equal(existsSync(w.env.PHILBY_FRAMES_DIR),false);
  } finally {w.dispose();}
});

test('workspace cleanup stops both browsers when the first disconnect fails and retains its failure window',async()=>{
  const w=workspace();
  try {
    const sockets=JSON.parse(await w.adapter("console.log(JSON.stringify(['chrome','firefox'].map(name=>m.browserSocket(name))))"));
    const marker=join(w.directory,'chrome.json');
    const other=join(w.directory,'firefox.json');
    const command=[process.execPath,w.file,sockets[0],marker,'reject',''];
    const firefox=[process.execPath,w.file,sockets[1],other,'ok',''];
    const {pane}=JSON.parse(await w.adapter(`console.log(JSON.stringify(m.openBrowser('chrome',${JSON.stringify(command)},${JSON.stringify(w.directory)})))`));
    await w.adapter(`m.openBrowser('firefox',${JSON.stringify(firefox)},${JSON.stringify(w.directory)})`);
    await until(async()=>existsSync(marker) && existsSync(other));
    await assert.rejects(w.cleanup(),/Fixture refuses disconnect/);
    await until(async()=>{
      const views=JSON.parse(await w.adapter('console.log(JSON.stringify(m.browserViews()))'));
      return views.length===1 && views[0].dead===true;
    });
    assert.equal(JSON.parse(readFileSync(other,'utf8')).disconnected,true);
    const views=JSON.parse(await w.adapter('console.log(JSON.stringify(m.browserViews()))'));
    assert.equal(views.length,1);assert.equal(views[0].name,'chrome');assert.equal(views[0].dead,true);
    assert.throws(()=>process.kill(views[0].pid,0),{code:'ESRCH'});
    await w.adapter(`m.closeBrowserPane('chrome',${JSON.stringify(pane)},${views[0].pid})`);
    assert.deepEqual(JSON.parse(await w.adapter('console.log(JSON.stringify(m.browserViews()))')),[]);
    await w.adapter(`m.closeBrowserPane('chrome',${JSON.stringify(pane)},${views[0].pid})`);
  } finally {w.dispose();}
});

test('workspace cleanup interrupts a blocked browser owner after its disconnect deadline',async()=>{
  const w=workspace();
  try {
    const socket=(await w.adapter("process.stdout.write(m.browserSocket('chrome'))")).trim();
    const marker=join(w.directory,'result.json');
    const command=[process.execPath,w.file,socket,marker,'block',''];
    await w.adapter(`m.openBrowser('chrome',${JSON.stringify(command)},${JSON.stringify(w.directory)})`);
    await until(async()=>existsSync(marker));
    await assert.rejects(w.cleanup(),/unfinished work may have been interrupted[\s\S]*Timed out disconnecting chrome/);
    await until(async()=>JSON.parse(await w.adapter('console.log(JSON.stringify(m.browserViews()))'))[0]?.dead===true);
    const {pid}=JSON.parse(readFileSync(marker,'utf8'));
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  } finally {w.dispose();}
});

test('browser cleanup stays within its tmux server when servers share a frame directory',async()=>{
  const first=workspace();
  const second=workspace(first.env.PHILBY_FRAMES_DIR);
  try {
    const markers=[join(first.directory,'result.json'),join(second.directory,'result.json')];
    for(const [index,w] of [first,second].entries()) {
      const socket=(await w.adapter("process.stdout.write(m.browserSocket('chrome'))")).trim();
      const command=[process.execPath,w.file,socket,markers[index],'ok',''];
      await w.adapter(`m.openBrowser('chrome',${JSON.stringify(command)},${JSON.stringify(w.directory)})`);
    }
    await until(async()=>markers.every(marker=>existsSync(marker)));
    await second.cleanup();
    assert.equal(JSON.parse(readFileSync(markers[1],'utf8')).disconnected,true);
    assert.equal(JSON.parse(readFileSync(markers[0],'utf8')).disconnected,undefined);
    const remaining=JSON.parse(await first.adapter('console.log(JSON.stringify(m.browserViews()))'));
    assert.equal(remaining.length,1);assert.equal(remaining[0].dead,false);
    await first.cleanup();
    assert.equal(JSON.parse(readFileSync(markers[0],'utf8')).disconnected,true);
  } finally {second.dispose();first.dispose();}
});

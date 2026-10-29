import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withTmuxPassthrough } from '../kitty-route.js';

function terminalCommand(command:string[]):[string,string[]] {
  if(process.platform==='darwin') return ['/bin/sh',['-c','cat | exec script -qF /dev/null "$@"','philby-route-test',...command]];
  if(process.platform==='linux') return ['script',['-qfec',command.map(arg=>`'${arg.replaceAll("'","'\\''")}'`).join(' '),'/dev/null']];
  throw Error(`Terminal tests do not support ${process.platform}`);
}

async function until(check:()=>boolean) {
  for(let i=0;i<100;i++) {
    if(check()) return;
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  throw Error('Timed out waiting for isolated tmux client');
}

function workspace() {
  const directory=mkdtempSync(join(tmpdir(),'pb-route-'));
  const outer=join(directory,'outer'),inner=join(directory,'inner');
  const terminals:ReturnType<typeof spawn>[]=[];
  const env={...process.env,TMUX:'',TMUX_PANE:'',TERM:'xterm-256color'};
  const tmux=(socket:string,...args:string[])=>{
    const result=spawnSync('tmux',['-S',socket,'-f','/dev/null',...args],{env,encoding:'utf8'});
    if(result.error) throw result.error;
    assert.equal(result.status,0,result.stderr);
    return result.stdout.trim();
  };
  const create=(socket:string)=>tmux(socket,'new-session','-d','-P','-F','#{pane_id}','-s','route','sleep','60');
  const clients=(socket:string)=>tmux(socket,'list-clients','-F','#{client_tty}').split('\n').filter(Boolean);
  const attach=async(socket:string)=>{
    const before=clients(socket).length;
    terminals.push(spawn(...terminalCommand(['tmux','-S',socket,'attach-session','-t','route']),{env,stdio:['pipe','ignore','ignore']}));
    await until(()=>clients(socket).length===before+1);
  };
  return {outer,inner,tmux,create,clients,attach,
    env:(socket:string,pane:string)=>({...env,TMUX:`${socket},0,0`,TMUX_PANE:pane}),
    option:(socket:string,pane:string)=>tmux(socket,'show-options','-p','-t',pane,'allow-passthrough'),
    close:()=>{
      for(const socket of [inner,outer]) spawnSync('tmux',['-S',socket,'kill-server'],{env,stdio:'ignore'});
      for(const terminal of terminals) {terminal.stdin?.end();terminal.kill();}
      rmSync(directory,{recursive:true,force:true});
    }
  };
}

test('Kitty passthrough runs directly without tmux',async()=>{
  assert.equal(await withTmuxPassthrough(async depth=>{assert.equal(depth,0);return 'direct';},{}),'direct');
});

test('Kitty passthrough restores inherited and explicit pane options after success and failure',async()=>{
  const w=workspace();
  try {
    const pane=w.create(w.outer);
    await w.attach(w.outer);
    assert.equal(w.option(w.outer,pane),'');
    assert.equal(await withTmuxPassthrough(async depth=>{
      assert.equal(depth,1);
      assert.equal(w.option(w.outer,pane),'allow-passthrough on');
      return 'installed';
    },w.env(w.outer,pane)),'installed');
    assert.equal(w.option(w.outer,pane),'');
    w.tmux(w.outer,'set-option','-p','-t',pane,'allow-passthrough','all');
    await assert.rejects(withTmuxPassthrough(async depth=>{
      assert.equal(depth,1);
      assert.equal(w.option(w.outer,pane),'allow-passthrough on');
      throw Error('Remote command denied');
    },w.env(w.outer,pane)),/Remote command denied/);
    assert.equal(w.option(w.outer,pane),'allow-passthrough all');
  } finally {w.close();}
});

test('Kitty passthrough discovers two attached tmux layers and restores both on failure',async()=>{
  const w=workspace();
  try {
    const outerPane=w.create(w.outer),innerPane=w.create(w.inner);
    await w.attach(w.outer);
    w.tmux(w.outer,'respawn-pane','-k','-t',outerPane,'env','-u','TMUX','tmux','-S',w.inner,'attach-session','-t','route');
    await until(()=>w.clients(w.inner).length===1);
    w.tmux(w.inner,'set-option','-p','-t',innerPane,'allow-passthrough','off');
    await assert.rejects(withTmuxPassthrough(async depth=>{
      assert.equal(depth,2);
      assert.equal(w.option(w.outer,outerPane),'allow-passthrough on');
      assert.equal(w.option(w.inner,innerPane),'allow-passthrough on');
      throw Error('Kitty timed out');
    },w.env(w.inner,innerPane)),/Kitty timed out/);
    assert.equal(w.option(w.outer,outerPane),'');
    assert.equal(w.option(w.inner,innerPane),'allow-passthrough off');
  } finally {w.close();}
});

test('Kitty passthrough rejects an ambiguous attached client before changing options',async()=>{
  const w=workspace();
  try {
    const pane=w.create(w.outer);
    await w.attach(w.outer);
    await w.attach(w.outer);
    let called=false;
    await assert.rejects(withTmuxPassthrough(async()=>{called=true;},w.env(w.outer,pane)),/one|unique|multiple|ambiguous/i);
    assert.equal(called,false);
    assert.equal(w.option(w.outer,pane),'');
  } finally {w.close();}
});

test('Kitty passthrough rejects a window linked into another session before changing options',async()=>{
  const w=workspace();
  try {
    const pane=w.create(w.outer);
    await w.attach(w.outer);
    const window=w.tmux(w.outer,'display-message','-p','-t',pane,'#{window_id}');
    w.tmux(w.outer,'new-session','-d','-s','second','sleep','60');
    w.tmux(w.outer,'link-window','-s',window,'-t','second:');
    let called=false;
    await assert.rejects(withTmuxPassthrough(async()=>{called=true;},w.env(w.outer,pane)),/linked|multiple/i);
    assert.equal(called,false);
    assert.equal(w.option(w.outer,pane),'');
  } finally {w.close();}
});

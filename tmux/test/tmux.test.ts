import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'philby-tmux-'));
const socket=`philby-test-${process.pid}`;
const root=resolve('.');
const env={...process.env,PHILBY_PANES_DIR:join(directory,'panes'),PHILBY_TMUX_SOCKET:socket,PHILBY_TEST_PROVIDER:'1',PHILBY_DETACHED:'1'};
function run(program:string,args:string[],input?:string):Promise<string> {
  return new Promise((resolve,reject)=>{const p=spawn(program,args,{env,cwd:root,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('error',reject);p.on('exit',code=>code===0?resolve(out):reject(Error(`${program} ${args.join(' ')}: ${code}\n${out}\n${err}`)));p.stdin.end(input);});
}
const make=(...args:string[])=>run('make',['--no-print-directory',...args]);
const tmux=(...args:string[])=>run('tmux',['-L',socket,...args]);
function terminalCommand(command:string[]):[string,string[]] {
  if(process.platform==='darwin') return ['/bin/sh',['-c','cat | exec script -qF /dev/null "$@"','philby-test',...command]];
  if(process.platform==='linux') return ['script',['-qfec',command.map(arg=>`'${arg.replaceAll("'","'\\''")}'`).join(' '),'/dev/null']];
  throw Error(`Terminal tests do not support ${process.platform}`);
}
async function until(fn:()=>Promise<boolean>) {for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out');}
async function selector(title='Open a pane') {
  await until(async()=> (await tmux('capture-pane','-p','-t','philby:')).includes(title));
  return (await tmux('display-message','-p','-t','philby:','#{pane_id}')).trim();
}
test('terminal wrapper preserves literal arguments, supplies a TTY and propagates failure',async()=>{
  const literal="spaces 'quotes' $HOME `literal` $(literal)";
  const output=await run(...terminalCommand([process.execPath,'-e',"if(!process.stdin.isTTY) process.exit(2); process.stdout.write(process.argv[1])",literal]));
  assert.ok(output.endsWith(literal),JSON.stringify(output));
  await assert.rejects(run(...terminalCommand([process.execPath,'-e','process.exit(17)'])),/: 17\n/);
});
test('bare Make starts one selector without creating a pane and creates the first named pane on request',async()=>{
  const paneNames=()=>existsSync(env.PHILBY_PANES_DIR)?readdirSync(env.PHILBY_PANES_DIR):[];
  try {
    await make();
    const creating=await selector('Choose a pane type');
    assert.deepEqual(paneNames(),[]);
    assert.doesNotMatch(await make('pane-list'),/^\S+\t(?:running|saved)$/m);
    await Promise.all([make(),make('pane-new')]);
    assert.equal((await tmux('list-windows','-t','philby','-F','#{window_name}')).trim(),'+');
    assert.equal((await tmux('display-message','-p','-t','philby:','#{pane_id}')).trim(),creating);
    await tmux('send-keys','-t',creating,'Escape');
    await until(async()=> !/^tmux\t/m.test(await make('pane-list')));
    assert.deepEqual(paneNames(),[]);
    await make();
    const naming=await selector('Choose a pane type');
    await tmux('send-keys','-t',naming,'Enter');
    await until(async()=> (await tmux('capture-pane','-p','-t',naming)).includes('Name this pane'));
    await tmux('send-keys','-t',naming,'alpha','Enter');
    await until(async()=> (await make('pane-list')).includes('alpha\trunning'));
    assert.deepEqual(paneNames(),['alpha']);
    assert.equal(existsSync(join(env.PHILBY_PANES_DIR,'alpha','.state','durable.sqlite')),true);
    assert.equal((await tmux('list-windows','-t','philby','-F','#{window_name}')).trim(),'alpha');
  } finally {await make('cleanup').catch(()=>{});spawnSync('tmux',['-L',socket,'kill-server']);rmSync(directory,{recursive:true,force:true});}
});
test('pane selection, tmux inventory, terminal input, multiline sends, independent close, crash and confirmed quit',async()=>{
  let terminal:ReturnType<typeof spawn>|undefined;
  try {
    await make('pane','slug=alpha');
    assert.match(await make('pane-list'),/alpha\s+running/);
    await Promise.all([make('pane','slug=alpha'),make('pane','slug=alpha')]);
    assert.equal((await tmux('list-windows','-t','philby','-F','#{window_name}')).trim(),'alpha');
    assert.equal((await tmux('display-message','-p','-t','philby:alpha','#{pane_title}')).trim(),'alpha');
    const workerTools=join(directory,'panes','worker');mkdirSync(workerTools,{recursive:true});
    writeFileSync(join(workerTools,'BOOT.md'),'Verify the configured workspace.');
    writeFileSync(join(workerTools,'Makefile'),'close:\n\t@echo closed >> closed\n');
    terminal=spawn(...terminalCommand(['tmux','-L',socket,'attach-session','-t','philby']),{env:{...env,TMUX:'',TERM:'xterm-256color'},stdio:['pipe','ignore','inherit']});
    await until(async()=> (await tmux('list-clients','-F','#{client_name}')).trim()!=='');
    terminal.stdin!.write('\x1b[1;5F');
    const naming=await selector();
    const choices=await tmux('capture-pane','-p','-t',naming);
    assert.match(choices,/New pane/);assert.match(choices,/alpha/);assert.match(choices,/Open — switch to pane/);
    await tmux('send-keys','-t',naming,'Enter');
    await until(async()=> (await tmux('capture-pane','-p','-t',naming)).includes('Choose a pane type'));
    await tmux('send-keys','-t',naming,'Enter');
    await until(async()=> (await tmux('capture-pane','-p','-t',naming)).includes('Name this pane'));
    await tmux('send-keys','-t',naming,'Bad Slug','Enter');
    await until(async()=> (await tmux('capture-pane','-p','-t',naming)).includes('Slug must be'));
    await tmux('send-keys','-t',naming,'C-u','worker','Enter');
    await until(async()=> (await tmux('list-windows','-t','philby','-F','#{window_name}')).trim()==='alpha\nworker');
    assert.match(await make('pane-list'),/worker\trunning/);
    const worker=(await tmux('display-message','-p','-t','philby:worker','#{pane_id}')).trim();
    await until(async()=> (await make('pane-capture','slug=worker')).includes('Received: Opening checklist'));
    const watcher=(await tmux('split-window','-P','-F','#{pane_id}','-t',worker,'sleep','60')).trim();
    await tmux('select-pane','-t',watcher,'-T','watcher');
    await make('pane','slug=worker');
    assert.equal((await tmux('display-message','-p','-t','philby:worker','#{pane_id}')).trim(),worker);
    assert.equal(JSON.parse(await make('pane-capture','slug=worker')).filter((e:any)=>e.kind==='philby.startup').length,1);
    await tmux('kill-pane','-t',watcher);
    await tmux('select-window','-t','philby:alpha');
    terminal.stdin!.write('\x1b[1;5F');
    await until(async()=> (await tmux('display-message','-p','-t','philby:','#{window_name}')).trim()==='worker');
    assert.equal((await tmux('list-windows','-t','philby','-F','#{window_name}')).trim(),'alpha\nworker');
    await make('pane-new');
    const existing=await selector();
    assert.match(await tmux('capture-pane','-p','-t',existing),/alpha[\s\S]*worker/);
    await tmux('send-keys','-t',existing,'Down','Down','Enter');
    await until(async()=> (await tmux('list-windows','-t','philby','-F','#{window_name}')).trim()==='alpha\nworker');
    assert.equal((await tmux('display-message','-p','-t','philby:','#{pane_id}')).trim(),worker);
    for(const key of ['Escape','C-c','C-d']) {
      await make('pane-new');
      await tmux('send-keys','-t',await selector(),key);
      await until(async()=> (await tmux('list-windows','-t','philby','-F','#{window_name}')).trim()==='alpha\nworker');
    }
    for(const key of ['Escape','C-c','C-d']) {
      await make('pane-new');
      const creating=await selector();
      await tmux('send-keys','-t',creating,'Enter');
      await until(async()=> (await tmux('capture-pane','-p','-t',creating)).includes('Choose a pane type'));
      await tmux('send-keys','-t',creating,key);
      if(key==='Escape') await tmux('send-keys','-t',await selector(),'Escape');
      await until(async()=> (await tmux('list-windows','-t','philby','-F','#{window_name}')).trim()==='alpha\nworker');
    }
    for(const key of ['Escape','C-c','C-d']) {
      await make('pane-new');
      const creating=await selector();
      await tmux('send-keys','-t',creating,'Enter');
      await until(async()=> (await tmux('capture-pane','-p','-t',creating)).includes('Choose a pane type'));
      await tmux('send-keys','-t',creating,'Enter');
      await until(async()=> (await tmux('capture-pane','-p','-t',creating)).includes('Name this pane'));
      await tmux('send-keys','-t',creating,key);
      if(key==='Escape') {
        await until(async()=> (await tmux('capture-pane','-p','-t',creating)).includes('Choose a pane type'));
        await tmux('send-keys','-t',creating,'Escape');
        await tmux('send-keys','-t',await selector(),'Escape');
      }
      await until(async()=> (await tmux('list-windows','-t','philby','-F','#{window_name}')).trim()==='alpha\nworker');
    }
    const shell=(await tmux('new-window','-d','-P','-F','#{pane_id}','-t','philby:','-n','fish','sleep','60')).trim();
    const split=(await tmux('split-window','-d','-P','-F','#{pane_id}','-t',shell,'sleep','60')).trim();
    const inventory=await make('pane-list');
    for(const id of [shell,split]) assert.match(inventory,new RegExp(`^tmux\\tphilby:\\d+\\.\\d+\\t${id}\\tfish\\tsleep$`,'m'));
    assert.doesNotMatch(inventory,/^fish\t(?:running|saved)$/m);
    await tmux('kill-window','-t',shell);
    await tmux('send-keys','-t','philby:alpha','hello terminal','Enter');
    await until(async()=> (await make('pane-capture','slug=alpha')).includes('Received: hello terminal'));
    const prompt="line one\nline two 'quoted' $HOME `literal`\n";
    const file=join(directory,'prompt');writeFileSync(file,prompt);
    await make('pane-send','slug=alpha','from=alpha',`PROMPT_FILE=${file}`,'REQUEST_ID=multiline');
    await until(async()=> (await make('pane-capture','slug=alpha')).includes('line two'));
    await make('pane-send','slug=alpha','from=alpha',`PROMPT_FILE=${file}`,'REQUEST_ID=multiline');
    const entries=JSON.parse(await make('pane-capture','slug=alpha'));
    assert.equal(entries.filter((e:any)=>e.kind==='pi.user' && JSON.stringify(e).includes('line two')).length,1);
    await Promise.all([make('pane','slug=worker'),make('pane','slug=worker')]);
    await make('pane-memory','slug=alpha','FIELD=notes','prompt=Remember after closing');
    const savedMemory=JSON.parse(await make('pane-memory','slug=alpha'));
    await make('pane-close','slug=alpha');
    await until(async()=> (await make('pane-list')).includes('alpha\tsaved'));
    assert.match(await make('pane-list'),/worker\s+running/);
    await run('make',['--no-print-directory','pane-send','slug=alpha','from=worker','REQUEST_ID=closed'],'while closed\nsecond line');
    await make('pane-new');
    const reopening=await selector();
    assert.match(await tmux('capture-pane','-p','-t',reopening),/alpha[\s\S]*Closed — resume conversation[\s\S]*worker[\s\S]*Open — switch to pane/);
    await tmux('send-keys','-t',reopening,'Down','Enter');
    await until(async()=> (await make('pane-list')).includes('alpha\trunning'));
    await until(async()=> (await make('pane-capture','slug=alpha')).includes('while closed'));
    assert.match(await make('pane-capture','slug=alpha'),/Received: hello terminal/);
    assert.deepEqual(JSON.parse(await make('pane-memory','slug=alpha')),savedMemory);
    await make('pane-send','from=alpha','slug=worker','REQUEST_ID=crash-dedupe','prompt=one delivery');
    await until(async()=> (await make('pane-capture','slug=worker')).includes('one delivery'));
    const status=JSON.parse(await run('node',['dist/src/cli.js','status','worker']));
    process.kill(status.pid,'SIGKILL');
    await new Promise(r=>setTimeout(r,300));
    await make('pane','slug=worker');
    await make('pane-send','from=alpha','slug=worker','REQUEST_ID=crash-dedupe','prompt=one delivery');
    const recovered=JSON.parse(await make('pane-capture','slug=worker'));
    assert.equal(recovered.filter((e:any)=>e.kind==='pi.user' && JSON.stringify(e).includes('one delivery')).length,1);
    await until(async()=> (await make('pane-capture','slug=worker')).includes('Received: [From alpha]'));
    await until(async()=> JSON.parse(await run('node',['dist/src/cli.js','status','worker'])).work.tasks.length===0);
    await make('pane-memory','slug=worker','FIELD=notes','prompt=Remember after quitting');
    await tmux('send-keys','-t','philby:worker','/memory notes','Enter');
    await until(async()=> (await tmux('capture-pane','-p','-t','philby:worker')).includes('Editing notes'));
    await tmux('send-keys','-t','philby:worker','Enter');
    await until(async()=> (await tmux('capture-pane','-p','-t','philby:worker')).includes('Memory saved.'));
    const conversation=JSON.parse(await make('pane-capture','slug=worker'));
    const memory=JSON.parse(await make('pane-memory','slug=worker'));
    const tools=readFileSync(join(directory,'panes','worker','Makefile'),'utf8');
    for(const key of ['n','Escape','C-c','C-d']) {
      await tmux('send-keys','-t','philby:worker','/quit','Enter');
      await until(async()=> (await tmux('capture-pane','-p','-t','philby:worker')).includes('Quit all Philby panes? [y/n]'));
      if(key==='n') await tmux('send-keys','-t','philby:worker','not an answer','Enter');
      await tmux('send-keys','-t','philby:worker',key,...(key==='n'?['Enter']:[]));
      await until(async()=> (await tmux('capture-pane','-p','-t','philby:worker')).includes('Quit cancelled.'));
      const active=await make('pane-list');
      assert.match(active,/alpha\s+running/);assert.match(active,/worker\s+running/);
      assert.deepEqual(JSON.parse(await make('pane-capture','slug=worker')),conversation);
    }
    await tmux('new-window','-d','-t','philby:','-n','shell','sleep','60');
    await tmux('send-keys','-t','philby:worker','/quit','Enter');
    await until(async()=> (await tmux('capture-pane','-p','-t','philby:worker')).includes('Quit all Philby panes? [y/n]'));
    await tmux('send-keys','-t','philby:worker',' Y ','Enter');
    await until(async()=> !/^tmux\t/m.test(await make('pane-list')));
    assert.equal(readFileSync(join(workerTools,'closed'),'utf8'),'closed\n');
    assert.match(await make('pane-list'),/alpha\s+saved/);
    assert.match(await make('pane-list'),/worker\s+saved/);
    await make('pane','slug=worker');
    await make('pane','slug=alpha');
    await until(async()=> JSON.parse(await make('pane-capture','slug=worker')).filter((e:any)=>e.kind==='philby.startup').length===3);
    await until(async()=> JSON.parse(await run('node',['dist/src/cli.js','status','worker'])).work.tasks.length===0);
    const resumed=JSON.parse(await make('pane-capture','slug=worker'));
    assert.deepEqual(resumed.slice(0,conversation.length),conversation);
    assert.equal(resumed.filter((e:any)=>e.kind==='philby.startup').length,3);
    assert.deepEqual(JSON.parse(await make('pane-memory','slug=worker')),memory);
    assert.equal(readFileSync(join(directory,'panes','worker','Makefile'),'utf8'),tools);
    assert.match(await run('make',['--no-print-directory','quit'],'n\n'),/Quit all Philby panes\? \[y\/n\]/);
    assert.match(await make('pane-list'),/alpha\s+running/);
    assert.match(await make('pane-list'),/worker\s+running/);
    await run('make',['--no-print-directory','quit'],'y\n');
    assert.match(await make('pane-list'),/alpha\s+saved/);
    assert.match(await make('pane-list'),/worker\s+saved/);
    assert.doesNotMatch(await make('pane-list'),/^tmux\t/m);
  } finally {await make('cleanup').catch(()=>{});spawnSync('tmux',['-L',socket,'kill-server']);terminal?.stdin?.end();terminal?.kill();rmSync(directory,{recursive:true,force:true});}
});

test('typed creation through selector preserves queued work and concurrent reopening',async()=>{
  try {
    await make('pane','slug=alpha','TYPE=graphwiki');
    for(const key of ['TYPE','MAKEFLAGS','MAKEOVERRIDES','MFLAGS','MAKELEVEL']) await assert.rejects(tmux('show-environment','-g',key),/unknown variable/);
    await make('pane-send','from=alpha','slug=knowledge','REQUEST_ID=before-type','prompt=Queued before choosing a type');
    await assert.rejects(make('pane-capture','slug=knowledge'),/No saved conversation/);
    assert.doesNotMatch(await make('pane-list'),/^knowledge\t/m);
    await make('pane-new');
    const creating=await selector();
    await tmux('send-keys','-t',creating,'Enter');
    await until(async()=> (await tmux('capture-pane','-p','-t',creating)).includes('Choose a pane type'));
    await tmux('send-keys','-t',creating,'Down','Enter');
    await until(async()=> (await tmux('capture-pane','-p','-t',creating)).includes('Name this pane'));
    await tmux('send-keys','-t',creating,'knowledge','Enter');
    await until(async()=> (await make('pane-list')).includes('knowledge\trunning'));
    const tools=join(directory,'panes','knowledge');
    assert.equal(readFileSync(join(tools,'.pane-type'),'utf8'),'graphwiki\n');
    await until(async()=> (await make('pane-capture','slug=knowledge')).includes('Received: [From alpha]'));
    const before=JSON.parse(await make('pane-capture','slug=knowledge'));
    writeFileSync(join(tools,'SCOPE.md'),'Edited by the user');
    await make('pane-close','slug=knowledge');
    await Promise.all([make('pane','slug=knowledge','TYPE=graphwiki'),make('pane','slug=knowledge','TYPE=graphwiki')]);
    assert.equal((await tmux('list-windows','-t','philby','-F','#{window_name}')).trim(),'alpha\nknowledge');
    assert.equal(readFileSync(join(tools,'SCOPE.md'),'utf8'),'Edited by the user');
    assert.deepEqual(JSON.parse(await make('pane-capture','slug=knowledge')),before);
    await assert.rejects(make('pane','slug=knowledge','TYPE=plain'),/already exists with type graphwiki/);
    await assert.rejects(make('pane','slug=invalid','TYPE=unknown'),/Unknown pane type/);
  } finally {await make('cleanup').catch(()=>{});spawnSync('tmux',['-L',socket,'kill-server']);rmSync(directory,{recursive:true,force:true});}
});

test('model picker cancels locally, preserves conversation and persists the selected model',async()=>{
  const screen=()=>tmux('capture-pane','-p','-t','philby:alpha');
  const picker=async()=>{
    await tmux('send-keys','-t','philby:alpha','/model','Enter');
    await until(async()=> (await screen()).includes('Choose a model'));
  };
  try {
    await make('pane','slug=alpha');
    await until(async()=> /^alpha\s+test\s+ready/m.test(await screen()));
    await tmux('send-keys','-t','philby:alpha','before model selection','Enter');
    await until(async()=> (await make('pane-capture','slug=alpha')).includes('Received: before model selection'));
    const before=JSON.parse(await make('pane-capture','slug=alpha'));
    for(const key of ['Escape','C-c','C-d']) {
      await picker();
      assert.match(await screen(),/→ Test\s/);
      await tmux('send-keys','-t','philby:alpha','Down',key);
      await until(async()=> (await screen()).includes('Model selection cancelled.'));
      assert.match(await screen(),/^alpha\s+test\s+ready/m);
      assert.deepEqual(JSON.parse(await make('pane-capture','slug=alpha')),before);
    }
    await picker();
    await tmux('send-keys','-t','philby:alpha','Down','Enter');
    await until(async()=> /^alpha\s+test-alternate\s+ready/m.test(await screen()));
    assert.match(await screen(),/Model set to test-alternate/);
    assert.deepEqual(JSON.parse(await make('pane-capture','slug=alpha')),before);
    await make('pane-close','slug=alpha');
    await make('pane','slug=alpha');
    await until(async()=> /^alpha\s+test-alternate\s+ready/m.test(await screen()));
    await picker();
    assert.match(await screen(),/→ Test alternate/);
    await tmux('send-keys','-t','philby:alpha','Enter');
    await until(async()=> (await screen()).includes('Model set to test-alternate'));
    await tmux('send-keys','-t','philby:alpha','after model selection','Enter');
    await until(async()=> (await make('pane-capture','slug=alpha')).includes('Received: after model selection'));
    const after=JSON.parse(await make('pane-capture','slug=alpha'));
    assert.deepEqual(after.slice(0,before.length),before);
    assert.equal(after.filter((entry:any)=>entry.kind==='pi.user').length,2);
    assert.doesNotMatch(JSON.stringify(after.filter((entry:any)=>entry.kind==='pi.user')),/\/model/);
  } finally {await make('cleanup').catch(()=>{});spawnSync('tmux',['-L',socket,'kill-server']);rmSync(directory,{recursive:true,force:true});}
});

test('plan controls preserve literal text and update the terminal from both command interfaces',async()=>{
  const screen=()=>tmux('capture-pane','-p','-t','philby:planner');
  const status=async()=>JSON.parse(await make('pane-plan','slug=planner'));
  const command=(text:string)=>tmux('send-keys','-t','philby:planner','C-u',text,'Enter');
  const activeHeader=/^planner\s+test\s+ready\s+PLAN MODE\b/m;
  try {
    await make('pane','slug=planner');
    await until(async()=> /^planner\s+test\s+ready/m.test(await screen()));
    assert.deepEqual(await status(),{active:false,plan:''});
    await command('/plan on');
    await until(async()=> activeHeader.test(await screen()));
    await command('/plan invalid');
    await until(async()=> (await screen()).includes('Invalid /plan argument'));
    assert.deepEqual(await status(),{active:true,plan:''});
    await assert.rejects(make('pane-plan-set','slug=planner','ACTIVE=invalid'),/ACTIVE must be/);

    const approved="1. Preserve 'quotes', $HOME and `literal`.\n2. Keep $(not-a-command) as text.\n";
    const file=join(directory,'approved-plan');writeFileSync(file,approved);
    await make('pane-plan-set','slug=planner','ACTIVE=0','PLAN=',`PROMPT_FILE=${file}`);
    assert.deepEqual(await status(),{active:false,plan:approved});
    await until(async()=> !activeHeader.test(await screen()));
    await command('/plan on');
    await until(async()=> activeHeader.test(await screen()));
    await command('/plan off');
    await until(async()=> !activeHeader.test(await screen()));
    assert.deepEqual(await status(),{active:false,plan:approved});
    await command('/plan off   ');
    await until(async()=> (await screen()).includes('"active": false'));
    assert.deepEqual(await status(),{active:false,plan:approved});
    await make('pane-plan-set','slug=planner','ACTIVE=0','PLAN=');
    assert.deepEqual(await status(),{active:false,plan:approved});

    const stdinPlan='1. Plan from stdin\n2. Preserve $HOME literally\n';
    await run('make',['--no-print-directory','pane-plan-set','slug=planner','ACTIVE=0','PLAN='],stdinPlan);
    assert.deepEqual(await status(),{active:false,plan:stdinPlan});
    await run(...terminalCommand(['make','--no-print-directory','pane-plan-set','slug=planner','ACTIVE=0','PLAN=',`PROMPT_FILE=${file}`]));
    assert.deepEqual(await status(),{active:false,plan:approved});
    await make('pane-plan-set','slug=planner','ACTIVE=0',`PLAN=${approved}`);
    assert.deepEqual(await status(),{active:false,plan:approved});
    await make('pane-plan-set','slug=planner','ACTIVE=1');
    await until(async()=> activeHeader.test(await screen()));
    await make('pane-close','slug=planner');
    await make('pane','slug=planner');
    await until(async()=> activeHeader.test(await screen()));
    assert.deepEqual(await status(),{active:true,plan:approved});
  } finally {await make('cleanup').catch(()=>{});spawnSync('tmux',['-L',socket,'kill-server']);rmSync(directory,{recursive:true,force:true});}
});

test('new context clears the terminal while preserving pane state and inspectable archived history',async()=>{
  const screen=()=>tmux('capture-pane','-p','-t','philby:sessions');
  const capture=async(all=false)=>JSON.parse(await make('pane-capture','slug=sessions',`ALL=${all?'1':'0'}`));
  const idle=()=>until(async()=>JSON.parse(await run('node',['dist/src/cli.js','status','sessions'])).work.tasks.length===0);
  const command=(text:string)=>tmux('send-keys','-t','philby:sessions','C-u',text,'Enter');
  try {
    await make('pane','slug=sessions');
    await until(async()=> /^sessions\s+test\s+ready/m.test(await screen()));
    const file=join(env.PHILBY_PANES_DIR,'sessions','kept.txt');writeFileSync(file,'keep this work');
    await make('pane-memory','slug=sessions','FIELD=notes','prompt=Keep this memory');
    const memory=JSON.parse(await make('pane-memory','slug=sessions'));
    await command('before fresh context');
    await until(async()=>JSON.stringify(await capture()).includes('Received: before fresh context'));
    await idle();
    const before=await capture(true);
    await make('pane-plan-set','slug=sessions','ACTIVE=0','PLAN=Old approved plan');
    await make('pane-plan-set','slug=sessions','ACTIVE=1');
    await until(async()=> /^sessions\s+test\s+ready\s+PLAN MODE\b/m.test(await screen()));
    await command('/new unexpected');
    await until(async()=> (await screen()).includes('/new takes no arguments'));
    assert.deepEqual(await capture(true),before);
    await command('/new');
    await until(async()=> (await capture()).length===1);
    assert.equal((await capture())[0].kind,'pi.reset');
    await until(async()=> !/before fresh context|PLAN MODE/.test(await screen()));
    assert.deepEqual(JSON.parse(await make('pane-plan','slug=sessions')),{active:false,plan:''});
    assert.deepEqual(JSON.parse(await make('pane-memory','slug=sessions')),memory);
    assert.equal(readFileSync(file,'utf8'),'keep this work');
    const archive=await capture(true);
    assert.deepEqual(archive.slice(0,before.length),before);
    assert.match(JSON.stringify(archive),/before fresh context/);

    await command('after fresh context');
    await until(async()=>JSON.stringify(await capture()).includes('Received: after fresh context'));
    await idle();
    const current=await capture(),full=await capture(true);
    assert.doesNotMatch(JSON.stringify(current),/before fresh context|Old approved plan/);
    await make('pane-close','slug=sessions');
    assert.deepEqual(await capture(),current);
    assert.deepEqual(await capture(true),full);
    await make('pane','slug=sessions');
    await until(async()=> (await screen()).includes('after fresh context'));
    assert.doesNotMatch(await screen(),/before fresh context/);
    assert.deepEqual(await capture(),current);
    await make('pane-new-session','slug=sessions');
    assert.deepEqual((await capture()).map((entry:any)=>entry.kind),['pi.reset']);
    assert.match(JSON.stringify(await capture(true)),/after fresh context/);
    assert.equal((await tmux('list-windows','-t','philby','-F','#{window_name}')).trim(),'sessions');
    await make('pane-new');
    const chooser=await selector();
    assert.match(await tmux('capture-pane','-p','-t',chooser),/New pane[\s\S]*sessions/);
    await tmux('send-keys','-t',chooser,'Escape');
    await until(async()=> (await tmux('list-windows','-t','philby','-F','#{window_name}')).trim()==='sessions');
  } finally {await make('cleanup').catch(()=>{});spawnSync('tmux',['-L',socket,'kill-server']);rmSync(directory,{recursive:true,force:true});}
});

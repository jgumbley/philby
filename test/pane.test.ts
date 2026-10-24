import test from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, hasApi, type TranscriptContext, type AssistantMessage } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { InboxDoc } from '@earendil-works/pi-durable';
const directory=mkdtempSync(join(tmpdir(),'philby-test-'));
process.env.PHILBY_ROOT=directory;process.env.PHILBY_PANES_DIR=join(directory,'panes');
writeFileSync(join(directory,'PANE.md'),'shared-pane-guidance');
cpSync(new URL('../../pane-types',import.meta.url),join(directory,'pane-types'),{recursive:true});
mkdirSync(join(directory,'shared'));writeFileSync(join(directory,'shared','Makefile'),'help:\n\t@echo shared-tool\n');
const {Pane,Memory,Checks,ctx}=await import('../src/pane.js');
const {envelope,Store,nextDeadline,paths,prepare}=await import('../src/store.js');
const {request}=await import('../src/ipc.js');
const {migrateMailboxes}=await import('../src/mailboxes.js');
const model={provider:'test',modelId:'test'};
function fixture(responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]=[fauxAssistantMessage('done')], speed=10000) {
  const faux=fauxProvider({provider:'test',models:[{id:'test'}],tokensPerSecond:speed});
  faux.setResponses(responses);const models=createModels();models.setProvider(faux.provider);return {models,faux};
}
async function until(fn:()=>Promise<boolean>|boolean) {for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out');}
test('model picker retains a current model outside its presets',async()=>{
  const current={provider:'custom',modelId:'outside-picker'};
  const models=createModels();models.setProvider(fauxProvider({provider:current.provider,models:[{id:current.modelId}]}).provider);
  const p=await Pane.open('model-custom',models,current);
  try {
    const selection=await request('model-custom',{op:'model'});
    assert.deepEqual(selection.current,current);
    assert.deepEqual(selection.choices.map(({provider,modelId}:any)=>({provider,modelId})),[current]);
    assert.deepEqual((await request('model-custom',{op:'model',...current})).current,current);
  }finally{await p.close();}
});
test('model switching preserves running tools, queued input, memory and the saved conversation',async()=>{
  const effect=join(directory,'model-effect'),release=join(directory,'model-release');
  const alternate={provider:'test',modelId:'test-alternate'};
  const faux=fauxProvider({provider:'test',models:[{id:'test'},{id:alternate.modelId}],tokensPerSecond:10000});
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('bash',{command:`echo once >> '${effect}'; while [ ! -f '${release}' ]; do sleep .02; done`})],{stopReason:'toolUse'}),
    fauxAssistantMessage('switched answer'),fauxAssistantMessage('queued answer'),fauxAssistantMessage('reopened answer')
  ]);
  const models=createModels();models.setProvider(faux.provider);
  const p=await Pane.open('model-switch',models,model);
  const other=await Pane.open('model-other',fixture().models,model);
  try {
    const conversationId=p.conversation.id;
    await p.operation({op:'memory',field:'notes',content:'preserved model memory'});
    await p.conversation.configure({thinkingLevel:'high'},ctx);
    const initial=await request('model-switch',{op:'model'});
    assert.deepEqual(initial.current,model);
    assert.ok(initial.choices.some((choice:any)=>choice.modelId===alternate.modelId));
    const running=await p.conversation.submit({type:'input',content:'before switching'},ctx);
    await until(()=>existsSync(effect));
    const queued=await p.conversation.submit({type:'input',content:'queued during switch',whenBusy:'followUp'},ctx);
    const before=await p.operation({op:'capture'});
    const selected=await request('model-switch',{op:'model',...alternate});
    assert.deepEqual(selected.current,alternate);
    assert.equal(p.conversation.id,conversationId);
    assert.deepEqual(await p.operation({op:'capture'}),before);
    assert.deepEqual((await other.conversation.agent(ctx)).model,model);
    assert.equal((await p.conversation.agent(ctx)).thinkingLevel,'high');
    await assert.rejects(request('model-switch',{op:'model',provider:'test',modelId:'missing'}),/Model unavailable/);
    await assert.rejects(request('model-switch',{op:'model',provider:'missing',modelId:alternate.modelId}),/Model unavailable/);
    assert.deepEqual((await p.conversation.agent(ctx)).model,alternate);
    writeFileSync(release,'');
    assert.equal((await running.wait(ctx)).status,'done');
    assert.equal((await queued.wait(ctx)).status,'done');
    await p.conversation.waitForIdle(ctx);
    const history=(await p.conversation.context(ctx)).messages;
    assert.deepEqual(history.filter(m=>m.role==='assistant').map(m=>m.model),['test',alternate.modelId,alternate.modelId]);
    assert.equal(readFileSync(effect,'utf8'),'once\n');
    await p.close();
    const reopened=await Pane.open('model-switch',models,model);
    try {
      assert.equal(reopened.conversation.id,conversationId);
      assert.deepEqual((await request('model-switch',{op:'model'})).current,alternate);
      assert.equal((await reopened.harness.snapshot(Memory,reopened.conversation.id,ctx))?.notes,'preserved model memory');
      assert.equal((await (await reopened.conversation.submit({type:'input',content:'after reopening'},ctx)).wait(ctx)).status,'done');
      const messages=(await reopened.conversation.context(ctx)).messages;
      assert.deepEqual(messages.filter(m=>m.role==='assistant').map(m=>m.model),['test',alternate.modelId,alternate.modelId,alternate.modelId]);
      assert.ok(JSON.stringify(messages).includes('before switching'));
      assert.ok(JSON.stringify(messages).includes('queued during switch'));
    }finally{await reopened.close();}
  }finally{writeFileSync(release,'');await p.close();await other.close();}
});
test('Makefile sources reach the first provider request and refresh after tools without reopening',async()=>{
  const dirs=prepare('live-tools');
  assert.equal(readFileSync(join(dirs.tools,'SCOPE.md'),'utf8'),'');
  const files={shared:join(directory,'shared','Makefile'),pane:join(dirs.tools,'Makefile')};
  const originalShared=readFileSync(files.shared,'utf8');
  const initial={shared:'help:\n\t@echo shared\nhidden-target:\n\t@printf "%s\\n" "$(value INPUT)"\n',pane:readFileSync(files.pane,'utf8')};
  const updated={shared:'help:\n\t@echo shared\nnew-shared-target:\n\t@echo shared-ready\n',pane:'help:\n\t@echo pane\nnew-pane-target:\n\t@echo pane-ready\n'};
  const providerModel=openrouterProvider().getModels().find(candidate=>candidate.id==='z-ai/glm-5.3');
  assert.ok(providerModel && hasApi(providerModel,'openai-completions'));
  const serialized=async(context:TranscriptContext)=>{
    let payload:any,networkCalls=0;
    const response=await streamSimple(providerModel,context,{
      apiKey:'offline-test-placeholder',
      fetch:async()=>{networkCalls++;throw Error('Network forbidden in source test');},
      onPayload:value=>{payload=value;throw Error('Offline payload captured');}
    }).result();
    assert.equal(networkCalls,0);
    assert.equal(response.errorMessage,'Offline payload captured');
    assert.equal(payload.messages[0].role,'system');
    assert.equal(typeof payload.messages[0].content,'string');
    return payload.messages[0].content as string;
  };
  const verify=(system:string,sources:typeof initial)=>{
    for(const name of ['shared','pane'] as const)assert.ok(system.includes(`Source: ${files[name]}\n\n${sources[name]}`));
  };
  const f=fixture([
    async context=>{
      verify(await serialized(context),initial);
      return fauxAssistantMessage(Object.entries(updated).map(([name,content])=>fauxToolCall('write',{path:files[name as keyof typeof files],content})),{stopReason:'toolUse'});
    },
    async context=>{
      const system=await serialized(context);verify(system,updated);
      for(const name of ['shared','pane'] as const)assert.ok(!system.includes(`Source: ${files[name]}\n\n${initial[name]}`));
      return fauxAssistantMessage('updated sources verified');
    },
    async context=>{
      const system=await serialized(context);
      assert.ok(system.includes(`Source: ${files.shared}\n\nERROR reading Makefile:`));
      assert.match(system,/ENOENT/);
      assert.ok(!system.includes(updated.shared));
      assert.ok(system.includes(`Source: ${files.pane}\n\n${updated.pane}`));
      return fauxAssistantMessage('missing source reported');
    }
  ]);
  writeFileSync(files.shared,initial.shared);
  const p=await Pane.open('live-tools',f.models,model),errors:unknown[]=[];
  p.onError=error=>errors.push(error);
  try {
    assert.equal(f.faux.state.callCount,0);
    assert.equal((await (await p.conversation.submit({type:'input',content:'inspect and update tools'},ctx)).wait(ctx)).status,'done');
    assert.equal(f.faux.state.callCount,2);
    assert.deepEqual(await p.operation({op:'tools'}),updated);
    for(const name of ['shared','pane'] as const)assert.equal(readFileSync(files[name],'utf8'),updated[name]);
    rmSync(files.shared);
    assert.equal((await (await p.conversation.submit({type:'input',content:'inspect tools again'},ctx)).wait(ctx)).status,'done');
    assert.equal(f.faux.state.callCount,3);
    assert.ok(errors.some(error=>String(error).includes(files.shared) && String(error).includes('ENOENT')));
    await assert.rejects(p.operation({op:'tools'}),/ENOENT/);
  }finally{writeFileSync(files.shared,originalShared);await p.close();}
});
test('pane scope survives compaction and loads independently on reopening',async()=>{
  const a=prepare('instructions-a'),b=prepare('instructions-b');
  assert.equal(readFileSync(join(a.tools,'SCOPE.md'),'utf8'),'');
  writeFileSync(join(directory,'AGENTS.md'),'root-only-instructions');
  writeFileSync(join(a.tools,'SCOPE.md'),'alpha-only-instructions');
  writeFileSync(join(b.tools,'SCOPE.md'),'beta-only-instructions');
  prepare('instructions-a');assert.equal(readFileSync(join(a.tools,'SCOPE.md'),'utf8'),'alpha-only-instructions');
  const verify=(tools:string,expected:string,excluded:string[],guidance='shared-pane-guidance')=>async(context:TranscriptContext)=>{
    const sections=Object.assign({},...context.messages.filter(m=>m.role==='system').map(m=>m.sections));
    const system=JSON.stringify(sections);
    for(const [name,file] of [['shared',join(directory,'shared','Makefile')],['pane',join(tools,'Makefile')]])assert.ok(sections[`${name}-tools`].includes(`Source: ${file}\n\n${readFileSync(file,'utf8')}`));
    assert.ok(system.includes(guidance));
    assert.ok(system.includes(expected));for(const text of excluded)assert.ok(!system.includes(text));
    return fauxAssistantMessage('instructions verified');
  };
  const f=fixture([fauxAssistantMessage('older history summarized'),verify(a.tools,'alpha-only-instructions',['root-only-instructions','beta-only-instructions','changed-alpha-instructions']),verify(a.tools,'alpha-only-instructions',['changed-alpha-instructions','changed-shared-pane-guidance'])]);
  const p=await Pane.open('instructions-a',f.models,model);
  const q=await Pane.open('instructions-b',fixture([verify(b.tools,'beta-only-instructions',['root-only-instructions','alpha-only-instructions','changed-shared-pane-guidance'])]).models,model);
  try {
    assert.equal(f.faux.state.callCount,0);
    await p.operation({op:'memory',field:'notes',content:'saved independently'});
    for(const content of ['old-history-marker','recent history '.repeat(10000)])await p.conversation.submit({type:'write',entry:{kind:'fixture',model:[{role:'user',content,timestamp:Date.now()}]}},ctx);
    const task=await p.conversation.compact(undefined,ctx);await p.harness.waitForTask(task,ctx);
    assert.ok((await p.conversation.context(ctx)).head);
    assert.equal((await (await p.conversation.submit({type:'input',content:'after compaction'},ctx)).wait(ctx)).status,'done');
    assert.equal((await p.harness.snapshot(Memory,p.conversation.id,ctx))?.notes,'saved independently');
    writeFileSync(join(a.tools,'SCOPE.md'),'changed-alpha-instructions');
    writeFileSync(join(directory,'PANE.md'),'changed-shared-pane-guidance');
    assert.equal((await (await p.conversation.submit({type:'input',content:'same process'},ctx)).wait(ctx)).status,'done');
    assert.equal((await (await q.conversation.submit({type:'input',content:'other pane'},ctx)).wait(ctx)).status,'done');
    await p.close();
    const reopened=await Pane.open('instructions-a',fixture([verify(a.tools,'changed-alpha-instructions',['alpha-only-instructions','beta-only-instructions'],'changed-shared-pane-guidance')]).models,model);
    try {assert.equal((await (await reopened.conversation.submit({type:'input',content:'reopened'},ctx)).wait(ctx)).status,'done');}finally{await reopened.close();}
  }finally{await p.close();await q.close();writeFileSync(join(directory,'PANE.md'),'shared-pane-guidance');}
});
test('blank boot remains idle and unreadable instructions fail without retaining the lock',async()=>{
  const dirs=prepare('instructions-invalid');const file=join(dirs.tools,'SCOPE.md');
  rmSync(file);mkdirSync(file);
  await assert.rejects(Pane.open('instructions-invalid',fixture().models,model),/EISDIR/);
  rmSync(file,{recursive:true});writeFileSync(file,'');writeFileSync(join(dirs.tools,'BOOT.md'),' \n\t');
  const f=fixture();const p=await Pane.open('instructions-invalid',f.models,model);
  try {await p.tick();assert.equal(f.faux.state.callCount,0);assert.deepEqual((await p.harness.snapshot(Checks,p.conversation.id,ctx))?.items,[]);}finally{await p.close();}
});
test('startup queues behind saved user work and resumes its original durable task',async()=>{
  const f=fixture([fauxAssistantMessage('working '.repeat(100))],10);
  const p=await Pane.open('startup',f.models,model);
  await p.operation({op:'input',content:'first user work'});await until(()=>f.faux.state.callCount===1);
  await p.operation({op:'input',content:'queued user work'});await p.close();
  const dirs=prepare('startup');writeFileSync(join(dirs.tools,'BOOT.md'),'restore configured workspace');
  writeFileSync(join(dirs.tools,'Makefile'),'close:\n\t@echo closed >> closed\n');
  const slow=fixture([fauxAssistantMessage('resuming '.repeat(100))],10);
  const q=await Pane.open('startup',slow.models,model);
  await until(async()=>(await q.harness.inspect(ctx)).submissions.some(s=>s.requestId?.startsWith('startup:')??false));
  const pending=(await q.harness.inspect(ctx)).tasks.filter(t=>t.record.kind==='philby.startup');assert.equal(pending.length,1);
  const startupId=pending[0].record.id;await q.close();
  const r=await Pane.open('startup',fixture([fauxAssistantMessage('resumed'),fauxAssistantMessage('queued complete'),fauxAssistantMessage('startup complete')]).models,model);
  try {
    await until(async()=>(await r.harness.getTask(startupId,ctx))?.state.status==='terminal');
    await r.conversation.waitForIdle(ctx);
    const entries=(await r.conversation.context(ctx)).entries;
    assert.equal(entries.filter(e=>e.kind==='philby.startup').length,1);
    const inputs=(await r.conversation.context(ctx)).messages.filter(m=>m.role==='user').map(m=>JSON.stringify(m.content));
    assert.deepEqual(inputs.map(content=>content.includes('restore configured workspace')?'startup':content.includes('queued user work')?'queued':'first'),['first','queued','startup']);
    assert.deepEqual((await r.harness.snapshot(Checks,r.conversation.id,ctx))?.items,[]);
    assert.deepEqual(await r.operation({op:'close'}),{closed:true});
    await r.close();assert.equal(readFileSync(join(dirs.tools,'closed'),'utf8'),'closed\nclosed\n');
  }finally{await r.close();}
});
test('close waits for teardown and exposes its failure while releasing resources',async()=>{
  const dirs=prepare('close-failure');writeFileSync(join(dirs.tools,'BOOT.md'),'restore');
  writeFileSync(join(dirs.tools,'Makefile'),'close:\n\t@echo teardown-failed >&2; echo closed >> closed; exit 7\n');
  const p=await Pane.open('close-failure',fixture().models,model);
  await assert.rejects(request('close-failure',{op:'close'}),/teardown-failed/);
  assert.equal(readFileSync(join(dirs.tools,'closed'),'utf8'),'closed\n');
  await assert.rejects(p.close(),/teardown-failed/);
  assert.equal(readFileSync(join(dirs.tools,'closed'),'utf8'),'closed\n');
  writeFileSync(join(dirs.tools,'Makefile'),'close:\n\t@sleep .1; echo closed >> closed\n');
  const q=await Pane.open('close-failure',fixture().models,model);
  try {assert.deepEqual(await request('close-failure',{op:'close'}),{closed:true});assert.equal(readFileSync(join(dirs.tools,'closed'),'utf8'),'closed\nclosed\n');}finally{await q.close();}
});
test('isolated memory, tools, durable conversation and lifetime lock',async()=>{
  const a=fixture([async context=>{assert.ok(JSON.stringify(context).includes('remember-alpha'));return fauxAssistantMessage('alpha answer');}]);
  const b=fixture([fauxAssistantMessage('beta answer')]);
  const alpha=await Pane.open('alpha',a.models,model);const beta=await Pane.open('beta',b.models,model);
  try {
    await assert.rejects(Pane.open('alpha',a.models,model),/already running/);
    await request('alpha',{op:'memory',field:'notes',content:'remember-alpha'});
    const sub=await alpha.conversation.submit({type:'input',content:'first'},ctx);await sub.wait(ctx);
    assert.equal((await beta.harness.snapshot(Memory,beta.conversation.id,ctx))?.notes,'');
    assert.notEqual(paths('alpha').tools,paths('beta').tools);
    for(const name of ['alpha','beta']) {
      const p=paths(name);assert.equal(p.state,join(p.tools,'.state'));
      for(const file of ['durable.sqlite','app.sqlite','lock.sqlite'])assert.ok(existsSync(join(p.state,file)));
    }
    assert.equal(existsSync(join(directory,'.philby')),false);
    await alpha.close();
    const result=await (await beta.conversation.submit({type:'input',content:'still here'},ctx)).wait(ctx);assert.equal(result.status,'done');
    const revived=await Pane.open('alpha',fixture().models,model);
    try {assert.equal((await revived.harness.snapshot(Memory,revived.conversation.id,ctx))?.notes,'remember-alpha');assert.ok(JSON.stringify(await revived.operation({op:'capture'})).includes('alpha answer'));}finally{await revived.close();}
  } finally {await alpha.close();await beta.close();}
});
test('receiving pane mailbox survives closed panes without creating tools and deduplicates retries',async()=>{
  const e=envelope('sender','receiving-pane','hello',{id:'stable-message'});
  const mailbox=new Store(e.to);mailbox.accept(e);mailbox.close();
  for(const file of ['SCOPE.md','Makefile','.pane-type'])assert.equal(existsSync(join(paths(e.to).tools,file)),false);
  assert.equal(paths(e.to).state,join(paths(e.to).tools,'.state'));
  assert.equal(existsSync(paths(e.from).state),false);
  assert.equal(existsSync(join(paths(e.to).state,'durable.sqlite')),false);
  const receiving=await Pane.open(e.to,fixture([fauxAssistantMessage('received')]).models,model);
  try {
    await until(async()=>JSON.stringify(await receiving.operation({op:'capture'})).includes('received'));
    await receiving.operation({op:'receive',envelope:e});await receiving.tick();
    const entries=await receiving.conversation.context(ctx);assert.equal(entries.messages.filter(m=>m.role==='user').length,1);
    assert.throws(()=>receiving.store.accept({...e,content:'conflict'}),/conflict/);
  } finally {await receiving.close();}
});
test('pane send persists directly in the receiving pane mailbox with its input mode',async()=>{
  const sending=await Pane.open('sending-pane',fixture().models,model);
  try {
    assert.deepEqual(await sending.operation({op:'send',to:'receiving-closed',content:'focus here',id:'steering',mode:'steer'}),{accepted:'steering'});
    const receiving=new Store('receiving-closed');
    try {assert.deepEqual(receiving.pending(),[envelope('sending-pane','receiving-closed','focus here',{id:'steering',mode:'steer'})]);}
    finally {receiving.close();}
    assert.equal(sending.store.db.prepare("SELECT name FROM sqlite_master WHERE name='outbox'").get(),undefined);
  }finally{await sending.close();}
});
test('concurrent writers cannot accept conflicting content for one receiving pane request ID',{timeout:10000},async()=>{
  const moduleUrl=new URL('../src/store.js',import.meta.url).href;
  const children:ReturnType<typeof spawn>[]=[];
  let ready=0;
  try {
    const results=await Promise.all(['first','second'].map(content=>new Promise<boolean>((resolve,reject)=>{
      const script=`import {Store,envelope} from ${JSON.stringify(moduleUrl)};
        const store=new Store('concurrent-receiving');
        process.once('message',()=>{
          let accepted=true;
          try {store.accept(envelope('concurrent-sender','concurrent-receiving',${JSON.stringify(content)},{id:'concurrent-request'}));}
          catch(error){if(!String(error).includes('Request ID conflict'))throw error;accepted=false;}
          finally{store.close();}
          process.send({accepted},()=>process.disconnect());
        });
        process.send('ready');`;
      const child=spawn(process.execPath,['--input-type=module','-e',script],{env:process.env,stdio:['ignore','ignore','pipe','ipc']});
      children.push(child);let accepted:boolean|undefined;let error='';
      child.stderr!.on('data',chunk=>{error+=chunk;});
      child.on('message',message=>{
        if(message==='ready') {if(++ready===2)for(const writer of children)writer.send('accept');}
        else accepted=(message as {accepted:boolean}).accepted;
      });
      child.once('error',reject);
      child.once('exit',code=>code===0 && accepted!==undefined?resolve(accepted):reject(Error(error || `Writer exited ${code}`)));
    })));
    assert.deepEqual(results.sort(),[false,true]);
    const receiving=new Store('concurrent-receiving');
    try {assert.equal(receiving.pending().length,1);}finally{receiving.close();}
  }finally{for(const child of children)child.kill();}
});
test('updates are durable and passive',async()=>{
  const f=fixture();const p=await Pane.open('updates',f.models,model);
  const e=envelope('alpha','updates','decision needed',{kind:'update'});
  await p.operation({op:'receive',envelope:e});await p.tick();assert.equal(f.faux.state.callCount,0);await p.close();
  const q=await Pane.open('updates',fixture().models,model);
  try {const updates=await q.operation({op:'updates',mark:true}) as any[];assert.equal(updates.length,1);assert.equal(updates[0].seen,false);assert.equal(q.store.updates()[0].seen,true);}finally{await q.close();}
});
test('close preserves queued work and review configuration',async()=>{
  const f=fixture([fauxAssistantMessage('slow answer '.repeat(100)),fauxAssistantMessage('queued answer')],10);
  const p=await Pane.open('queue',f.models,model);
  await p.operation({op:'check-set',check:{id:'daily',prompt:'review',daily:'09:00'}});
  await p.operation({op:'input',id:'one',content:'first'});
  await until(()=>f.faux.state.callCount>0);
  await p.operation({op:'input',id:'two',content:'second'});
  await p.close();
  const q=await Pane.open('queue',fixture([fauxAssistantMessage('resumed'),fauxAssistantMessage('follow up')]).models,model);
  try {await q.conversation.waitForIdle(ctx);const text=JSON.stringify(await q.operation({op:'capture'}));assert.ok(text.includes('second'));assert.equal((await q.harness.snapshot(Checks,q.conversation.id,ctx))?.items.length,1);}finally{await q.close();}
});
test('unsafe side effect interrupted by close is not repeated',async()=>{
  const file=join(directory,'effect');
  const f=fixture([fauxAssistantMessage([fauxToolCall('bash',{command:`echo once >> '${file}'; sleep 30`})],{stopReason:'toolUse'})]);
  const p=await Pane.open('unsafe',f.models,model);
  await p.operation({op:'input',content:'do side effect'});
  await until(()=>{try{return readFileSync(file,'utf8').includes('once');}catch{return false;}});
  await p.close();
  const q=await Pane.open('unsafe',fixture([fauxAssistantMessage('inspect interrupted call')]).models,model);
  try {await q.conversation.waitForIdle(ctx);assert.equal(readFileSync(file,'utf8'),'once\n');assert.match(JSON.stringify(await q.operation({op:'capture'})),/interrupt/i);}finally{await q.close();}
});
test('native tools use pane cwd and shared Make capabilities',async()=>{
  const f=fixture([fauxAssistantMessage([fauxToolCall('bash',{command:`pwd; make -C '${directory}/shared' help`})],{stopReason:'toolUse'}),fauxAssistantMessage('tools verified')]);
  const p=await Pane.open('tools',f.models,model);
  try {await (await p.conversation.submit({type:'input',content:'tools'},ctx)).wait(ctx);const transcript=JSON.stringify(await p.operation({op:'capture'}));assert.ok(transcript.includes(paths('tools').tools));assert.ok(transcript.includes('shared-tool'));}finally{await p.close();}
});
test('review task coalesces missed deadlines and does not overlap',async()=>{
  const f=fixture([fauxAssistantMessage('NO_CHANGE')]);const p=await Pane.open('review',f.models,model);
  try {
    await p.operation({op:'check-set',check:{id:'review',prompt:'inspect',intervalMs:60000}});
    await p.conversation.commit(async tx=>{(await tx.doc(Checks,p.conversation.id)).items[0].next=Date.now()-1000000;},ctx);
    await p.tick();await until(()=>f.faux.state.callCount===1);await p.conversation.waitForIdle(ctx);await p.tick();
    const doc=await p.harness.snapshot(Checks,p.conversation.id,ctx);assert.ok(doc!.items[0].next>Date.now());assert.ok(doc!.items[0].task);
    await p.operation({op:'check-pause',id:'review'});assert.equal((await p.harness.snapshot(Checks,p.conversation.id,ctx))?.items[0].paused,true);
    await p.close();const q=await Pane.open('review',fixture().models,model);try{assert.equal((await q.harness.snapshot(Checks,q.conversation.id,ctx))?.items[0].paused,true);}finally{await q.close();}
  }finally{await p.close();}
});
test('daily local deadlines across daylight saving and missed occurrences',()=>{
  const c={daily:'09:00',timezone:'Europe/Isle_of_Man'};
  assert.equal(new Date(nextDeadline(c,Date.parse('2026-03-28T10:00:00Z'))).toISOString(),'2026-03-29T08:00:00.000Z');
  assert.equal(new Date(nextDeadline(c,Date.parse('2026-10-24T10:00:00Z'))).toISOString(),'2026-10-25T09:00:00.000Z');
  assert.throws(()=>nextDeadline({...c,timezone:'invalid'},Date.now()),/timezone/);
  assert.throws(()=>nextDeadline({...c,intervalMs:1},Date.now()),/Interval/);
});


test('stop current run keeps admitted follow-ups and pane available',async()=>{
  const f=fixture([fauxAssistantMessage('slow '.repeat(100)),fauxAssistantMessage('next response'),fauxAssistantMessage('still available')],10);
  const p=await Pane.open('stop',f.models,model);
  try {
    await p.operation({op:'input',content:'first'});await until(()=>f.faux.state.callCount===1);
    await p.operation({op:'input',content:'follow-up'});await p.operation({op:'stop'});
    await until(()=>f.faux.state.callCount===2);
    await p.conversation.waitForIdle(ctx);
    assert.match(JSON.stringify(await p.operation({op:'capture'})),/follow-up/);
    assert.equal((await (await p.conversation.submit({type:'input',content:'continue'},ctx)).wait(ctx)).status,'done');
  }finally{await p.close();}
});
test('review queued behind active work survives close and can be paused without consuming user work',async()=>{
  const f=fixture([fauxAssistantMessage('working '.repeat(100))],10);
  const p=await Pane.open('review-pending',f.models,model);
  await p.operation({op:'input',content:'human work'});await until(()=>f.faux.state.callCount===1);
  await p.operation({op:'check-set',check:{id:'pending',prompt:'review pending',intervalMs:60000}});
  await p.conversation.commit(async tx=>{(await tx.doc(Checks,p.conversation.id)).items[0].next=0;},ctx);
  await p.tick();
  await until(async()=> (await p.harness.inspect(ctx)).submissions.some(s=>s.requestId?.startsWith('review:') ?? false));
  await p.close();
  const q=await Pane.open('review-pending',fixture([fauxAssistantMessage('resumed '.repeat(100))],10).models,model);
  try {
    await q.operation({op:'check-pause',id:'pending'});
    const inspect=await q.harness.inspect(ctx);
    assert.equal(inspect.submissions.filter(s=>s.requestId?.startsWith('review:')).length,0);
    assert.ok(inspect.tasks.some(t=>t.record.kind==='pi.generation'));
  }finally{await q.close();}
});


test('SIGKILL releases lifetime lock and unsafe tool intent recovers without replay',async()=>{
  const file=join(directory,'crash-effect');
  const moduleUrl=new URL('../src/pane.js',import.meta.url).href;
  const script=`import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
    const {Pane}=await import(${JSON.stringify(moduleUrl)});
    const f=fauxProvider({provider:'test',models:[{id:'test'}]});
    f.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:${JSON.stringify(`echo once >> '${file}'; sleep 1`)}})],{stopReason:'toolUse'})]);
    const m=createModels();m.setProvider(f.provider);
    const p=await Pane.open('crash',m,{provider:'test',modelId:'test'});
    await p.operation({op:'input',content:'side effect'});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{env:process.env,stdio:'ignore'});
  try {
    await until(()=>{try{return readFileSync(file,'utf8')==='once\n';}catch{return false;}});
    const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;
    const p=await Pane.open('crash',fixture([fauxAssistantMessage('inspect before retry')]).models,model);
    try {await p.conversation.waitForIdle(ctx);assert.equal(readFileSync(file,'utf8'),'once\n');assert.match(JSON.stringify(await p.operation({op:'capture'})),/interrupt/i);}finally{await p.close();}
  }finally{child.kill('SIGKILL');}
});


test('delivery recovers after receiving pane Durable admission before marking its mailbox placed',async()=>{
  const e=envelope('boundary-sender','boundary-receiving','exactly once',{id:'boundary'});
  const p=await Pane.open(e.to,fixture([fauxAssistantMessage('partial '.repeat(100))],10).models,model);
  p.store.accept(e);
  await p.conversation.submit({type:'input',content:`[From ${e.from}]\n${e.content}`,requestId:`message:${e.id}`,whenBusy:e.mode},ctx);
  assert.equal(p.store.pending().length,1);
  await p.close();
  const q=await Pane.open(e.to,fixture([fauxAssistantMessage('recovered')]).models,model);
  try {
    await q.conversation.waitForIdle(ctx);
    assert.equal((await q.conversation.context(ctx)).messages.filter(m=>m.role==='user').length,1);
    assert.equal(q.store.pending().length,0);
  }finally{await q.close();}
});
test('legacy mailbox migration requires closed panes and preserves receiving pane state on retry',async()=>{
  const sender='migration-sender',name='migration-receiving';
  mkdirSync(paths(sender).state,{recursive:true});
  const legacy=new DatabaseSync(join(paths(sender).state,'app.sqlite'));
  legacy.exec('CREATE TABLE outbox (id TEXT PRIMARY KEY, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)');
  const old=envelope(sender,name,'already received',{id:'migration-old'});
  const input=envelope(sender,name,'new input',{id:'migration-input',mode:'steer'});
  const seen=envelope(sender,name,'seen report',{id:'migration-seen',kind:'update'});
  const update=envelope(sender,name,'new report',{id:'migration-update',kind:'update'});
  for(const e of [old,input,seen,update])legacy.prepare('INSERT INTO outbox(id,body) VALUES (?,?)').run(e.id,JSON.stringify(e));
  const receiving=new Store(name);
  try {
    receiving.accept(old);receiving.placed(old);receiving.accept(seen);receiving.placed(seen);receiving.updates(true);
    const live=await Pane.open('migration-live',fixture().models,model);
    try {assert.throws(()=>migrateMailboxes(),/Close pane migration-live/);}
    finally {await live.close();}
    assert.deepEqual(migrateMailboxes(),{migrated:4});
    assert.deepEqual(migrateMailboxes(),{migrated:0});
    assert.deepEqual(receiving.pending(),[input,update]);
    assert.deepEqual(receiving.updates(),[{...seen,seen:true}]);
    assert.equal(legacy.prepare('SELECT count(*) AS count FROM outbox WHERE delivered=1').get()!.count,4);
    for(const file of ['SCOPE.md','Makefile','.pane-type'])assert.equal(existsSync(join(paths(name).tools,file)),false);
  }finally{receiving.close();legacy.close();}
});
test('legacy mailbox migration does not acknowledge conflicting content',()=>{
  const sender='migration-conflict-sender',name='migration-conflict-receiving';
  mkdirSync(paths(sender).state,{recursive:true});
  const legacy=new DatabaseSync(join(paths(sender).state,'app.sqlite'));
  legacy.exec('CREATE TABLE outbox (id TEXT PRIMARY KEY, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)');
  const e=envelope(sender,name,'original',{id:'migration-conflict'});
  legacy.prepare('INSERT INTO outbox(id,body) VALUES (?,?)').run(e.id,JSON.stringify({...e,content:'conflicting'}));
  const receiving=new Store(name);
  try {
    receiving.accept(e);
    assert.throws(()=>migrateMailboxes(),/conflict/);
    assert.equal(legacy.prepare('SELECT delivered FROM outbox WHERE id=?').get(e.id)!.delivered,0);
    assert.deepEqual(receiving.pending(),[e]);
  }finally{receiving.close();legacy.close();}
});
test('plan mode gates mutating tools to read-only until exited',async()=>{
  const target=join(directory,'plan-target');
  const f=fixture([
    async(context:TranscriptContext)=>{
      const sections=Object.assign({},...context.messages.filter(m=>m.role==='system').map(m=>m.sections));
      assert.ok(JSON.stringify(sections).includes('PLAN MODE'));
      return fauxAssistantMessage([
        fauxToolCall('write',{path:target,content:'should not be written'}),
        fauxToolCall('bash',{command:`echo changed >> '${target}'`}),
        fauxToolCall('bash',{command:`cat '${join(directory,'PANE.md')}'`}),
        fauxToolCall('edit',{path:join(directory,'PANE.md'),edits:[{oldText:'shared',newText:'changed'}]})
      ],{stopReason:'toolUse'});
    },
    fauxAssistantMessage('plan presented')
  ]);
  const p=await Pane.open('plan-mode',f.models,model);
  try {
    await p.operation({op:'plan-set',active:true});
    assert.deepEqual(await p.operation({op:'plan'}),{active:true,plan:''});
    assert.equal((await (await p.conversation.submit({type:'input',content:'design a change'},ctx)).wait(ctx)).status,'done');
    assert.equal(existsSync(target),false);
    assert.equal(readFileSync(join(directory,'PANE.md'),'utf8'),'shared-pane-guidance');
    await p.operation({op:'plan-set',active:false,plan:'1. do the thing'});
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:'1. do the thing'});
  }finally{await p.close();}
});
test('plan mode blocks shell bypass attempts',async()=>{
  const target=join(directory,'bypass-target');
  const victim=join(directory,'victim.tmp');
  writeFileSync(victim,'important data');
  const f=fixture([
    fauxAssistantMessage([
      fauxToolCall('bash',{command:`sort -o '${target}' /dev/null`}),
      fauxToolCall('bash',{command:`find '${directory}' -name '*.tmp' -delete`}),
      fauxToolCall('bash',{command:`echo first\necho second > '${target}'`}),
      fauxToolCall('read',{path:join(directory,'PANE.md')})
    ],{stopReason:'toolUse'}),
    async(context:TranscriptContext)=>{
      const last=context.messages.filter(m=>m.role==='toolResult').at(-1);
      assert.ok(last);
      assert.equal(last.isError,false);
      assert.equal(last.toolName,'read');
      assert.ok(JSON.stringify(last.content).includes('shared-pane-guidance'));
      return fauxAssistantMessage('done');
    }
  ]);
  const p=await Pane.open('plan-bypass',f.models,model);
  try {
    await p.operation({op:'plan-set',active:true});
    assert.equal((await (await p.conversation.submit({type:'input',content:'try bypasses'},ctx)).wait(ctx)).status,'done');
    assert.equal(existsSync(target),false);
    assert.equal(readFileSync(victim,'utf8'),'important data');
  }finally{await p.close();}
});
test('plan mode rejects activation while work is active',async()=>{
  const releaseFile=join(directory,'busy-release');
  const effectFile=join(directory,'busy-effect');
  const f=fixture([
    fauxAssistantMessage([
      fauxToolCall('bash',{command:`echo started >> '${effectFile}'; while [ ! -f '${releaseFile}' ]; do sleep .02; done; echo finished >> '${effectFile}'`})
    ],{stopReason:'toolUse'}),
    fauxAssistantMessage('work done')
  ]);
  const p=await Pane.open('plan-busy',f.models,model);
  try {
    const submission=await p.conversation.submit({type:'input',content:'slow work'},ctx);
    await until(()=>existsSync(effectFile));
    await assert.rejects(p.operation({op:'plan-set',active:true}),/Cannot enter plan mode while work is active/);
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:''});
    writeFileSync(releaseFile,'go');
    await submission.wait(ctx);
    assert.equal(readFileSync(effectFile,'utf8'),'started\nfinished\n');
    await p.operation({op:'plan-set',active:true});
    assert.deepEqual(await p.operation({op:'plan'}),{active:true,plan:''});
  }finally{await p.close();}
});
test('plan mode initializes with explicit default state',async()=>{
  const f=fixture([fauxAssistantMessage('ok')]);
  const p=await Pane.open('plan-init',f.models,model);
  try {
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:''});
  }finally{await p.close();}
});
test('approved plan reaches model context after exit',async()=>{
  const f=fixture([
    async(context:TranscriptContext)=>{
      const sections=Object.assign({},...context.messages.filter(m=>m.role==='system').map(m=>m.sections));
      assert.ok(JSON.stringify(sections).includes('PLAN MODE'));
      return fauxAssistantMessage('here is my plan');
    },
    async(context:TranscriptContext)=>{
      const sections=Object.assign({},...context.messages.filter(m=>m.role==='system').map(m=>m.sections));
      assert.ok(JSON.stringify(sections).includes('Approved plan:'));
      assert.ok(JSON.stringify(sections).includes('1. implement the feature'));
      return fauxAssistantMessage('implementing now');
    }
  ]);
  const p=await Pane.open('plan-context',f.models,model);
  try {
    await p.operation({op:'plan-set',active:true});
    await (await p.conversation.submit({type:'input',content:'plan something'},ctx)).wait(ctx);
    await p.operation({op:'plan-set',active:false,plan:'1. implement the feature'});
    await (await p.conversation.submit({type:'input',content:'go ahead'},ctx)).wait(ctx);
  }finally{await p.close();}
});
test('plan persists across pane reopen',async()=>{
  const f=fixture([fauxAssistantMessage('ok')]);
  let p=await Pane.open('plan-persist',f.models,model);
  try {
    await p.operation({op:'plan-set',active:false,plan:'saved plan text'});
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:'saved plan text'});
  }finally{await p.close();}
  p=await Pane.open('plan-persist',f.models,model);
  try {
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:'saved plan text'});
  }finally{await p.close();}
});
test('exit without replacement preserves existing plan',async()=>{
  const f=fixture([fauxAssistantMessage('ok')]);
  const p=await Pane.open('plan-preserve',f.models,model);
  try {
    await p.operation({op:'plan-set',active:false,plan:'original plan'});
    await p.operation({op:'plan-set',active:true});
    await p.operation({op:'plan-set',active:false});
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:'original plan'});
  }finally{await p.close();}
});
test('new session starts fresh context while preserving memory and history',async()=>{
  const f=fixture([
    fauxAssistantMessage('first session answer'),
    async(context:TranscriptContext)=>{
      const supplied=JSON.stringify(context);
      assert.ok(!supplied.includes('first question'));
      assert.ok(!supplied.includes('old approved plan'));
      assert.ok(supplied.includes('important memory'));
      return fauxAssistantMessage('second session answer');
    }
  ]);
  const p=await Pane.open('new-session',f.models,model);
  try {
    const conversationId=p.conversation.id;
    const file=join(paths('new-session').tools,'kept.txt');
    writeFileSync(file,'saved work');
    await p.operation({op:'memory',field:'notes',content:'important memory'});
    await p.operation({op:'check-set',check:{id:'later',intervalMs:3600000,prompt:'review later'}});
    const reviews=await p.operation({op:'checks'});
    const agent=await p.conversation.agent(ctx);
    await (await p.conversation.submit({type:'input',content:'first question'},ctx)).wait(ctx);
    await p.conversation.commit(async tx=>{for(let i=0;i<105;i++)await tx.appendEntry(p.conversation.id,{kind:'test.archive',data:{i}});},ctx);
    const before=await p.operation({op:'capture',all:true}) as any[];
    assert.ok(before.length>100);
    await p.operation({op:'plan-set',active:true,plan:'old approved plan'});
    await p.operation({op:'new'});
    const after=await p.conversation.context(ctx);
    assert.equal(after.entries.length,1);
    assert.equal(after.entries[0].kind,'pi.reset');
    assert.deepEqual(await p.operation({op:'memory'}),{responsibilities:'',notes:'important memory',decisions:'',outstanding:'',sources:''});
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:''});
    assert.deepEqual(await p.operation({op:'checks'}),reviews);
    assert.deepEqual((await p.conversation.agent(ctx)).model,agent.model);
    assert.equal(p.conversation.id,conversationId);
    assert.equal(readFileSync(file,'utf8'),'saved work');
    assert.deepEqual((await p.operation({op:'capture',all:true}) as any[]).slice(0,before.length),before);
    await (await p.conversation.submit({type:'input',content:'second question'},ctx)).wait(ctx);
  }finally{await p.close();}
});
test('new session rejects while work is active',async()=>{
  const releaseFile=join(directory,'new-release');
  const effectFile=join(directory,'new-effect');
  const f=fixture([
    fauxAssistantMessage([
      fauxToolCall('bash',{command:`echo started >> '${effectFile}'; while [ ! -f '${releaseFile}' ]; do sleep .02; done; echo finished >> '${effectFile}'`})
    ],{stopReason:'toolUse'}),
    fauxAssistantMessage('work done')
  ]);
  const p=await Pane.open('new-busy',f.models,model);
  try {
    const submission=await p.conversation.submit({type:'input',content:'slow work'},ctx);
    await until(()=>existsSync(effectFile));
    await assert.rejects(p.operation({op:'new'}),/Cannot start a new session while work is active/);
    writeFileSync(releaseFile,'go');
    await submission.wait(ctx);
    await p.operation({op:'new'});
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:''});
  }finally{await p.close();}
});
test('new session persists across pane reopen',async()=>{
  const f=fixture([
    fauxAssistantMessage('old session'),
    fauxAssistantMessage('new session')
  ]);
  let p=await Pane.open('new-persist',f.models,model);
  try {
    await (await p.conversation.submit({type:'input',content:'old question'},ctx)).wait(ctx);
    await p.operation({op:'new'});
    await (await p.conversation.submit({type:'input',content:'new question'},ctx)).wait(ctx);
  }finally{await p.close();}
  p=await Pane.open('new-persist',f.models,model);
  try {
    const context=await p.conversation.context(ctx);
    const texts=context.messages.map(m=>m.role==='user'||m.role==='assistant'?String(m.content):'').join(' ');
    assert.ok(!texts.includes('old question'));
    assert.ok(texts.includes('new question'));
  }finally{await p.close();}
});
test('new session preserves queued work, pending deliveries and request identities',async()=>{
  const f=fixture([fauxAssistantMessage('queued done'),fauxAssistantMessage('delivery done')]);
  const p=await Pane.open('new-queued',f.models,model);
  try {
    await p.conversation.commit(async tx=>{
      const inbox=await tx.doc(InboxDoc,p.conversation.id);
      const submission=await tx.createSubmission({conversationId:p.conversation.id,type:'input',status:'queued',requestId:'queued-before-reset'});
      inbox.items.push({id:submission.id,mode:'followUp',content:'queued before reset'});
    },ctx);
    await assert.rejects(p.operation({op:'new'}),/work is (queued|active)/);
    await p.tick();
    await p.conversation.waitForIdle(ctx);
    assert.ok(JSON.stringify(await p.operation({op:'capture'})).includes('queued before reset'));
    const message=envelope('sender','new-queued','delivery before reset',{id:'stable-reset-delivery'});
    p.store.accept(message);
    await assert.rejects(p.operation({op:'new'}),/pending delivery|work is (queued|active)/);
    await p.tick();
    await p.conversation.waitForIdle(ctx);
    assert.ok(JSON.stringify(await p.operation({op:'capture'})).includes('delivery before reset'));
    await p.operation({op:'new'});
    p.store.accept(message);
    await p.tick();
    assert.equal(f.faux.state.callCount,2);
    assert.deepEqual((await p.operation({op:'capture'}) as any[]).map(entry=>entry.kind),['pi.reset']);
    assert.ok(JSON.stringify(await p.operation({op:'capture',all:true})).includes('delivery before reset'));
  }finally{await p.close();}
});
test('CLI plan-set validates ACTIVE and preserves plan on empty exit',async()=>{
  const f=fixture([fauxAssistantMessage('ok')]);
  const p=await Pane.open('plan-cli',f.models,model);
  try {
    await p.operation({op:'plan-set',active:false,plan:'saved plan'});
    const cliPath=new URL('../../dist/src/cli.js',import.meta.url).pathname;
    const env={...process.env,PHILBY_PANE:'plan-cli'};
    const run=(args:string[],envVars:Record<string,string>,input?:string)=>new Promise<{code:number,stdout:string,stderr:string}>((resolve,reject)=>{
      const child=spawn('node',['--disable-warning=ExperimentalWarning',cliPath,...args],{env:{...env,...envVars},stdio:['pipe','pipe','pipe']});
      let stdout='',stderr='';
      child.stdout.on('data',d=>stdout+=d);
      child.stderr.on('data',d=>stderr+=d);
      child.on('close',code=>resolve({code:code||0,stdout,stderr}));
      if(input!==undefined) child.stdin.end(input); else child.stdin.end();
    });
    const bad=await run(['plan-set'],{ACTIVE:'invalid'},'');
    assert.notEqual(bad.code,0);
    const output=bad.stderr+bad.stdout;
    assert.ok(output.includes('ACTIVE must be'),`Expected error about ACTIVE, got: ${output}`);
    const emptyPlan=await run(['plan-set'],{ACTIVE:'0',PLAN:''},'');
    assert.equal(emptyPlan.code,0);
    assert.deepEqual(JSON.parse(emptyPlan.stdout),{active:false,plan:'saved plan'});
    const newPlan=await run(['plan-set'],{ACTIVE:'0'},'1. new plan\n2. second step\n');
    assert.equal(newPlan.code,0);
    assert.deepEqual(JSON.parse(newPlan.stdout),{active:false,plan:'1. new plan\n2. second step\n'});
  }finally{await p.close();}
});
test('plan-set preserves plan on empty exit via operation',async()=>{
  const f=fixture([fauxAssistantMessage('ok')]);
  const p=await Pane.open('plan-preserve-op',f.models,model);
  try {
    await p.operation({op:'plan-set',active:false,plan:'saved plan'});
    const result=await p.operation({op:'plan-set',active:false});
    assert.deepEqual(result,{active:false,plan:'saved plan'});
  }finally{await p.close();}
});
test.after(()=>rmSync(directory,{recursive:true,force:true}));

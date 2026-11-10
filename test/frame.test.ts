import test from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, hasApi, type TranscriptContext, type AssistantMessage } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { createRegistry, Harness, InboxDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
const directory=mkdtempSync(join(tmpdir(),'philby-test-'));
process.env.PHILBY_ROOT=directory;process.env.PHILBY_FRAMES_DIR=join(directory,'frames');
cpSync(new URL('../../.env.schema',import.meta.url),join(directory,'.env.schema'));
writeFileSync(join(directory,'FRAME.md'),'shared-frame-guidance');
cpSync(new URL('../../frame-types',import.meta.url),join(directory,'frame-types'),{recursive:true});
mkdirSync(join(directory,'shared'));writeFileSync(join(directory,'shared','Makefile'),'help:\n\t@echo shared-tool\n');
cpSync(new URL('../../shared/frame.env.schema',import.meta.url),join(directory,'shared','frame.env.schema'));
const {Frame,Memory,ctx,migrateFrameSettings}=await import('../src/frame.js');
const {readFrameSettings,writeFrameSettings}=await import('../src/frame-config.js');
const {envelope,Store,paths,prepare}=await import('../src/store.js');
const {request}=await import('../src/ipc.js');
const model={provider:'test',modelId:'test'};
function fixture(responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]=[fauxAssistantMessage('done')], speed=10000) {
  const faux=fauxProvider({provider:'test',models:[{id:'test'}],tokensPerSecond:speed});
  faux.setResponses(responses);const models=createModels();models.setProvider(faux.provider);return {models,faux};
}
async function until(fn:()=>Promise<boolean>|boolean) {for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out');}
function runCli(command:string,environment:NodeJS.ProcessEnv) {
  return new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',new URL('../src/cli.js',import.meta.url).pathname,command],{env:{...process.env,...environment},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);
    child.stderr.on('data',chunk=>stderr+=chunk);
    child.once('error',reject);
    child.once('exit',code=>resolve({code,stdout,stderr}));
  });
}
test('model picker retains a current model outside its presets',async()=>{
  const current={provider:'custom',modelId:'outside-picker'};
  const models=createModels();models.setProvider(fauxProvider({provider:current.provider,models:[{id:current.modelId}]}).provider);
  const p=await Frame.open('model-custom',models,current);
  try {
    const selection=await request('model-custom',{op:'model'});
    assert.deepEqual(selection.current,current);
    assert.deepEqual(selection.choices.map(({provider,modelId}:any)=>({provider,modelId})),[current]);
    assert.deepEqual((await request('model-custom',{op:'model',...current})).current,current);
  }finally{await p.close();}
});
test('a missing saved provider fails without replacing the conversation or retaining its lock',async()=>{
  const configured=fixture();
  const p=await Frame.open('missing-provider',configured.models,model);
  const id=p.conversation.id;
  await p.operation({op:'memory',field:'notes',content:'Keep the saved provider selection'});
  await p.close();
  const empty=createModels();
  await assert.rejects(Frame.open('missing-provider',empty,{provider:'replacement',modelId:'other'}),/Saved model unavailable: test\/test/);
  const reopened=await Frame.open('missing-provider',configured.models,model);
  try {
    assert.equal(reopened.conversation.id,id);
    assert.deepEqual((await reopened.conversation.agent(ctx)).model,model);
    assert.equal((await reopened.harness.snapshot(Memory,id,ctx))?.notes,'Keep the saved provider selection');
  }finally{await reopened.close();}
});
test('reopening uses the saved model and history without evaluating the new-frame default',async()=>{
  const configured=fixture();
  const p=await Frame.open('lazy-default',configured.models,model);
  const id=p.conversation.id;
  await p.operation({op:'memory',field:'notes',content:'Keep this memory'});
  assert.equal((await (await p.conversation.submit({type:'input',content:'Keep this conversation'},ctx)).wait(ctx)).status,'done');
  const history=(await p.conversation.context(ctx)).messages;
  await p.close();
  const reopened=await Frame.open('lazy-default',configured.models,()=>{throw Error('default must not be read');});
  try {
    assert.equal(reopened.conversation.id,id);
    assert.deepEqual((await reopened.conversation.agent(ctx)).model,model);
    assert.deepEqual((await reopened.conversation.context(ctx)).messages,history);
    assert.equal((await reopened.harness.snapshot(Memory,id,ctx))?.notes,'Keep this memory');
  }finally{await reopened.close();}
});
test('an unavailable new-frame default leaves no saved root conversation',async()=>{
  const configured=fixture();
  await assert.rejects(Frame.open('invalid-default',configured.models,()=>({provider:'missing',modelId:'unavailable'})),/Model unavailable: missing\/unavailable/);
  const harness=await Harness.open(await openNodeSqliteStorage(join(paths('invalid-default').state,'durable.sqlite')),{models:configured.models,registry:createRegistry()},ctx);
  try {assert.equal(await harness.conversation(ROOT_CONVERSATION_ID,ctx),undefined);}
  finally{await harness.close(ctx);}
  const reopened=await Frame.open('invalid-default',configured.models,()=>model);
  try {assert.deepEqual((await reopened.conversation.agent(ctx)).model,model);}
  finally{await reopened.close();}
});
test('edited frame settings control reopening without replacing saved history or memory',async()=>{
  const alternate={provider:'test',modelId:'owner/alternate'};
  const provider=fauxProvider({provider:'test',models:[{id:model.modelId},{id:alternate.modelId,reasoning:true}],tokensPerSecond:10000});
  provider.setResponses([fauxAssistantMessage('saved answer')]);
  const models=createModels();models.setProvider(provider.provider);
  const p=await Frame.open('settings-authority',models,model);
  const id=p.conversation.id;
  await p.operation({op:'memory',field:'notes',content:'retained settings memory'});
  assert.equal((await (await p.conversation.submit({type:'input',content:'retained history'},ctx)).wait(ctx)).status,'done');
  const history=await p.operation({op:'capture'});
  await p.close();
  const file=join(paths(p.name).tools,'frame.env');
  const source='FRAME_MODEL=test/owner/alternate\nFRAME_THINKING_LEVEL=high\n';
  writeFileSync(file,source);
  const reopened=await Frame.open(p.name,models,()=>{throw Error('new-frame default must not be evaluated');});
  try {
    assert.equal(reopened.conversation.id,id);
    assert.deepEqual((await reopened.conversation.agent(ctx)).model,alternate);
    assert.equal((await reopened.conversation.agent(ctx)).thinkingLevel,'high');
    assert.deepEqual(await reopened.operation({op:'capture'}),history);
    assert.equal((await reopened.harness.snapshot(Memory,id,ctx))?.notes,'retained settings memory');
    assert.equal(readFileSync(file,'utf8'),source);
    assert.equal(provider.state.callCount,1);
  } finally {await reopened.close();}
});
test('old saved frames seed schema settings from their exact saved agent without changing work',async()=>{
  const f=fixture();
  const p=await Frame.open('settings-migration',f.models,model);
  const id=p.conversation.id;
  await p.operation({op:'thinking',level:'high'});
  await p.operation({op:'memory',field:'notes',content:'migration retains memory'});
  assert.equal((await (await p.conversation.submit({type:'input',content:'migration retains history'},ctx)).wait(ctx)).status,'done');
  const history=await p.operation({op:'capture'});
  await p.close();
  const tools=paths(p.name).tools;
  rmSync(join(tools,'frame.env'));
  rmSync(join(tools,'.env.schema'));
  writeFileSync(join(tools,'SCOPE.md'),'edited migration scope');
  const reopened=await Frame.open(p.name,f.models,()=>{throw Error('migration must not read DEFAULT_MODEL');});
  try {
    assert.equal(reopened.conversation.id,id);
    assert.deepEqual(readFrameSettings(tools),{model,thinkingLevel:'high',messaging:true});
    assert.ok(existsSync(join(tools,'.env.schema')));
    assert.equal(readFileSync(join(tools,'SCOPE.md'),'utf8'),'edited migration scope');
    assert.deepEqual(await reopened.operation({op:'capture'}),history);
    assert.equal((await reopened.harness.snapshot(Memory,id,ctx))?.notes,'migration retains memory');
  } finally {await reopened.close();}
});
test('closed frame settings migration needs no provider and preserves the saved conversation',async()=>{
  const f=fixture();
  const p=await Frame.open('settings-offline-migration',f.models,model);
  const id=p.conversation.id;
  await p.operation({op:'thinking',level:'high'});
  await p.operation({op:'memory',field:'notes',content:'offline migration memory'});
  assert.equal((await (await p.conversation.submit({type:'input',content:'offline migration history'},ctx)).wait(ctx)).status,'done');
  const history=await p.operation({op:'capture'});
  await assert.rejects(migrateFrameSettings(p.name),/already running/);
  await p.close();
  const tools=paths(p.name).tools;
  rmSync(join(tools,'frame.env'));
  rmSync(join(tools,'.env.schema'));
  assert.deepEqual(await migrateFrameSettings(p.name),{slug:p.name,migrated:true});
  assert.deepEqual(readFrameSettings(tools),{model,thinkingLevel:'high',messaging:true});
  const source=readFileSync(join(tools,'frame.env'),'utf8');
  assert.deepEqual(await migrateFrameSettings(p.name),{slug:p.name,migrated:false});
  assert.equal(readFileSync(join(tools,'frame.env'),'utf8'),source);
  assert.equal(f.faux.state.callCount,1);
  const reopened=await Frame.open(p.name,f.models,()=>{throw Error('migrated frame must not use default');});
  try {
    assert.equal(reopened.conversation.id,id);
    assert.deepEqual(await reopened.operation({op:'capture'}),history);
    assert.equal((await reopened.harness.snapshot(Memory,id,ctx))?.notes,'offline migration memory');
    assert.equal(f.faux.state.callCount,1);
  } finally {await reopened.close();}
});
test('invalid saved frame configuration fails without replacing the store or retaining its lock',async()=>{
  const f=fixture();
  const p=await Frame.open('settings-invalid',f.models,model);
  const id=p.conversation.id;
  await p.operation({op:'memory',field:'notes',content:'must survive invalid settings'});
  await p.close();
  const tools=paths(p.name).tools,file=join(tools,'frame.env'),schema=join(tools,'.env.schema');
  const original=readFileSync(file,'utf8'),originalSchema=readFileSync(schema,'utf8');
  writeFileSync(file,'FRAME_MODEL=secret-invalid-marker\n');
  await assert.rejects(Frame.open(p.name,f.models,model),error=>error instanceof Error && /invalid/.test(error.message) && !error.message.includes('secret-invalid-marker'));
  assert.equal(readFileSync(file,'utf8'),'FRAME_MODEL=secret-invalid-marker\n');
  writeFileSync(file,original);
  rmSync(schema);
  await assert.rejects(Frame.open(p.name,f.models,model),/schema|missing/i);
  assert.equal(existsSync(schema),false);
  writeFileSync(schema,originalSchema);
  const reopened=await Frame.open(p.name,f.models,model);
  try {
    assert.equal(reopened.conversation.id,id);
    assert.deepEqual((await reopened.conversation.agent(ctx)).model,model);
    assert.equal((await reopened.harness.snapshot(Memory,id,ctx))?.notes,'must survive invalid settings');
  } finally {await reopened.close();}
});
test('failed settings writes leave the runtime and saved selection unchanged',async t=>{
  const p=await Frame.open('settings-write-failure',fixture().models,model);
  const tools=paths(p.name).tools,original=readFileSync(join(tools,'frame.env'),'utf8');
  const rename=t.mock.method(fs,'renameSync',()=>{throw Error('injected settings write failure');});
  syncBuiltinESMExports();
  try {
    await assert.rejects(p.operation({op:'thinking',level:'high'}),/injected settings write failure/);
    assert.equal(readFileSync(join(tools,'frame.env'),'utf8'),original);
    assert.equal((await p.conversation.agent(ctx)).thinkingLevel,'off');
    assert.equal(p.closing,false);
  } finally {
    rename.mock.restore();syncBuiltinESMExports();
    await p.close();
  }
});
test('a synchronization failure after publishing settings closes the frame and reconciles on reopen',async t=>{
  const f=fixture();
  const p=await Frame.open('settings-sync-failure',f.models,model);
  const id=p.conversation.id,tools=paths(p.name).tools;
  const originalSync=fs.fsyncSync;
  const sync=t.mock.method(fs,'fsyncSync',(descriptor:number)=>{
    if(fs.fstatSync(descriptor).isDirectory()) throw Error('injected directory sync failure');
    originalSync(descriptor);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(p.operation({op:'thinking',level:'high'}),/saved but synchronization failed/);
    assert.equal(p.closing,true);
    assert.deepEqual(readFrameSettings(tools),{model,thinkingLevel:'high',messaging:true});
  } finally {
    sync.mock.restore();syncBuiltinESMExports();
    await p.close();
  }
  const reopened=await Frame.open(p.name,f.models,model);
  try {
    assert.equal(reopened.conversation.id,id);
    assert.equal((await reopened.conversation.agent(ctx)).thinkingLevel,'high');
  } finally {await reopened.close();}
});
test('saved settings reconcile after a failed runtime projection',async t=>{
  const f=fixture();
  const p=await Frame.open('settings-projection-failure',f.models,model);
  const id=p.conversation.id,tools=paths(p.name).tools;
  const configure=t.mock.method(p.conversation,'configure',async()=>{throw Error('injected projection failure');});
  try {
    await assert.rejects(p.operation({op:'thinking',level:'high'}),/injected projection failure/);
    assert.equal(p.closing,true);
    assert.deepEqual(readFrameSettings(tools),{model,thinkingLevel:'high',messaging:true});
  } finally {configure.mock.restore();await p.close();}
  const reopened=await Frame.open(p.name,f.models,model);
  try {
    assert.equal(reopened.conversation.id,id);
    assert.equal((await reopened.conversation.agent(ctx)).thinkingLevel,'high');
  } finally {await reopened.close();}
});
test('concurrent frame setting updates serialize without losing model or thinking changes',async()=>{
  const alternate={provider:'test',modelId:'alternate'};
  const provider=fauxProvider({provider:'test',models:[{id:model.modelId},{id:alternate.modelId}]});
  const models=createModels();models.setProvider(provider.provider);
  const p=await Frame.open('settings-concurrent',models,model);
  try {
    await Promise.all([
      p.operation({op:'model',...alternate}),
      p.operation({op:'thinking',level:'high'}),
      p.operation({op:'model',...model}),
    ]);
    assert.deepEqual(readFrameSettings(paths(p.name).tools),{model,thinkingLevel:'high',messaging:true});
    assert.deepEqual((await p.conversation.agent(ctx)).model,model);
    assert.equal((await p.conversation.agent(ctx)).thinkingLevel,'high');
    assert.equal(provider.state.callCount,0);
  } finally {await p.close();}
});
test('provider switching preserves running tools, queued input, memory and the saved conversation',async()=>{
  const effect=join(directory,'model-effect'),release=join(directory,'model-release');
  const alternate={provider:'second',modelId:'test-alternate'};
  const faux=fauxProvider({provider:'test',models:[{id:'test'},{id:alternate.modelId}],tokensPerSecond:10000});
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('bash',{command:`echo once >> '${effect}'; while [ ! -f '${release}' ]; do sleep .02; done`})],{stopReason:'toolUse'})
  ]);
  const models=createModels();models.setProvider(faux.provider);
  const second=fauxProvider({provider:alternate.provider,models:[{id:alternate.modelId}],tokensPerSecond:10000});
  second.setResponses([fauxAssistantMessage('switched answer'),fauxAssistantMessage('queued answer'),fauxAssistantMessage('reopened answer')]);
  models.setProvider(second.provider);
  const p=await Frame.open('model-switch',models,model);
  const other=await Frame.open('model-other',fixture().models,model);
  try {
    const conversationId=p.conversation.id;
    await p.operation({op:'memory',field:'notes',content:'preserved model memory'});
    await p.operation({op:'thinking',level:'high'});
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
    assert.deepEqual(history.filter(m=>m.role==='assistant').map(m=>m.provider),['test','second','second']);
    assert.equal(readFileSync(effect,'utf8'),'once\n');
    await p.close();
    const reopened=await Frame.open('model-switch',models,model);
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
test('native model thinking preferences apply on selection and preserve explicit saved choices',async()=>{
  const settingsDir=join(directory,'.pi','agent'),settingsFile=join(settingsDir,'settings.json');
  mkdirSync(settingsDir,{recursive:true});
  const previous=existsSync(settingsFile)?readFileSync(settingsFile,'utf8'):undefined;
  const selected={provider:'preferences',modelId:'owner/thinking'};
  const other={provider:'preferences',modelId:'unconfigured'};
  const provider=fauxProvider({provider:selected.provider,models:[{id:selected.modelId,reasoning:true},{id:other.modelId,reasoning:true}]});
  const models=createModels();models.setProvider(provider.provider);
  writeFileSync(settingsFile,JSON.stringify({modelThinkingLevels:{[`${selected.provider}/${selected.modelId}`]:'medium'}}));
  let p:Awaited<ReturnType<typeof Frame.open>>|undefined;
  try {
    p=await Frame.open('thinking-preferences',models,selected);
    const id=p.conversation.id;
    assert.equal((await p.conversation.agent(ctx)).thinkingLevel,'medium');
    await p.operation({op:'thinking',level:'high'});
    await p.close();p=undefined;
    p=await Frame.open('thinking-preferences',models,other);
    assert.equal(p.conversation.id,id);
    assert.deepEqual((await p.conversation.agent(ctx)).model,selected);
    assert.equal((await p.conversation.agent(ctx)).thinkingLevel,'high');
    await p.operation({op:'model',...other});
    assert.equal((await p.conversation.agent(ctx)).thinkingLevel,'high');
    await p.operation({op:'model',...selected});
    assert.equal((await p.conversation.agent(ctx)).thinkingLevel,'medium');
    await p.operation({op:'thinking',level:null});
    await p.close();p=undefined;
    p=await Frame.open('thinking-preferences',models,other);
    assert.equal((await p.conversation.agent(ctx)).thinkingLevel,'medium');
    assert.equal(provider.state.callCount,0);
  }finally{
    await p?.close();
    if(previous===undefined)rmSync(settingsFile,{force:true});else writeFileSync(settingsFile,previous);
  }
});
test('compaction profiles follow model switches and reload when a frame reopens',async()=>{
  const settingsDir=join(directory,'.pi','agent'),settingsFile=join(settingsDir,'settings.json');
  mkdirSync(settingsDir,{recursive:true});
  const previous=existsSync(settingsFile)?readFileSync(settingsFile,'utf8'):undefined;
  const alternate={provider:'compaction-other',modelId:'owner/compact'};
  const profiles={compaction:{modelOverrides:{
    'test/test':{reserveTokens:8192,keepRecentTokens:12000},
    [`${alternate.provider}/${alternate.modelId}`]:{reserveTokens:16384,keepRecentTokens:4000},
  }}};
  writeFileSync(settingsFile,JSON.stringify(profiles));
  const first=fauxProvider({provider:'test',models:[{id:'test',contextWindow:32768,maxTokens:4000}],tokensPerSecond:10000});
  first.setResponses([fauxAssistantMessage('first answer')]);
  const second=fauxProvider({provider:alternate.provider,models:[{id:alternate.modelId,contextWindow:32768,maxTokens:4000}],tokensPerSecond:10000});
  second.setResponses([fauxAssistantMessage('summary of older history'),fauxAssistantMessage('switched answer'),fauxAssistantMessage('next answer'),fauxAssistantMessage('reopened answer')]);
  const models=createModels();models.setProvider(first.provider);models.setProvider(second.provider);
  let p:Awaited<ReturnType<typeof Frame.open>>|undefined;
  const seed=async(frame:Awaited<ReturnType<typeof Frame.open>>)=>{
    for(let n=0;n<3;n++)await frame.conversation.submit({type:'write',entry:{kind:'fixture',model:[{role:'user',content:`history ${n}: ${'x'.repeat(24000)}`,timestamp:Date.now()}]}},ctx);
  };
  const submit=async(frame:Awaited<ReturnType<typeof Frame.open>>,content:string)=>{
    assert.equal((await (await frame.conversation.submit({type:'input',content},ctx)).wait(ctx)).status,'done');
    await frame.conversation.waitForIdle(ctx);
  };
  try {
    p=await Frame.open('compaction-profile',models,model);
    const id=p.conversation.id;
    await seed(p);
    await submit(p,'continue');
    assert.equal(first.state.callCount,1);
    assert.equal((await p.conversation.context(ctx)).head,undefined);
    await p.operation({op:'model',...alternate});
    await submit(p,'use the selected model');
    const head=(await p.conversation.context(ctx)).head;
    assert.ok(head);
    assert.equal(second.state.callCount,2);
    await submit(p,'continue after compaction');
    assert.equal(second.state.callCount,3);
    assert.deepEqual((await p.conversation.context(ctx)).head,head);
    await p.close();p=undefined;
    writeFileSync(settingsFile,JSON.stringify({compaction:{...profiles.compaction,enabled:false}}));
    p=await Frame.open('compaction-profile',models,model);
    assert.equal(p.conversation.id,id);
    assert.deepEqual((await p.conversation.agent(ctx)).model,alternate);
    await seed(p);
    await submit(p,'settings changed while closed');
    assert.equal(second.state.callCount,4);
    assert.deepEqual((await p.conversation.context(ctx)).head,head);
  }finally{
    await p?.close();
    if(previous===undefined)rmSync(settingsFile,{force:true});else writeFileSync(settingsFile,previous);
  }
});
test('Makefile sources reach the first provider request and refresh after tools without reopening',async()=>{
  const dirs=prepare('live-tools');
  assert.equal(readFileSync(join(dirs.tools,'SCOPE.md'),'utf8'),'');
  const files={shared:join(directory,'shared','Makefile'),frame:join(dirs.tools,'Makefile')};
  const originalShared=readFileSync(files.shared,'utf8');
  const initial={shared:'help:\n\t@echo shared\nhidden-target:\n\t@printf "%s\\n" "$(value INPUT)"\n',frame:readFileSync(files.frame,'utf8')};
  const updated={shared:'help:\n\t@echo shared\nnew-shared-target:\n\t@echo shared-ready\n',frame:'help:\n\t@echo frame\nnew-frame-target:\n\t@echo frame-ready\n'};
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
    for(const name of ['shared','frame'] as const)assert.ok(system.includes(`Source: ${files[name]}\n\n${sources[name]}`));
  };
  const f=fixture([
    async context=>{
      verify(await serialized(context),initial);
      return fauxAssistantMessage(Object.entries(updated).map(([name,content])=>fauxToolCall('write',{path:files[name as keyof typeof files],content})),{stopReason:'toolUse'});
    },
    async context=>{
      const system=await serialized(context);verify(system,updated);
      for(const name of ['shared','frame'] as const)assert.ok(!system.includes(`Source: ${files[name]}\n\n${initial[name]}`));
      return fauxAssistantMessage('updated sources verified');
    },
    async context=>{
      const system=await serialized(context);
      assert.ok(system.includes(`Source: ${files.shared}\n\nERROR reading Makefile:`));
      assert.match(system,/ENOENT/);
      assert.ok(!system.includes(updated.shared));
      assert.ok(system.includes(`Source: ${files.frame}\n\n${updated.frame}`));
      return fauxAssistantMessage('missing source reported');
    }
  ]);
  writeFileSync(files.shared,initial.shared);
  const p=await Frame.open('live-tools',f.models,model),errors:unknown[]=[];
  p.onError=error=>errors.push(error);
  try {
    assert.equal(f.faux.state.callCount,0);
    assert.equal((await (await p.conversation.submit({type:'input',content:'inspect and update tools'},ctx)).wait(ctx)).status,'done');
    assert.equal(f.faux.state.callCount,2);
    assert.deepEqual(await p.operation({op:'tools'}),updated);
    for(const name of ['shared','frame'] as const)assert.equal(readFileSync(files[name],'utf8'),updated[name]);
    rmSync(files.shared);
    assert.equal((await (await p.conversation.submit({type:'input',content:'inspect tools again'},ctx)).wait(ctx)).status,'done');
    assert.equal(f.faux.state.callCount,3);
    assert.ok(errors.some(error=>String(error).includes(files.shared) && String(error).includes('ENOENT')));
    await assert.rejects(p.operation({op:'tools'}),/ENOENT/);
  }finally{writeFileSync(files.shared,originalShared);await p.close();}
});
test('frame scope survives compaction and loads independently on reopening',async()=>{
  const a=prepare('instructions-a'),b=prepare('instructions-b');
  assert.equal(readFileSync(join(a.tools,'SCOPE.md'),'utf8'),'');
  writeFileSync(join(directory,'AGENTS.md'),'root-only-instructions');
  writeFileSync(join(a.tools,'SCOPE.md'),'alpha-only-instructions');
  writeFileSync(join(b.tools,'SCOPE.md'),'beta-only-instructions');
  prepare('instructions-a');assert.equal(readFileSync(join(a.tools,'SCOPE.md'),'utf8'),'alpha-only-instructions');
  const verify=(tools:string,expected:string,excluded:string[],guidance='shared-frame-guidance')=>async(context:TranscriptContext)=>{
    const sections=Object.assign({},...context.messages.filter(m=>m.role==='system').map(m=>m.sections));
    const system=JSON.stringify(sections);
    for(const [name,file] of [['shared',join(directory,'shared','Makefile')],['frame',join(tools,'Makefile')]])assert.ok(sections[`${name}-tools`].includes(`Source: ${file}\n\n${readFileSync(file,'utf8')}`));
    assert.ok(system.includes(guidance));
    assert.ok(system.includes(expected));for(const text of excluded)assert.ok(!system.includes(text));
    return fauxAssistantMessage('instructions verified');
  };
  const f=fixture([fauxAssistantMessage('older history summarized'),verify(a.tools,'alpha-only-instructions',['root-only-instructions','beta-only-instructions','changed-alpha-instructions']),verify(a.tools,'alpha-only-instructions',['changed-alpha-instructions','changed-shared-frame-guidance'])]);
  const p=await Frame.open('instructions-a',f.models,model);
  const q=await Frame.open('instructions-b',fixture([verify(b.tools,'beta-only-instructions',['root-only-instructions','alpha-only-instructions','changed-shared-frame-guidance'])]).models,model);
  try {
    assert.equal(f.faux.state.callCount,0);
    await p.operation({op:'memory',field:'notes',content:'saved independently'});
    for(const content of ['old-history-marker','recent history '.repeat(10000)])await p.conversation.submit({type:'write',entry:{kind:'fixture',model:[{role:'user',content,timestamp:Date.now()}]}},ctx);
    const task=await p.conversation.compact(undefined,ctx);await p.harness.waitForTask(task,ctx);
    assert.ok((await p.conversation.context(ctx)).head);
    assert.equal((await (await p.conversation.submit({type:'input',content:'after compaction'},ctx)).wait(ctx)).status,'done');
    assert.equal((await p.harness.snapshot(Memory,p.conversation.id,ctx))?.notes,'saved independently');
    writeFileSync(join(a.tools,'SCOPE.md'),'changed-alpha-instructions');
    writeFileSync(join(directory,'FRAME.md'),'changed-shared-frame-guidance');
    assert.equal((await (await p.conversation.submit({type:'input',content:'same process'},ctx)).wait(ctx)).status,'done');
    assert.equal((await (await q.conversation.submit({type:'input',content:'other frame'},ctx)).wait(ctx)).status,'done');
    await p.close();
    const reopened=await Frame.open('instructions-a',fixture([verify(a.tools,'changed-alpha-instructions',['alpha-only-instructions','beta-only-instructions'],'changed-shared-frame-guidance')]).models,model);
    try {assert.equal((await (await reopened.conversation.submit({type:'input',content:'reopened'},ctx)).wait(ctx)).status,'done');}finally{await reopened.close();}
  }finally{await p.close();await q.close();writeFileSync(join(directory,'FRAME.md'),'shared-frame-guidance');}
});
test('blank boot remains idle and unreadable instructions fail without retaining the lock',async()=>{
  const dirs=prepare('instructions-invalid');const file=join(dirs.tools,'SCOPE.md');
  rmSync(file);mkdirSync(file);
  await assert.rejects(Frame.open('instructions-invalid',fixture().models,model),/EISDIR/);
  rmSync(file,{recursive:true});writeFileSync(file,'');writeFileSync(join(dirs.tools,'BOOT.md'),' \n\t');
  const f=fixture();const p=await Frame.open('instructions-invalid',f.models,model);
  try {await p.tick();assert.equal(f.faux.state.callCount,0);}finally{await p.close();}
});
test('startup queues behind saved user work and resumes its original durable task',async()=>{
  const f=fixture([fauxAssistantMessage('working '.repeat(100))],10);
  const p=await Frame.open('startup',f.models,model);
  await p.operation({op:'input',content:'first user work'});await until(()=>f.faux.state.callCount===1);
  await p.operation({op:'input',content:'queued user work'});await p.close();
  const dirs=prepare('startup');writeFileSync(join(dirs.tools,'BOOT.md'),'restore configured workspace');
  writeFileSync(join(dirs.tools,'Makefile'),'close:\n\t@echo closed >> closed\n');
  const slow=fixture([fauxAssistantMessage('resuming '.repeat(100))],10);
  const q=await Frame.open('startup',slow.models,model);
  await until(async()=>(await q.harness.inspect(ctx)).submissions.some(s=>s.requestId?.startsWith('startup:')??false));
  const pending=(await q.harness.inspect(ctx)).tasks.filter(t=>t.record.kind==='philby.startup');assert.equal(pending.length,1);
  const startupId=pending[0].record.id;await q.close();
  const r=await Frame.open('startup',fixture([fauxAssistantMessage('resumed'),fauxAssistantMessage('queued complete'),fauxAssistantMessage('startup complete')]).models,model);
  try {
    await until(async()=>(await r.harness.getTask(startupId,ctx))?.state.status==='terminal');
    await r.conversation.waitForIdle(ctx);
    const entries=(await r.conversation.context(ctx)).entries;
    assert.equal(entries.filter(e=>e.kind==='philby.startup').length,1);
    const inputs=(await r.conversation.context(ctx)).messages.filter(m=>m.role==='user').map(m=>JSON.stringify(m.content));
    assert.deepEqual(inputs.map(content=>content.includes('restore configured workspace')?'startup':content.includes('queued user work')?'queued':'first'),['first','queued','startup']);
    assert.deepEqual(await r.operation({op:'close'}),{closed:true});
    await r.close();assert.equal(readFileSync(join(dirs.tools,'closed'),'utf8'),'closed\nclosed\n');
  }finally{await r.close();}
});
test('close waits for teardown and exposes its failure while releasing resources',async()=>{
  const dirs=prepare('close-failure');writeFileSync(join(dirs.tools,'BOOT.md'),'restore');
  writeFileSync(join(dirs.tools,'Makefile'),'close:\n\t@echo teardown-failed >&2; echo closed >> closed; exit 7\n');
  const p=await Frame.open('close-failure',fixture().models,model);
  await assert.rejects(request('close-failure',{op:'close'}),/teardown-failed/);
  assert.equal(readFileSync(join(dirs.tools,'closed'),'utf8'),'closed\n');
  await assert.rejects(p.close(),/teardown-failed/);
  assert.equal(readFileSync(join(dirs.tools,'closed'),'utf8'),'closed\n');
  writeFileSync(join(dirs.tools,'Makefile'),'close:\n\t@sleep .1; echo closed >> closed\n');
  const q=await Frame.open('close-failure',fixture().models,model);
  try {assert.deepEqual(await request('close-failure',{op:'close'}),{closed:true});assert.equal(readFileSync(join(dirs.tools,'closed'),'utf8'),'closed\nclosed\n');}finally{await q.close();}
});
test('isolated memory, tools, durable conversation and lifetime lock',async()=>{
  const a=fixture([async context=>{assert.ok(JSON.stringify(context).includes('remember-alpha'));return fauxAssistantMessage('alpha answer');}]);
  const b=fixture([fauxAssistantMessage('beta answer')]);
  const alpha=await Frame.open('alpha',a.models,model);const beta=await Frame.open('beta',b.models,model);
  try {
    await assert.rejects(Frame.open('alpha',a.models,model),/already running/);
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
    const revived=await Frame.open('alpha',fixture().models,model);
    try {assert.equal((await revived.harness.snapshot(Memory,revived.conversation.id,ctx))?.notes,'remember-alpha');assert.ok(JSON.stringify(await revived.operation({op:'capture'})).includes('alpha answer'));}finally{await revived.close();}
  } finally {await alpha.close();await beta.close();}
});
test('receiving frame mailbox survives closed frames without creating tools and deduplicates retries',async()=>{
  const e=envelope('sender','receiving-frame','hello',{id:'stable-message'});
  const mailbox=new Store(e.to);mailbox.accept(e);mailbox.close();
  for(const file of ['SCOPE.md','Makefile','.frame-type'])assert.equal(existsSync(join(paths(e.to).tools,file)),false);
  assert.equal(paths(e.to).state,join(paths(e.to).tools,'.state'));
  assert.equal(existsSync(paths(e.from).state),false);
  assert.equal(existsSync(join(paths(e.to).state,'durable.sqlite')),false);
  const receiving=await Frame.open(e.to,fixture([fauxAssistantMessage('received')]).models,model);
  try {
    await until(async()=>JSON.stringify(await receiving.operation({op:'capture'})).includes('received'));
    await receiving.operation({op:'receive',envelope:e});await receiving.tick();
    const entries=await receiving.conversation.context(ctx);assert.equal(entries.messages.filter(m=>m.role==='user').length,1);
    assert.throws(()=>receiving.store.accept({...e,content:'conflict'}),/conflict/);
  } finally {await receiving.close();}
});
test('frame send persists directly in the receiving frame mailbox with its input mode',async()=>{
  const sending=await Frame.open('sending-frame',fixture().models,model);
  try {
    assert.equal(sending.messaging,true);
    assert.deepEqual(await sending.operation({op:'send',to:'receiving-closed',content:'focus here',id:'steering',mode:'steer'}),{accepted:'steering'});
    const receiving=new Store('receiving-closed');
    try {assert.deepEqual(receiving.pending(),[envelope('sending-frame','receiving-closed','focus here',{id:'steering',mode:'steer'})]);}
    finally {receiving.close();}
    assert.equal(sending.store.db.prepare("SELECT name FROM sqlite_master WHERE name='outbox'").get(),undefined);
  }finally{await sending.close();}
});
test('disabled messaging rejects messages and reports through live operations and closed mailboxes',async()=>{
  const disabled='messaging-disabled',enabled='messaging-enabled';
  writeFrameSettings(prepare(disabled).tools,{model,messaging:false});
  const f=fixture();
  const off=await Frame.open(disabled,f.models,model);
  const on=await Frame.open(enabled,fixture().models,model);
  try {
    assert.equal(off.messaging,false);
    for(const kind of ['input','update'] as const) {
      await assert.rejects(off.operation({op:'send',to:enabled,content:'outgoing blocked',kind}),/messaging.*disabled/i);
      await assert.rejects(on.operation({op:'send',to:disabled,content:'incoming blocked',kind}),/messaging.*disabled/i);
      await assert.rejects(request(disabled,{op:'receive',envelope:envelope(enabled,disabled,'receive blocked',{kind})}),/messaging.*disabled/i);
      assert.throws(()=>on.store.accept(envelope(disabled,enabled,'direct outgoing blocked',{kind})),/messaging.*disabled/i);
    }
    await assert.rejects(off.operation({op:'updates',mark:true}),/messaging.*disabled/i);
    assert.deepEqual(off.store.pending(),[]);
    assert.deepEqual(on.store.pending(),[]);
    assert.equal(f.faux.state.callCount,0);
    await off.close();
    const mailbox=new Store(disabled);
    try {
      for(const kind of ['input','update'] as const)assert.throws(()=>mailbox.accept(envelope(enabled,disabled,'closed incoming blocked',{kind})),/messaging.*disabled/i);
      assert.deepEqual(mailbox.pending(),[]);
    } finally {mailbox.close();}
    for(const command of ['send','report'])for(const [from,to] of [[enabled,disabled],[disabled,enabled]]) {
      const result=await runCli(command,{slug:to,from,PROMPT:'CLI blocked message'});
      assert.notEqual(result.code,0);
      assert.match(result.stderr,/messaging.*disabled/i);
    }
    assert.deepEqual(on.store.pending(),[]);
  } finally {await off.close();await on.close();}
});
test('disabled messaging retains pending work and reports without delivering or injecting them until reenabled',async()=>{
  const name='messaging-retained',tools=prepare(name).tools;
  const original=await Frame.open(name,fixture().models,model);
  const id=original.conversation.id;
  const oldReport=envelope('sender',name,'retained passive report',{id:'retained-old-report',kind:'update'});
  await original.operation({op:'receive',envelope:oldReport});
  await original.tick();
  await original.operation({op:'memory',field:'notes',content:'retained independent memory'});
  await original.close();
  const input=envelope('sender',name,'retained pending input',{id:'retained-input'});
  const report=envelope('sender',name,'retained pending report',{id:'retained-new-report',kind:'update'});
  const mailbox=new Store(name);
  try {mailbox.accept(input);mailbox.accept(report);} finally {mailbox.close();}
  writeFrameSettings(tools,{...readFrameSettings(tools)!,messaging:false});
  const f=fixture([context=>{
    const sections=Object.assign({},...context.messages.filter(m=>m.role==='system').map(m=>m.sections));
    assert.equal(Object.hasOwn(sections,'unread-updates'),false);
    assert.ok(!JSON.stringify(context).includes(oldReport.content));
    assert.ok(!JSON.stringify(context).includes(report.content));
    return fauxAssistantMessage('direct input still works');
  }]);
  const off=await Frame.open(name,f.models,model);
  try {
    assert.equal(off.conversation.id,id);
    assert.equal(off.messaging,false);
    await off.tick();
    assert.deepEqual(off.store.pending(),[input,report]);
    assert.equal(f.faux.state.callCount,0);
    assert.equal((await off.harness.snapshot(Memory,id,ctx))?.notes,'retained independent memory');
    await assert.rejects(off.operation({op:'updates',mark:true}),/messaging.*disabled/i);
    await assert.rejects(off.operation({op:'new'}),/pending delivery/);
    assert.deepEqual(off.store.updates(),[{...oldReport,seen:false}]);
    assert.equal((await (await off.conversation.submit({type:'input',content:'direct request'},ctx)).wait(ctx)).status,'done');
    assert.deepEqual(off.store.pending(),[input,report]);
  } finally {await off.close();}
  writeFrameSettings(tools,{...readFrameSettings(tools)!,messaging:true});
  const resumedFixture=fixture([context=>{
    assert.ok(JSON.stringify(context).includes(oldReport.content));
    assert.ok(JSON.stringify(context).includes(report.content));
    return fauxAssistantMessage('pending work delivered');
  }]);
  const resumed=await Frame.open(name,resumedFixture.models,model);
  try {
    await resumed.conversation.waitForIdle(ctx);
    assert.equal(resumed.conversation.id,id);
    assert.deepEqual(resumed.store.pending(),[]);
    assert.equal(resumedFixture.faux.state.callCount,1);
    assert.deepEqual(resumed.store.updates(),[{...oldReport,seen:false},{...report,seen:false}]);
    await resumed.operation({op:'receive',envelope:input});
    await resumed.operation({op:'receive',envelope:report});
    await resumed.tick();
    await resumed.conversation.waitForIdle(ctx);
    assert.equal(resumedFixture.faux.state.callCount,1);
    const history=(await resumed.conversation.context(ctx)).messages;
    assert.equal(history.filter(m=>m.role==='user' && JSON.stringify(m.content).includes(input.content)).length,1);
  } finally {await resumed.close();}
});
test('model and thinking selection preserve disabled messaging across reopening',async()=>{
  const name='messaging-settings',alternate={provider:'test',modelId:'messaging-alternate'};
  const provider=fauxProvider({provider:'test',models:[{id:model.modelId,reasoning:true},{id:alternate.modelId,reasoning:true}]});
  const models=createModels();models.setProvider(provider.provider);
  const tools=prepare(name).tools;
  writeFrameSettings(tools,{model,messaging:false});
  const frame=await Frame.open(name,models,model);
  const id=frame.conversation.id;
  try {
    await frame.operation({op:'model',...alternate});
    assert.equal(readFrameSettings(tools)?.messaging,false);
    await frame.operation({op:'thinking',level:'high'});
    assert.deepEqual(readFrameSettings(tools),{model:alternate,thinkingLevel:'high',messaging:false});
    await frame.operation({op:'thinking',level:null});
    assert.deepEqual(readFrameSettings(tools),{model:alternate,messaging:false});
  } finally {await frame.close();}
  const reopened=await Frame.open(name,models,model);
  try {
    assert.equal(reopened.conversation.id,id);
    assert.equal(reopened.messaging,false);
    assert.deepEqual((await reopened.conversation.agent(ctx)).model,alternate);
    assert.equal(provider.state.callCount,0);
  } finally {await reopened.close();}
});
test('CLI messaging changes require a closed frame and retain saved settings and conversation',async()=>{
  const name='messaging-cli',f=fixture();
  const frame=await Frame.open(name,f.models,model);
  const id=frame.conversation.id,tools=paths(name).tools,file=join(tools,'frame.env');
  let history:unknown;
  try {
    await frame.operation({op:'thinking',level:'high'});
    await frame.operation({op:'memory',field:'notes',content:'toggle preserves memory'});
    assert.equal((await (await frame.conversation.submit({type:'input',content:'toggle preserves history'},ctx)).wait(ctx)).status,'done');
    history=await frame.operation({op:'capture'});
    const query=await runCli('messaging',{slug:name,ENABLED:undefined});
    assert.equal(query.code,0,query.stderr);
    assert.deepEqual(JSON.parse(query.stdout),{slug:name,enabled:true,running:true,active:true});
    const before=readFileSync(file,'utf8');
    const runningChange=await runCli('messaging',{slug:name,ENABLED:'false'});
    assert.notEqual(runningChange.code,0);
    assert.match(runningChange.stderr,/already running|closed/i);
    assert.equal(readFileSync(file,'utf8'),before);
  } finally {await frame.close();}
  const before=readFileSync(file,'utf8');
  const invalid=await runCli('messaging',{slug:name,ENABLED:'0'});
  assert.notEqual(invalid.code,0);
  assert.match(invalid.stderr,/ENABLED/);
  assert.equal(readFileSync(file,'utf8'),before);
  const changed=await runCli('messaging',{slug:name,ENABLED:'false'});
  assert.equal(changed.code,0,changed.stderr);
  assert.equal(JSON.parse(changed.stdout).enabled,false);
  assert.deepEqual(readFrameSettings(tools),{model,thinkingLevel:'high',messaging:false});
  assert.equal(f.faux.state.callCount,1);
  const reopened=await Frame.open(name,f.models,model);
  try {
    assert.equal(reopened.conversation.id,id);
    assert.equal(reopened.messaging,false);
    assert.deepEqual(await reopened.operation({op:'capture'}),history);
    assert.equal((await reopened.harness.snapshot(Memory,id,ctx))?.notes,'toggle preserves memory');
    assert.equal(f.faux.state.callCount,1);
  } finally {await reopened.close();}
});
test('concurrent writers cannot accept conflicting content for one receiving frame request ID',{timeout:10000},async()=>{
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
  const f=fixture();const p=await Frame.open('updates',f.models,model);
  const e=envelope('alpha','updates','decision needed',{kind:'update'});
  await p.operation({op:'receive',envelope:e});await p.tick();assert.equal(f.faux.state.callCount,0);await p.close();
  const q=await Frame.open('updates',fixture().models,model);
  try {const updates=await q.operation({op:'updates',mark:true}) as any[];assert.equal(updates.length,1);assert.equal(updates[0].seen,false);assert.equal(q.store.updates()[0].seen,true);}finally{await q.close();}
});
test('close preserves queued work',async()=>{
  const f=fixture([fauxAssistantMessage('slow answer '.repeat(100)),fauxAssistantMessage('queued answer')],10);
  const p=await Frame.open('queue',f.models,model);
  await p.operation({op:'input',id:'one',content:'first'});
  await until(()=>f.faux.state.callCount>0);
  await p.operation({op:'input',id:'two',content:'second'});
  await p.close();
  const q=await Frame.open('queue',fixture([fauxAssistantMessage('resumed'),fauxAssistantMessage('follow up')]).models,model);
  try {await q.conversation.waitForIdle(ctx);const text=JSON.stringify(await q.operation({op:'capture'}));assert.ok(text.includes('second'));}finally{await q.close();}
});
test('unsafe side effect interrupted by close is not repeated',async()=>{
  const file=join(directory,'effect');
  const f=fixture([fauxAssistantMessage([fauxToolCall('bash',{command:`echo once >> '${file}'; sleep 30`})],{stopReason:'toolUse'})]);
  const p=await Frame.open('unsafe',f.models,model);
  await p.operation({op:'input',content:'do side effect'});
  await until(()=>{try{return readFileSync(file,'utf8').includes('once');}catch{return false;}});
  await p.close();
  const q=await Frame.open('unsafe',fixture([fauxAssistantMessage('inspect interrupted call')]).models,model);
  try {await q.conversation.waitForIdle(ctx);assert.equal(readFileSync(file,'utf8'),'once\n');assert.match(JSON.stringify(await q.operation({op:'capture'})),/interrupt/i);}finally{await q.close();}
});
test('native tools use frame cwd and shared Make capabilities',async()=>{
  const f=fixture([fauxAssistantMessage([fauxToolCall('bash',{command:`pwd; make -C '${directory}/shared' help`})],{stopReason:'toolUse'}),fauxAssistantMessage('tools verified')]);
  const p=await Frame.open('tools',f.models,model);
  try {await (await p.conversation.submit({type:'input',content:'tools'},ctx)).wait(ctx);const transcript=JSON.stringify(await p.operation({op:'capture'}));assert.ok(transcript.includes(paths('tools').tools));assert.ok(transcript.includes('shared-tool'));}finally{await p.close();}
});
test('stop preserves follow-ups without automatically restarting them',async()=>{
  const f=fixture([fauxAssistantMessage('slow '.repeat(100)),fauxAssistantMessage('next response'),fauxAssistantMessage('still available')],10);
  const p=await Frame.open('stop',f.models,model);
  try {
    await p.operation({op:'input',content:'first'});await until(()=>f.faux.state.callCount===1);
    await p.operation({op:'input',content:'follow-up'});await p.operation({op:'stop'});
    await p.tick();
    assert.equal(f.faux.state.callCount,1);
    assert.ok((await p.harness.inspect(ctx)).submissions.some(s=>s.status==='queued' && s.type==='input'));
    assert.equal((await (await p.conversation.submit({type:'input',content:'continue'},ctx)).wait(ctx)).status,'done');
  }finally{await p.close();}
});
test('SIGKILL releases lifetime lock and unsafe tool intent recovers without replay',async()=>{
  const file=join(directory,'crash-effect');
  const moduleUrl=new URL('../src/frame.js',import.meta.url).href;
  const script=`import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
    const {Frame}=await import(${JSON.stringify(moduleUrl)});
    const f=fauxProvider({provider:'test',models:[{id:'test'}]});
    f.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:${JSON.stringify(`echo once >> '${file}'; sleep 1`)}})],{stopReason:'toolUse'})]);
    const m=createModels();m.setProvider(f.provider);
    const p=await Frame.open('crash',m,{provider:'test',modelId:'test'});
    await p.operation({op:'input',content:'side effect'});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{env:process.env,stdio:'ignore'});
  try {
    await until(()=>{try{return readFileSync(file,'utf8')==='once\n';}catch{return false;}});
    const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;
    const p=await Frame.open('crash',fixture([fauxAssistantMessage('inspect before retry')]).models,model);
    try {await p.conversation.waitForIdle(ctx);assert.equal(readFileSync(file,'utf8'),'once\n');assert.match(JSON.stringify(await p.operation({op:'capture'})),/interrupt/i);}finally{await p.close();}
  }finally{child.kill('SIGKILL');}
});


test('delivery recovers after receiving frame Durable admission before marking its mailbox placed',async()=>{
  const e=envelope('boundary-sender','boundary-receiving','exactly once',{id:'boundary'});
  const p=await Frame.open(e.to,fixture([fauxAssistantMessage('partial '.repeat(100))],10).models,model);
  p.store.accept(e);
  await p.conversation.submit({type:'input',content:`[From ${e.from}]\n${e.content}`,requestId:`message:${e.id}`,whenBusy:e.mode},ctx);
  assert.equal(p.store.pending().length,1);
  await p.close();
  const q=await Frame.open(e.to,fixture([fauxAssistantMessage('recovered')]).models,model);
  try {
    await q.conversation.waitForIdle(ctx);
    assert.equal((await q.conversation.context(ctx)).messages.filter(m=>m.role==='user').length,1);
    assert.equal(q.store.pending().length,0);
  }finally{await q.close();}
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
        fauxToolCall('bash',{command:`cat '${join(directory,'FRAME.md')}'`}),
        fauxToolCall('edit',{path:join(directory,'FRAME.md'),edits:[{oldText:'shared',newText:'changed'}]})
      ],{stopReason:'toolUse'});
    },
    fauxAssistantMessage('plan presented')
  ]);
  const p=await Frame.open('plan-mode',f.models,model);
  try {
    await p.operation({op:'plan-set',active:true});
    assert.deepEqual(await p.operation({op:'plan'}),{active:true,plan:''});
    assert.equal((await (await p.conversation.submit({type:'input',content:'design a change'},ctx)).wait(ctx)).status,'done');
    assert.equal(existsSync(target),false);
    assert.equal(readFileSync(join(directory,'FRAME.md'),'utf8'),'shared-frame-guidance');
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
      fauxToolCall('read',{path:join(directory,'FRAME.md')})
    ],{stopReason:'toolUse'}),
    async(context:TranscriptContext)=>{
      const last=context.messages.filter(m=>m.role==='toolResult').at(-1);
      assert.ok(last);
      assert.equal(last.isError,false);
      assert.equal(last.toolName,'read');
      assert.ok(JSON.stringify(last.content).includes('shared-frame-guidance'));
      return fauxAssistantMessage('done');
    }
  ]);
  const p=await Frame.open('plan-bypass',f.models,model);
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
  const p=await Frame.open('plan-busy',f.models,model);
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
  const p=await Frame.open('plan-init',f.models,model);
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
  const p=await Frame.open('plan-context',f.models,model);
  try {
    await p.operation({op:'plan-set',active:true});
    await (await p.conversation.submit({type:'input',content:'plan something'},ctx)).wait(ctx);
    await p.operation({op:'plan-set',active:false,plan:'1. implement the feature'});
    await (await p.conversation.submit({type:'input',content:'go ahead'},ctx)).wait(ctx);
  }finally{await p.close();}
});
test('plan persists across frame reopen',async()=>{
  const f=fixture([fauxAssistantMessage('ok')]);
  let p=await Frame.open('plan-persist',f.models,model);
  try {
    await p.operation({op:'plan-set',active:false,plan:'saved plan text'});
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:'saved plan text'});
  }finally{await p.close();}
  p=await Frame.open('plan-persist',f.models,model);
  try {
    assert.deepEqual(await p.operation({op:'plan'}),{active:false,plan:'saved plan text'});
  }finally{await p.close();}
});
test('exit without replacement preserves existing plan',async()=>{
  const f=fixture([fauxAssistantMessage('ok')]);
  const p=await Frame.open('plan-preserve',f.models,model);
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
  const p=await Frame.open('new-session',f.models,model);
  try {
    const conversationId=p.conversation.id;
    const file=join(paths('new-session').tools,'kept.txt');
    writeFileSync(file,'saved work');
    await p.operation({op:'memory',field:'notes',content:'important memory'});
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
  const p=await Frame.open('new-busy',f.models,model);
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
test('new session persists across frame reopen',async()=>{
  const f=fixture([
    fauxAssistantMessage('old session'),
    fauxAssistantMessage('new session')
  ]);
  let p=await Frame.open('new-persist',f.models,model);
  try {
    await (await p.conversation.submit({type:'input',content:'old question'},ctx)).wait(ctx);
    await p.operation({op:'new'});
    await (await p.conversation.submit({type:'input',content:'new question'},ctx)).wait(ctx);
  }finally{await p.close();}
  p=await Frame.open('new-persist',f.models,model);
  try {
    const context=await p.conversation.context(ctx);
    const texts=context.messages.map(m=>m.role==='user'||m.role==='assistant'?String(m.content):'').join(' ');
    assert.ok(!texts.includes('old question'));
    assert.ok(texts.includes('new question'));
  }finally{await p.close();}
});
test('new session preserves queued work, pending deliveries and request identities',async()=>{
  const f=fixture([fauxAssistantMessage('queued done'),fauxAssistantMessage('delivery done')]);
  const p=await Frame.open('new-queued',f.models,model);
  try {
    await p.conversation.commit(async tx=>{
      const inbox=await tx.doc(InboxDoc,p.conversation.id);
      const submission=await tx.createSubmission({conversationId:p.conversation.id,type:'input',status:'queued',requestId:'queued-before-reset'});
      inbox.items.push({id:submission.id,mode:'followUp',content:'queued before reset'});
    },ctx);
    await assert.rejects(p.operation({op:'new'}),/work is (queued|active)/);
    await p.tick();
    assert.equal(f.faux.state.callCount,0);
    await (await p.conversation.submit({type:'continue'},ctx)).wait(ctx);
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
  const p=await Frame.open('plan-cli',f.models,model);
  try {
    await p.operation({op:'plan-set',active:false,plan:'saved plan'});
    const cliPath=new URL('../../dist/src/cli.js',import.meta.url).pathname;
    const env={...process.env,PHILBY_FRAME:'plan-cli'};
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
  const p=await Frame.open('plan-preserve-op',f.models,model);
  try {
    await p.operation({op:'plan-set',active:false,plan:'saved plan'});
    const result=await p.operation({op:'plan-set',active:false});
    assert.deepEqual(result,{active:false,plan:'saved plan'});
  }finally{await p.close();}
});
test.after(()=>rmSync(directory,{recursive:true,force:true}));


test('a migrated frame reopens its saved conversation, memory and queued mailbox',async()=>{
  const {migrateFrames}=await import('../src/migration.js');
  const config=fixture();
  const original=await Frame.open('migration-resume',config.models,model);
  const id=original.conversation.id;
  await original.operation({op:'memory',field:'notes',content:'Retain migration memory'});
  assert.equal((await (await original.conversation.submit({type:'input',content:'Retain migration history'},ctx)).wait(ctx)).status,'done');
  const history=(await original.conversation.context(ctx)).messages;
  await original.close();
  const store=new Store('migration-resume');
  const message=envelope('sender','migration-resume','Queued before migration',{id:'migration-queued'});
  store.accept(message);store.close();
  const tools=paths('migration-resume').tools;
  renameSync(join(tools,'.frame-type'),join(tools,'.pane-type'));
  renameSync(join(directory,'frames'),join(directory,'panes'));
  migrateFrames(join(directory,'panes'),join(directory,'frames'));
  const pending=new Store('migration-resume');
  assert.deepEqual(pending.pending(),[message]);pending.close();
  const reopened=await Frame.open('migration-resume',config.models,()=>{throw Error('must retain saved model');});
  try {
    assert.equal(reopened.conversation.id,id);
    assert.deepEqual((await reopened.conversation.context(ctx)).messages.slice(0,history.length),history);
    assert.equal((await reopened.harness.snapshot(Memory,id,ctx))?.notes,'Retain migration memory');
    assert.equal(readFileSync(join(tools,'.frame-type'),'utf8'),'plain\n');
  } finally {await reopened.close();}
});

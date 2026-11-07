import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createModels, fauxProvider, type Context, type OAuthCredential } from '@earendil-works/pi-ai';
import { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { configuredModels, models, modelChoices, modelScope, refreshModels } from '../src/models.js';
import { modelReference } from '../src/providers.js';

const localModel={id:'owner/flash-next-custom:q3',name:'Local Flash Next',reasoning:false,input:['text'],contextWindow:12288,maxTokens:2048,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsDeveloperRole:false,maxTokensField:'max_tokens'}};
function fixture(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'philby-model-runtime-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const options={authPath:join(directory,'auth.json'),modelsPath:join(directory,'models.json'),modelsStorePath:join(directory,'models-store.json'),allowModelNetwork:false};
  writeFileSync(options.authPath,JSON.stringify({'test-local':{type:'api_key',key:'local-test-key'},'test-work':{type:'api_key',key:'work-test-key'}}));
  writeFileSync(options.modelsPath,JSON.stringify({providers:{
    'test-local':{baseUrl:'http://127.0.0.1:18000/v1',api:'openai-completions',apiKey:'unused-config-key',models:[localModel,{...localModel,id:'second-model',name:'Second local model'}]},
    'test-work':{baseUrl:'https://work.example/v1',api:'openai-completions',models:[localModel]},
    'test-unconfigured':{baseUrl:'https://missing.example/v1',api:'openai-completions',models:[{...localModel,id:'no-auth'}]},
  }}));
  return options;
}
function streamed(delta:unknown,finish_reason:string) {
  const chunk={id:'test-response',choices:[{index:0,delta,finish_reason}]};
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
}

test('Pi runtime exposes every available model and preserves arbitrary local metadata',async t=>{
  const options=fixture(t);
  const runtime=await configuredModels(options);
  assert.ok(runtime instanceof ModelRuntime);
  assert.equal(runtime.getError(),undefined);
  const local=runtime.getModel('test-local',localModel.id)!;
  assert.ok(local);
  assert.equal(local.name,localModel.name);
  assert.equal(local.contextWindow,12288);
  assert.equal(local.maxTokens,2048);
  assert.deepEqual(local.input,['text']);
  assert.deepEqual(local.cost,localModel.cost);
  assert.equal(local.baseUrl,'http://127.0.0.1:18000/v1');
  const choices=await modelChoices(runtime);
  assert.deepEqual(choices.filter(choice=>choice.provider.startsWith('test-')).map(({provider,modelId})=>({provider,modelId})),[
    {provider:'test-local',modelId:localModel.id},
    {provider:'test-local',modelId:'second-model'},
    {provider:'test-work',modelId:localModel.id},
  ]);
  assert.ok(runtime.getModel('test-unconfigured','no-auth'));
  assert.equal(await runtime.getAuth('test-unconfigured'),undefined);
  await runtime.setRuntimeApiKey('openrouter','openrouter-test-key');
  const upstream=await runtime.getAvailable('openrouter');
  assert.ok(upstream.length>8);
  const all=await modelChoices(runtime);
  assert.deepEqual(all.filter(choice=>choice.provider==='openrouter').map(choice=>choice.modelId).sort(),upstream.map(model=>model.id).sort());
});

test('native shortlist patterns select available models without shrinking the catalog',async t=>{
  const runtime=await configuredModels(fixture(t));
  const before=await modelChoices(runtime);
  const settings=SettingsManager.inMemory({enabledModels:[`test-work/${localModel.id}`,'test-local/**','test-local/second-model','test-unconfigured/*','missing/*']});
  const result=await modelScope(runtime,settings);
  assert.deepEqual(result.scopedModels.map(({model})=>`${model.provider}/${model.id}`),[
    `test-work/${localModel.id}`,
    `test-local/${localModel.id}`,
    'test-local/second-model',
  ]);
  assert.equal(result.errors.length,2);
  assert.ok(result.errors.some(error=>error.includes('test-unconfigured/*')));
  assert.ok(result.errors.some(error=>error.includes('missing/*')));
  assert.deepEqual(await modelChoices(runtime),before);
  assert.deepEqual(await modelScope(runtime,SettingsManager.inMemory()),{scopedModels:[],errors:[]});
});

test('invalid native shortlist settings remain visible instead of silently hiding models',async t=>{
  const options=fixture(t);
  const runtime=await configuredModels(options);
  const directory=dirname(options.authPath);
  writeFileSync(join(directory,'settings.json'),'{"enabledModels":');
  const result=await modelScope(runtime,SettingsManager.create(directory,directory));
  assert.deepEqual(result.scopedModels,[]);
  assert.ok(result.errors.some(error=>/JSON|parse|settings/i.test(error)));
  assert.ok((await modelChoices(runtime)).some(choice=>choice.provider==='test-local'));
});

test('saved selections do not require a new-pane default and explicit references retain their complete ID',async t=>{
  const options=fixture(t);
  const unselected=await models(undefined,{...options,env:{DEFAULT_MODEL:'invalid-default'}});
  assert.equal(unselected.model,undefined);
  const selected=await models(`test-local/${localModel.id}`,{...options,env:{}});
  assert.deepEqual(selected.model,{provider:'test-local',modelId:localModel.id});
  await assert.rejects(models('test-local/absent',{...options,env:{}}),/unavailable/i);
  await assert.rejects(models('absent/provider-model',{...options,env:{}}),/unavailable/i);
  assert.deepEqual(modelReference('test-local/owner/model:quant'),{provider:'test-local',modelId:'owner/model:quant'});
  assert.throws(()=>modelReference('unqualified'),/provider\/model-id/);
});

test('separate provider credentials reach their own endpoints and local tools round-trip',async t=>{
  const runtime=await configuredModels(fixture(t));
  const local=runtime.getModel('test-local',localModel.id)!;
  const context:Context={messages:[{role:'user',content:'Call ping with ok',timestamp:1}],tools:[{name:'ping',description:'Echo a value',parameters:{type:'object',properties:{value:{type:'string'}},required:['value']}}]};
  let calls=0;
  const fetch:typeof globalThis.fetch=async(url,init)=>{
    assert.equal(String(url),'http://127.0.0.1:18000/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer local-test-key');
    const body=JSON.parse(String(init?.body));
    assert.equal(body.model,localModel.id);
    assert.equal(body.stream,true);
    assert.equal(body.tools[0].function.name,'ping');
    assert.ok(body.max_tokens>0 && body.max_tokens<=local.maxTokens);
    calls++;
    if(calls===1) return streamed({role:'assistant',tool_calls:[{index:0,id:'call_ping',type:'function',function:{name:'ping',arguments:'{"value":"ok"}'}}]},'tool_calls');
    assert.ok(body.messages.some((message:any)=>message.role==='assistant' && message.tool_calls?.[0].id==='call_ping'));
    assert.ok(body.messages.some((message:any)=>message.role==='tool' && message.tool_call_id==='call_ping' && message.content==='pong'));
    return streamed({role:'assistant',content:'Received pong'},'stop');
  };
  const first=await runtime.streamSimple(local,context,{fetch}).result();
  assert.equal(first.stopReason,'toolUse',first.errorMessage ?? 'unexpected response');
  const call=first.content.find(part=>part.type==='toolCall')!;
  assert.equal(call.name,'ping');
  assert.deepEqual(call.arguments,{value:'ok'});
  const second=await runtime.streamSimple(local,{...context,messages:[...context.messages,first,{role:'toolResult',toolCallId:call.id,toolName:'ping',content:[{type:'text',text:'pong'}],isError:false,timestamp:2}]},{fetch}).result();
  assert.equal(second.stopReason,'stop',second.errorMessage ?? 'unexpected response');
  assert.deepEqual(second.content.filter(part=>part.type==='text').map(part=>part.text),['Received pong']);
  assert.equal(calls,2);
  const work=runtime.getModel('test-work',localModel.id)!;
  const separate=await runtime.streamSimple(work,{messages:[]},{fetch:async(url,init)=>{
    assert.equal(String(url),'https://work.example/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer work-test-key');
    assert.equal(JSON.parse(String(init?.body)).model,localModel.id);
    return streamed({role:'assistant',content:'work'},'stop');
  }}).result();
  assert.equal(separate.stopReason,'stop',separate.errorMessage ?? 'unexpected response');
});

test('native OAuth refresh failures surface and preserve the stored credential',async t=>{
  const options=fixture(t);
  const runtime=await configuredModels(options);
  const expired:OAuthCredential={type:'oauth',access:'expired-access',refresh:'retained-refresh',expires:0};
  const provider=fauxProvider({provider:'test-oauth',models:[{id:'oauth-model'}]}).provider;
  runtime.registerNativeProvider({...provider,auth:{oauth:{name:'Test OAuth',login:async()=>expired,refresh:async()=>{throw Error('refresh rejected');},toAuth:async credential=>({apiKey:credential.access})}}});
  await runtime.login('test-oauth','oauth',{prompt:async()=>{throw Error('unexpected prompt');},notify:()=>{}});
  await assert.rejects(runtime.getAuth('test-oauth'),/OAuth refresh failed/i);
  const result=await runtime.streamSimple(runtime.getModel('test-oauth','oauth-model')!,{messages:[]}).result();
  assert.equal(result.stopReason,'error');
  assert.match(result.errorMessage ?? '',/OAuth refresh failed/i);
  const stored=JSON.parse(readFileSync(options.authPath,'utf8'));
  assert.deepEqual(stored['test-oauth'],expired);
  assert.equal(stored['test-local'].key,'local-test-key');
});

test('refresh reports provider errors without hiding healthy choices',async()=>{
  const runtime=createModels();
  runtime.setProvider(fauxProvider({provider:'healthy',models:[{id:'ready'}]}).provider);
  runtime.setProvider({...fauxProvider({provider:'broken',models:[{id:'cached'}]}).provider,refreshModels:async()=>{throw Error('catalog unavailable');}});
  const errors=await refreshModels(runtime);
  assert.ok(errors.some(error=>error.includes('catalog unavailable')));
  assert.ok((await modelChoices(runtime)).some(choice=>choice.provider==='healthy' && choice.modelId==='ready'));
});

test('a provider auth error is reported while healthy picker choices remain available',async()=>{
  const runtime=createModels();
  runtime.setProvider(fauxProvider({provider:'healthy',models:[{id:'ready'}]}).provider);
  runtime.setProvider({...fauxProvider({provider:'broken',models:[{id:'unavailable'}]}).provider,auth:{apiKey:{name:'Unavailable test credentials',resolve:async()=>{throw Error('credential lookup failed');}}}});
  const errors:Error[]=[];
  const choices=await modelChoices(runtime,error=>errors.push(error));
  assert.deepEqual(choices.map(({provider,modelId})=>({provider,modelId})),[{provider:'healthy',modelId:'ready'}]);
  assert.equal(errors.length,1);
  assert.match(errors[0].message,/broken:.*auth failed/i);
  await assert.rejects(modelChoices(runtime),/broken:.*auth failed/i);
});

test('invalid upstream configuration remains diagnostic and explicit selection fails',async t=>{
  const options=fixture(t);
  writeFileSync(options.modelsPath,'{"providers":');
  const runtime=await configuredModels(options);
  assert.match(runtime.getError() ?? '',/JSON|parse|models/i);
  await assert.rejects(models(`test-local/${localModel.id}`,{...options,env:{}}),/unavailable/i);
});

test('deterministic development models need no production configuration',async()=>{
  const config=await models(undefined,{modelsPath:null,env:{PHILBY_TEST_PROVIDER:'1'}});
  assert.deepEqual(config.model,{provider:'test',modelId:'test'});
  assert.deepEqual((await modelChoices(config.models)).map(({provider,modelId,label})=>({provider,modelId,label})),[
    {provider:'test',modelId:'test',label:'Test'},
    {provider:'test',modelId:'test-alternate',label:'Test alternate'},
  ]);
});

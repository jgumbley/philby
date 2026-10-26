import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { models, modelChoices } from '../src/models.js';
import { consultationDefaults, loadProviders, modelReference } from '../src/providers.js';
import { getBuiltinModel } from '@earendil-works/pi-ai/providers/all';

const template=readFileSync(new URL('../../openrouter.provider.example',import.meta.url),'utf8');
const presets=['moonshotai/kimi-k3','z-ai/glm-5.2','z-ai/glm-5.3','z-ai/glm-5.3-flash','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4.1-flash','deepseek/deepseek-v4.1-flash-1017','minimax/minimax-m3'];
function fixture(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'philby-providers-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  writeFileSync(join(directory,'openrouter.provider'),template.replace('API_KEY=','API_KEY=test-key'));
  return {directory,env:{DEFAULT_MODEL:'openrouter/moonshotai/kimi-k3'}};
}
test('provider files preserve exact catalog models, menu order, defaults and online variants',async t=>{
  const options=fixture(t);
  for(const id of [...presets,'openai/gpt-5.5:online','x-ai/grok-4.3:online']) {
    const config=await models(`openrouter/${id}`,options);
    assert.deepEqual(config.model,{provider:'openrouter',modelId:id});
    assert.equal(config.models.getModel('openrouter',id)?.id,id);
    assert.deepEqual(modelChoices(config.models).map(choice=>choice.modelId),presets);
  }
  const config=await models(undefined,options);
  assert.equal(config.model.modelId,'moonshotai/kimi-k3');
  const model=config.models.getModel('openrouter','deepseek/deepseek-v4.1-flash-1017')!;
  assert.equal(model.contextWindow,1048576);
  assert.equal(model.maxTokens,393216);
  assert.deepEqual(model.input,['text','image']);
  assert.deepEqual(model.cost,{input:0.15,output:0.6,cacheRead:0.003,cacheWrite:0});
  assert.deepEqual(consultationDefaults,{
    ask:'openrouter/z-ai/glm-5.2',reason:'openrouter/openai/gpt-5.5',research:'openrouter/openai/gpt-5.5',twitter:'openrouter/x-ai/grok-4.3:online',
  });
  for(const reference of Object.values(consultationDefaults)) assert.ok(await models(reference,options));
  await assert.rejects(models('openrouter/missing-model',options),/unavailable/);
  await assert.rejects(models('openrouter/missing-model:online',options),/unavailable/);
  await assert.rejects(models('missing/z-ai/glm-5.3',options),/unavailable/);
  await assert.rejects(models(undefined,{...options,env:{}}),/DEFAULT_MODEL/);
  assert.deepEqual(modelReference('work/vendor/model'),{provider:'work',modelId:'vendor/model'});
  assert.throws(()=>modelReference('unqualified'),/provider\/model-id/);
});
test('filename identities scope credentials and requests independently of global credentials',async t=>{
  const options=fixture(t);
  writeFileSync(join(options.directory,'work.provider'),'TYPE=openrouter\nAPI_KEY="work-$literal#key"\nMODELS=z-ai/glm-5.3\n');
  writeFileSync(join(options.directory,'ignored.provider.example'),'not configuration');
  const config=await models('work/z-ai/glm-5.3',{...options,env:{OPENROUTER_API_KEY:'wrong-global-key'}});
  assert.deepEqual(loadProviders(options.directory).map(provider=>provider.id),['openrouter','work']);
  assert.deepEqual(modelChoices(config.models).at(-1)?.provider,'work');
  for(const [provider,key] of [['openrouter','test-key'],['work','work-$literal#key']]) {
    assert.equal((await config.models.getAuth(provider))?.auth.apiKey,key);
    const model=config.models.getModel(provider,'z-ai/glm-5.3')!;
    assert.equal(model.provider,provider);
    let calls=0;
    const response=await config.models.streamSimple(model,{messages:[{role:'user',content:'hello',timestamp:1}]},{
      fetch:async(_url,init)=>{
        calls++;
        assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${key}`);
        assert.equal(JSON.parse(String(init?.body)).model,'z-ai/glm-5.3');
        return new Response('data: {"id":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      },
    }).result();
    assert.notEqual(response.stopReason,'error',response.errorMessage);
    assert.equal(calls,1);
  }
});
test('configuration errors fail before requests and never include credential values',async t=>{
  const options=fixture(t);
  const path=join(options.directory,'openrouter.provider');
  for(const [source,expected] of [
    ['TYPE=unknown\nAPI_KEY=secret-value\nMODELS=x',/unsupported TYPE/],
    ['TYPE=openrouter\nAPI_KEY=\nMODELS=x',/API_KEY is required/],
    ['TYPE=openrouter\nAPI_KEY=secret-value\nMODELS=',/MODELS/],
    ['TYPE=openrouter\nAPI_KEY=secret-value\nMODELS=x,x',/MODELS/],
    ['TYPE=openrouter\nAPI_KEY=secret-value\nMODELS=missing',/unavailable model/],
    ['TYPE=openrouter\nAPI_KEY=secret-value\nMODELS=x\nTYPO=secret-value',/unsupported setting/],
  ] as const) {
    writeFileSync(path,source);
    await assert.rejects(models(undefined,options),error=>{
      assert.match(String(error),expected);assert.match(String(error),/openrouter.provider/);
      assert.ok(!String(error).includes('secret-value'));return true;
    });
  }
  rmSync(path);
  await assert.rejects(models(undefined,options),/No provider files/);
  writeFileSync(join(options.directory,'BAD.provider'),template);
  await assert.rejects(models(undefined,options),/invalid provider filename/);
});
test('deterministic test provider requires no production configuration',async()=>{
  const config=await models(undefined,{directory:'/not-a-directory',env:{PHILBY_TEST_PROVIDER:'1'}});
  assert.deepEqual(config.model,{provider:'test',modelId:'test'});
  assert.deepEqual(modelChoices(config.models).map(({provider,modelId,label})=>({provider,modelId,label})),[
    {provider:'test',modelId:'test',label:'Test'},
    {provider:'test',modelId:'test-alternate',label:'Test alternate'},
  ]);
});
test('gateway uses Pi metadata and streams function calls through its configured endpoint',async t=>{
  const options=fixture(t);
  writeFileSync(join(options.directory,'work.provider'),'TYPE=openai-compatible\nBASE_URL=https://gateway.example/v1/inference/\nAPI_KEY=gateway-key\nCATALOG=anthropic\nMODELS=claude-sonnet-5-5\n');
  const config=await models('work/claude-sonnet-5-5',options);
  const model=config.models.getModel('work','claude-sonnet-5-5')!;
  const original=getBuiltinModel('anthropic','claude-sonnet-5-5');
  assert.equal(model.contextWindow,original.contextWindow);
  assert.equal(model.maxTokens,original.maxTokens);
  assert.equal(model.name,original.name);
  assert.equal(config.providerType,'openai-compatible');
  let calls=0;
  const result=await config.models.streamSimple(model,{
    messages:[{role:'user',content:'Call ping',timestamp:1}],
    tools:[{name:'ping',description:'A deterministic test tool',parameters:{type:'object',properties:{}}}],
  },{fetch:async(url,init)=>{
    calls++;
    assert.equal(String(url),'https://gateway.example/v1/inference/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer gateway-key');
    const body=JSON.parse(String(init?.body));
    assert.equal(body.model,'claude-sonnet-5-5');
    assert.equal(body.stream,true);
    assert.equal(body.tools[0].function.name,'ping');
    assert.ok(body.max_tokens>0 && body.max_tokens<=original.maxTokens);
    const chunk={id:'test',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_ping',type:'function',function:{name:'ping',arguments:'{}'}}]},finish_reason:'tool_calls'}]};
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  }}).result();
  assert.equal(result.stopReason,'toolUse',result.errorMessage);
  assert.equal(result.content.find(content=>content.type==='toolCall')?.name,'ping');
  assert.equal(calls,1);
});
test('gateway rejects missing metadata and invalid endpoints before inference',async t=>{
  const options=fixture(t);
  const source='TYPE=openai-compatible\nBASE_URL=https://gateway.example/v1\nAPI_KEY=gateway-secret\nCATALOG=anthropic\nMODELS=claude-sonnet-5-5\n';
  for(const [from,to,expected] of [
    ['CATALOG=anthropic','CATALOG=',/CATALOG/],
    ['CATALOG=anthropic','CATALOG=not-a-catalog',/CATALOG/],
    ['MODELS=claude-sonnet-5-5','MODELS=unknown-model',/absent from the Pi catalog/],
    ['https://gateway.example/v1','file:///tmp/model',/BASE_URL/],
    ['https://gateway.example/v1','https://user:gateway-secret@gateway.example/v1',/BASE_URL/],
  ] as const) {
    writeFileSync(join(options.directory,'work.provider'),source.replace(from,to));
    await assert.rejects(models('work/claude-sonnet-5-5',options),error=>{
      assert.match(String(error),expected);assert.ok(!String(error).includes('gateway-secret'));return true;
    });
  }
});

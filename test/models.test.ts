import test from 'node:test';
import assert from 'node:assert/strict';
import { createModels, fauxProvider } from '@earendil-works/pi-ai';
import { models, modelChoices } from '../src/models.js';
test('exact catalog models and explicit online variants; no substitution',async()=>{
  const key=process.env.OPENROUTER_API_KEY;
  const mode=process.env.PHILBY_TEST_PROVIDER;
  delete process.env.PHILBY_TEST_PROVIDER;
  try {
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(models(),/OPENROUTER_API_KEY/);
    process.env.OPENROUTER_API_KEY='test';
    const presets=['moonshotai/kimi-k3','z-ai/glm-5.2','z-ai/glm-5.3','z-ai/glm-5.3-flash','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4.1-flash','deepseek/deepseek-v4.1-flash-1017','minimax/minimax-m3'];
    for(const id of [...presets,'openai/gpt-5.5:online','x-ai/grok-4.3:online']) {
      const config=await models(id);
      assert.equal(config.model.modelId,id);
      assert.equal(config.models.getModel('openrouter',id)?.id,id);
    }
    const config=await models('deepseek/deepseek-v4.1-flash-1017');
    assert.deepEqual(modelChoices(config.models).map(choice=>choice.modelId),presets);
    const model=config.models.getModel('openrouter',config.model.modelId)!;
    assert.equal(model.contextWindow,1048576);
    assert.equal(model.maxTokens,393216);
    assert.deepEqual(model.input,['text','image']);
    assert.deepEqual(model.cost,{input:0.15,output:0.6,cacheRead:0.003,cacheWrite:0});
    await assert.rejects(models('missing-model'),/unavailable/);
    await assert.rejects(models('missing-model:online'),/Unknown/);
  }finally{
    if(key===undefined) delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;
    if(mode===undefined) delete process.env.PHILBY_TEST_PROVIDER;else process.env.PHILBY_TEST_PROVIDER=mode;
  }
});
test('model choices include only registered presets and deterministic test models',async()=>{
  const registry=createModels();
  registry.setProvider(fauxProvider({provider:'openrouter',models:[{id:'z-ai/glm-5.3-flash'},{id:'other'}]}).provider);
  assert.deepEqual(modelChoices(registry).map(choice=>choice.modelId),['z-ai/glm-5.3-flash']);
  const mode=process.env.PHILBY_TEST_PROVIDER;
  process.env.PHILBY_TEST_PROVIDER='1';
  try {
    const config=await models();
    assert.deepEqual(config.model,{provider:'test',modelId:'test'});
    assert.deepEqual(modelChoices(config.models).map(({provider,modelId,label})=>({provider,modelId,label})),[
      {provider:'test',modelId:'test',label:'Test'},
      {provider:'test',modelId:'test-alternate',label:'Test alternate'},
    ]);
  } finally {
    if(mode===undefined) delete process.env.PHILBY_TEST_PROVIDER;else process.env.PHILBY_TEST_PROVIDER=mode;
  }
});

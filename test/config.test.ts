import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function fixture(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'philby-config-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const root=join(directory,'checkout with spaces');
  const agent=join(root,'.pi','agent');
  const ambient=join(directory,'ambient');
  const cwd=join(directory,'elsewhere');
  for(const path of [agent,ambient,cwd]) mkdirSync(path,{recursive:true});
  writeFileSync(join(root,'.env'),'PHILBY_CONFIG_TEST_KEY=checkout-environment-key\n');
  const env={PATH:process.env.PATH,PHILBY_ROOT:root,PI_CODING_AGENT_DIR:ambient,PI_OFFLINE:'1'};
  return {directory,root,agent,ambient,cwd,env};
}

test('standalone model runtime uses checkout configuration and credentials from any working directory',t=>{
  const f=fixture(t);
  const model={id:'checkout-model',name:'Checkout model',contextWindow:8192,maxTokens:2048};
  const provider={api:'openai-completions',baseUrl:'http://127.0.0.1:18000/v1',models:[model]};
  writeFileSync(join(f.agent,'models.json'),JSON.stringify({providers:{
    'test-project':provider,
    'test-environment':{...provider,apiKey:'$PHILBY_CONFIG_TEST_KEY'},
  }}));
  writeFileSync(join(f.agent,'auth.json'),JSON.stringify({'test-project':{type:'api_key',key:'checkout-credential'}}));
  writeFileSync(join(f.ambient,'models.json'),JSON.stringify({providers:{'test-ambient':provider}}));
  writeFileSync(join(f.ambient,'auth.json'),JSON.stringify({'test-project':{type:'api_key',key:'wrong-ambient-credential'}}));
  const module=new URL('../src/models.js',import.meta.url).href;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',`
    import assert from 'node:assert/strict';
    import { configuredModels, modelChoices } from ${JSON.stringify(module)};
    globalThis.fetch=async()=>{throw Error('Unexpected network request');};
    const runtime=await configuredModels();
    assert.equal(runtime.getError(),undefined);
    assert.equal(runtime.getModel('test-project','checkout-model')?.contextWindow,8192);
    assert.equal(runtime.getModel('test-ambient','checkout-model'),undefined);
    assert.equal((await runtime.getAuth('test-project'))?.auth.apiKey,'checkout-credential');
    assert.equal((await runtime.getAuth('test-environment'))?.auth.apiKey,'checkout-environment-key');
    const choices=await modelChoices(runtime);
    assert.deepEqual(choices.filter(choice=>choice.provider.startsWith('test-')).map(choice=>choice.provider),['test-environment','test-project']);
  `],{cwd:f.cwd,env:f.env,encoding:'utf8',timeout:15000});
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr);
});

test('full Pi uses the checkout directory and propagates failures',t=>{
  const f=fixture(t);
  const bin=join(f.directory,'bin');
  mkdirSync(bin);
  writeFileSync(join(bin,'npx'),`#!${process.execPath}
console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),agent:process.env.PI_CODING_AGENT_DIR,key:process.env.PHILBY_CONFIG_TEST_KEY}));
process.exitCode=17;
`,{mode:0o755});
  const launcher=fileURLToPath(new URL('../../shared/full-pi.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[launcher],{cwd:f.cwd,env:{...f.env,PATH:`${bin}${delimiter}${f.env.PATH || ''}`},encoding:'utf8',timeout:15000});
  assert.ifError(result.error);
  assert.equal(result.status,17,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{args:['--no-install','pi'],cwd:f.root,agent:f.agent,key:'checkout-environment-key'});
});

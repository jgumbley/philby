import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createModels, fauxProvider, type OAuthCredential } from '@earendil-works/pi-ai';
import { ProviderCredentials } from '../src/credentials.js';

function fixture(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'philby-auth-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  return {directory,credentials:new ProviderCredentials(directory)};
}
const expired:OAuthCredential={type:'oauth',access:'test-access',refresh:'test-refresh',expires:0};
test('provider login persists credentials and installation identity across store instances',async t=>{
  const {directory,credentials}=fixture(t);
  const registry=createModels({credentials});
  const provider=fauxProvider({provider:'openai',models:[{id:'test'}]}).provider;
  registry.setProvider({...provider,auth:{oauth:{name:'Test OAuth',login:async()=>expired,refresh:async()=>{throw Error('unexpected refresh');},toAuth:async credential=>({apiKey:credential.access})}}});
  await registry.login('openai','oauth',{prompt:async()=>{throw Error('unexpected prompt');},notify:()=>{}});
  const reopened=new ProviderCredentials(directory);
  assert.deepEqual(await reopened.read('openai'),expired);
  assert.equal(await reopened.read('other'),undefined);
  assert.deepEqual(await reopened.list(),[{providerId:'openai',type:'oauth'}]);
  assert.equal(await credentials.deviceId(),await reopened.deviceId());
  assert.equal(statSync(join(directory,'.state','providers.sqlite')).mode & 0o777,0o600);
  await registry.logout('openai');
  assert.deepEqual(await reopened.list(),[]);
});
test('refresh failure preserves credentials and cancelled lock waits never mutate them',async t=>{
  const {directory,credentials}=fixture(t);
  await credentials.modify('openai',async()=>expired);
  const registry=createModels({credentials});
  registry.setProvider({...fauxProvider({provider:'openai',models:[{id:'test'}]}).provider,auth:{oauth:{name:'Test OAuth',login:async()=>expired,refresh:async()=>{throw Error('test-refresh');},toAuth:async value=>({apiKey:value.access})}}});
  await assert.rejects(registry.getAuth('openai'),error=>{
    assert.match(String(error),/OAuth refresh failed/);
    assert.doesNotMatch(String(error),/test-refresh/);
    return true;
  });
  assert.deepEqual(await credentials.read('openai'),expired);
  let release!:()=>void;
  let acquired!:()=>void;
  const ready=new Promise<void>(resolve=>{acquired=resolve;});
  const held=credentials.modify('openai',async()=>{
    acquired();await new Promise<void>(resolve=>{release=resolve;});return undefined;
  });
  await ready;
  try {
    const controller=new AbortController();
    const waiting=new ProviderCredentials(directory).modify('openai',async()=>{throw Error('must not execute');},{signal:controller.signal});
    controller.abort();
    await assert.rejects(waiting,/abort/i);
  } finally {release();await held;}
  assert.deepEqual(await credentials.read('openai'),expired);
  await assert.rejects(credentials.modify('openai',async()=>{throw Error('rollback');}),/rollback/);
  assert.deepEqual(await credentials.read('openai'),expired);
});
test('separate pane processes refresh a shared rotating credential only once',async t=>{
  const {directory,credentials}=fixture(t);
  await credentials.modify('openai',async()=>expired);
  const source=`
    import { createModels, fauxProvider } from '@earendil-works/pi-ai';
    import { appendFileSync } from 'node:fs';
    import { once } from 'node:events';
    import { ProviderCredentials } from ${JSON.stringify(new URL('../src/credentials.js',import.meta.url).href)};
    const registry=createModels({credentials:new ProviderCredentials(process.env.AUTH_TEST_DIRECTORY)});
    registry.setProvider({...fauxProvider({provider:'openai',models:[{id:'test'}]}).provider,auth:{oauth:{
      name:'Test OAuth',login:async()=>{throw Error('unexpected login');},
      refresh:async current=>{
        if(current.refresh!=='test-refresh') throw Error('unexpected token');
        appendFileSync(process.env.AUTH_TEST_DIRECTORY+'/refreshes','refresh\\n');
        await new Promise(resolve=>setTimeout(resolve,100));
        return {...current,access:'rotated-access',refresh:'rotated-refresh',expires:Date.now()+3600000};
      },toAuth:async value=>({apiKey:value.access})
    }}});
    const start=once(process,'message');process.send('ready');await start;
    if((await registry.getAuth('openai')).auth.apiKey!=='rotated-access') throw Error('wrong token');
    process.disconnect();
  `;
  const children=Array.from({length:2},()=>spawn(process.execPath,['--input-type=module','--eval',source],{env:{...process.env,AUTH_TEST_DIRECTORY:directory},stdio:['ignore','ignore','pipe','ipc']}));
  t.after(()=>children.forEach(child=>child.kill()));
  const completions=children.map(child=>new Promise<void>((resolve,reject)=>{
    let error='';child.stderr!.on('data',data=>{error+=data;});child.once('error',reject);
    child.once('exit',code=>code===0?resolve():reject(Error(error)));
  }));
  await Promise.all(children.map(child=>once(child,'message')));
  children.forEach(child=>child.send('start'));
  await Promise.all(completions);
  assert.equal(readFileSync(join(directory,'refreshes'),'utf8'),'refresh\n');
  assert.equal((await credentials.read('openai') as OAuthCredential).refresh,'rotated-refresh');
});

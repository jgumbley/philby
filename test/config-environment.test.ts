import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const module=new URL('../src/config.js',import.meta.url).href;
function fixture(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'philby-env-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const root=join(directory,'instance with spaces');
  const frames=join(directory,'relocated frames');
  const one=join(frames,'one');
  const two=join(frames,'two');
  for(const path of [root,one,two]) mkdirSync(path,{recursive:true});
  copyFileSync(new URL('../../.env.schema',import.meta.url),join(root,'.env.schema'));
  writeFileSync(join(root,'.env'),'ASK_MODEL=provider/instance\nSHARED_VALUE=instance\n');
  for(const path of [one,two]) writeFileSync(join(path,'.env.schema'),'# @defaultRequired=true\n# @defaultSensitive=true\n');
  writeFileSync(join(one,'.env'),'ASK_MODEL=provider/one\nONE_ONLY=private-one\n');
  writeFileSync(join(two,'.env'),'ASK_MODEL=provider/two\n');
  const env={PATH:process.env.PATH,PHILBY_ROOT:root,PI_CODING_AGENT_DIR:join(directory,'ambient')};
  return {directory,root,frames,one,two,env};
}
function execute(body:string,env:NodeJS.ProcessEnv) {
  return spawnSync(process.execPath,['--input-type=module','--eval',`import { instanceEnvironment, invocationEnvironment, frameEnvironment, root, piAgentDir } from ${JSON.stringify(module)}; ${body}`],{
    env,encoding:'utf8',timeout:15_000,
  });
}
function result(body:string,env:NodeJS.ProcessEnv) {
  const output=execute(body,env);
  assert.ifError(output.error);
  assert.equal(output.status,0,output.stderr);
  return JSON.parse(output.stdout) as NodeJS.ProcessEnv;
}
function frame(directory:string,name:string,frames:string) {
  return `console.log(JSON.stringify(frameEnvironment(${JSON.stringify(directory)},${JSON.stringify(name)},${JSON.stringify(frames)})));`;
}

test('instance and relocated frame configuration preserve native layering and invocation overrides',t=>{
  const f=fixture(t);
  const instance=result('console.log(JSON.stringify(instanceEnvironment));',f.env);
  assert.equal(instance.ASK_MODEL,'provider/instance');
  assert.equal(instance.DEFAULT_MODEL,undefined);
  assert.equal(instance.PI_CODING_AGENT_DIR,join(f.root,'.pi','agent'));
  const resolved=result(frame(f.one,'one',f.frames),f.env);
  assert.equal(resolved.ASK_MODEL,'provider/one');
  assert.equal(resolved.SHARED_VALUE,'instance');
  assert.equal(resolved.PHILBY_FRAME,'one');
  assert.equal(resolved.PHILBY_FRAMES_DIR,f.frames);
  assert.equal(resolved.PI_CODING_AGENT_DIR,join(f.root,'.pi','agent'));
  const override=result(frame(f.one,'one',f.frames),{...f.env,ASK_MODEL:'provider/invocation'});
  assert.equal(override.ASK_MODEL,'provider/invocation');
});

test('frame schemas validate inherited requirements and their own stronger overrides together',t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,'.env'),'SHARED_REQUIRED=from-instance\nPORT=instance-string\n');
  writeFileSync(join(f.one,'.env.schema'),'# @defaultRequired=true\n# ---\nSHARED_REQUIRED=\n# @type=number\nPORT=\n');
  writeFileSync(join(f.one,'.env'),'PORT=9000\n');
  const resolved=result(frame(f.one,'one',f.frames),f.env);
  assert.equal(resolved.SHARED_REQUIRED,'from-instance');
  assert.equal(resolved.PORT,'9000');
});

test('frame environment rejects reserved identities and managed settings',t=>{
  const f=fixture(t);
  for(const key of ['PHILBY_ROOT','PHILBY_FRAMES_DIR','PHILBY_FRAME','PI_CODING_AGENT_DIR','FRAME_MODEL','FRAME_THINKING_LEVEL','FRAME_MESSAGING']) {
    writeFileSync(join(f.one,'.env'),`${key}=forbidden\n`);
    const output=execute(frame(f.one,'one',f.frames),f.env);
    assert.notEqual(output.status,0,key);
    assert.match(output.stderr,/reserved keys/);
    assert.match(output.stderr,new RegExp(key));
  }
  const imported=join(f.directory,'.env.imported');
  writeFileSync(imported,'PHILBY_FRAME=imported\n');
  writeFileSync(join(f.one,'.env'),'');
  writeFileSync(join(f.one,'.env.schema'),`# @import(${JSON.stringify(imported)})\n`);
  const output=execute(frame(f.one,'one',f.frames),f.env);
  assert.notEqual(output.status,0);
  assert.match(output.stderr,/reserved keys: PHILBY_FRAME/);
});

test('cross-frame launches strip loaded values while preserving actual and changed invocation overrides',t=>{
  const f=fixture(t);
  const inherited=result(frame(f.one,'one',f.frames),f.env);
  const tool=result('console.log(JSON.stringify({frame:process.env.PHILBY_FRAME,launchFrame:invocationEnvironment.PHILBY_FRAME,oneOnly:process.env.ONE_ONLY,model:process.env.ASK_MODEL}));',inherited);
  assert.deepEqual(tool,{frame:'one',model:'provider/instance'});
  const second=result(frame(f.two,'two',f.frames),inherited);
  assert.equal(second.ASK_MODEL,'provider/two');
  assert.equal(second.ONE_ONLY,undefined);
  assert.equal(second.PHILBY_FRAME,'two');
  const explicit=result(frame(f.one,'one',f.frames),{...f.env,ASK_MODEL:'provider/invocation'});
  const preserved=result(frame(f.two,'two',f.frames),explicit);
  assert.equal(preserved.ASK_MODEL,'provider/invocation');
  const changed=result(frame(f.two,'two',f.frames),{...inherited,ASK_MODEL:'provider/changed'});
  assert.equal(changed.ASK_MODEL,'provider/changed');
});

test('running frame tools keep their frame tree when root configuration changes',t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,'.env'),`PHILBY_FRAMES_DIR=${f.frames}\n`);
  const inherited=result(frame(f.one,'one',f.frames),f.env);
  const relocated=join(f.directory,'new frame tree');
  writeFileSync(join(f.root,'.env'),`PHILBY_FRAMES_DIR=${relocated}\n`);
  const store=new URL('../src/store.js',import.meta.url).href;
  const inspect=`const { framesRoot }=await import(${JSON.stringify(store)}); console.log(JSON.stringify({framesRoot,launchFrames:invocationEnvironment.PHILBY_FRAMES_DIR}));`;
  assert.deepEqual(result(inspect,inherited),{framesRoot:f.frames});
  assert.deepEqual(result(inspect,f.env),{framesRoot:relocated});
});

test('invalid frame values report keys without exposing secrets and missing schemas fail explicitly',t=>{
  const f=fixture(t);
  writeFileSync(join(f.one,'.env.schema'),'# @defaultSensitive=true\n# ---\n# @type=number\nTOKEN=\n');
  writeFileSync(join(f.one,'.env'),'TOKEN=private-invalid-token-782\n');
  const invalid=execute(frame(f.one,'one',f.frames),f.env);
  assert.notEqual(invalid.status,0);
  assert.match(invalid.stderr,/TOKEN/);
  assert.doesNotMatch(invalid.stdout+invalid.stderr,/private-invalid-token-782/);
  rmSync(join(f.one,'.env.schema'));
  const missing=execute(frame(f.one,'one',f.frames),f.env);
  assert.notEqual(missing.status,0);
  assert.match(missing.stderr,/schema or file is missing/);
});

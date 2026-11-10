import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from '../src/varlock.js';

function fixture(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'philby-varlock-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const root=join(directory,'instance with spaces');
  const frame=join(directory,'relocated frame');
  for(const path of [root,frame]) mkdirSync(path);
  writeFileSync(join(root,'.env.schema'),'# @defaultRequired=false @defaultSensitive=false\n# ---\nCHOICE=default\nABSENT=\n# @type=number\nPORT=3000\n');
  writeFileSync(join(root,'.env'),'CHOICE=instance\nINSTANCE_ONLY=instance\n');
  writeFileSync(join(frame,'.env.schema'),'# @defaultRequired=false @defaultSensitive=false\n# ---\nCHOICE=\nFRAME_ONLY=frame\n');
  writeFileSync(join(frame,'.env'),'CHOICE=frame\n');
  return {directory,root,frame};
}

test('Varlock composes explicit instance and frame paths before invocation overrides',t=>{
  const {root,frame}=fixture(t);
  assert.equal(loadEnvironment([join(root,'.env.schema')],{}).CHOICE,'default');
  assert.equal(loadEnvironment([root],{}).CHOICE,'instance');
  const result=loadEnvironment([root,frame],{UNDECLARED:'ambient'});
  assert.deepEqual(result,{CHOICE:'frame',ABSENT:undefined,PORT:'3000',INSTANCE_ONLY:'instance',FRAME_ONLY:'frame'});
  const env={CHOICE:'invocation'};
  assert.equal(loadEnvironment([root,frame],env).CHOICE,'invocation');
  assert.deepEqual(env,{CHOICE:'invocation'});
});

test('Varlock rejects invalid values without exposing values or native error output',t=>{
  const {root}=fixture(t);
  const secret='private-invalid-number-3829';
  writeFileSync(join(root,'.env'),`PORT=${secret}\n`);
  assert.throws(()=>loadEnvironment([root],{}),error=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/Varlock configuration is invalid: PORT/);
    assert.ok(!String(error.stack).includes(secret));
    return true;
  });
});

test('Varlock requires explicit existing schemas and rejects malformed schemas',t=>{
  const {root,frame}=fixture(t);
  assert.throws(()=>loadEnvironment([],{}),/explicit configuration path/);
  rmSync(join(frame,'.env.schema'));
  assert.throws(()=>loadEnvironment([frame],{}),/schema or file is missing/);
  writeFileSync(join(root,'.env.schema'),'# @type=not-a-data-type(secret-value)\nKEY=private-value\n');
  assert.throws(()=>loadEnvironment([root],{}),error=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/configuration is invalid/);
    assert.doesNotMatch(error.message,/secret-value|private-value/);
    return true;
  });
});

test('Varlock loads fresh files despite inherited Varlock filter and injection state',t=>{
  const {root}=fixture(t);
  const result=loadEnvironment([root],{
    _VARLOCK_FILTER:'DOES_NOT_EXIST',
    _VARLOCK_USE_FROZEN_ENV:'/missing/frozen.env',
    _VARLOCK_USE_INJECTED_ENV:'force',
    __VARLOCK_ENV:'invalid inherited blob',
  });
  assert.equal(result.CHOICE,'instance');
  assert.equal(result.PORT,'3000');
});

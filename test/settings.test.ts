import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { harnessSettings } from '../src/settings.js';

function fixture(t:TestContext) {
  const root=mkdtempSync(join(tmpdir(),'philby-settings-'));
  const agent=join(root,'.pi','agent');
  mkdirSync(agent,{recursive:true});
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,agent};
}

test('native compaction profiles inherit global settings and preserve complete model IDs',()=>{
  const settings=SettingsManager.inMemory({compaction:{reserveTokens:10000,keepRecentTokens:8000,modelOverrides:{
    'local/owner/model':{reserveTokens:8192},
    'work/other':{keepRecentTokens:12000},
  }}});
  const compaction=harnessSettings(settings).compaction!;
  assert.equal(compaction.enabled,true);
  assert.equal(compaction.reserveTokens,10000);
  assert.equal(compaction.keepRecentTokens,8000);
  assert.equal(compaction.backgroundTokens,undefined);
  assert.deepEqual(compaction.modelOverrides,{
    'local/owner/model':{enabled:true,reserveTokens:8192,keepRecentTokens:8000,backgroundTokens:0},
    'work/other':{enabled:true,reserveTokens:10000,keepRecentTokens:12000,backgroundTokens:0},
  });
  assert.deepEqual(harnessSettings(SettingsManager.inMemory()).compaction,{
    ...SettingsManager.inMemory().getCompactionSettings(),modelOverrides:{},
  });
});

test('native project settings override checkout settings without losing per-model fields',t=>{
  const f=fixture(t);
  writeFileSync(join(f.agent,'settings.json'),JSON.stringify({compaction:{reserveTokens:9000,keepRecentTokens:4000,modelOverrides:{'local/owner/model':{reserveTokens:8192}}}}));
  writeFileSync(join(f.root,'.pi','settings.json'),JSON.stringify({compaction:{reserveTokens:10000,modelOverrides:{'local/owner/model':{keepRecentTokens:12000}}}}));
  const compaction=harnessSettings(SettingsManager.create(f.root,f.agent,{projectTrusted:true})).compaction!;
  assert.equal(compaction.reserveTokens,10000);
  assert.equal(compaction.keepRecentTokens,4000);
  assert.deepEqual(compaction.modelOverrides?.['local/owner/model'],{enabled:true,reserveTokens:8192,keepRecentTokens:12000,backgroundTokens:0});
});

test('invalid compaction settings fail instead of reverting to defaults',t=>{
  const f=fixture(t);
  const file=join(f.agent,'settings.json');
  for(const source of ['{"compaction":',...[
    {compaction:[]},
    {compaction:{enabled:'yes'}},
    {compaction:{reserveTokens:-1}},
    {compaction:{keepRecentTokens:1.5}},
    {compaction:{modelOverrides:[]}},
    {compaction:{modelOverrides:{'local/owner/model':{reserveTokens:'8192'}}}},
    {compaction:{modelOverrides:{'local/owner/model':null}}},
  ].map(value=>JSON.stringify(value))]) {
    writeFileSync(file,source);
    assert.throws(()=>harnessSettings(SettingsManager.create(f.root,f.agent)),/settings|compaction|JSON|parse/i,source);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'philby-frame-config-'));
process.env.PHILBY_ROOT=directory;
mkdirSync(join(directory,'shared'));
writeFileSync(join(directory,'.env.schema'),'# @defaultRequired=false\n');
cpSync(new URL('../../shared/frame.env.schema',import.meta.url),join(directory,'shared','frame.env.schema'));
const {readFrameSettings,writeFrameSettings}=await import('../src/frame-config.js');
const model={provider:'test',modelId:'owner/model'};

function frame(name:string) {
  const path=join(directory,name);mkdirSync(path);return path;
}

test('frame settings persist model, explicit thinking and disabled messaging through the standard schema',()=>{
  const path=frame('roundtrip');
  assert.equal(readFrameSettings(path),undefined);
  writeFrameSettings(path,{model,thinkingLevel:'high',messaging:false});
  assert.deepEqual(readFrameSettings(path),{model,thinkingLevel:'high',messaging:false});
  assert.equal(statSync(join(path,'frame.env')).mode & 0o777,0o600);
  writeFrameSettings(path,{model,messaging:true});
  assert.deepEqual(readFrameSettings(path),{model,messaging:true});
  assert.deepEqual(readdirSync(path),['frame.env']);
});

test('legacy frame settings enable messaging through the schema default',()=>{
  const path=frame('messaging-default');
  writeFileSync(join(path,'frame.env'),'FRAME_MODEL=test/owner/model\n');
  assert.deepEqual(readFrameSettings(path),{model,messaging:true});
});

test('invalid updates preserve the previous settings file',()=>{
  const path=frame('invalid-update');
  writeFrameSettings(path,{model,messaging:false});
  const previous=readFileSync(join(path,'frame.env'),'utf8');
  for(const settings of [{model:{provider:'bad provider',modelId:'model'},messaging:false},{model,thinkingLevel:'invented',messaging:false},{model:{provider:'test',modelId:'invalid"quote'},messaging:false},{model,messaging:'false'},{model,messaging:undefined}]) {
    assert.throws(()=>writeFrameSettings(path,settings as Parameters<typeof writeFrameSettings>[1]));
    assert.equal(readFileSync(join(path,'frame.env'),'utf8'),previous);
    assert.deepEqual(readdirSync(path),['frame.env']);
  }
});

test('present malformed frame settings fail instead of becoming a missing file',()=>{
  const path=frame('invalid-read');
  for(const source of ['', 'FRAME_MODEL=invalid\n', 'FRAME_MODEL=test/model\nFRAME_THINKING_LEVEL=unknown\n', 'FRAME_MODEL=test/model\nUNRECOGNIZED=secret-marker\n', 'FRAME_MODEL=test/one\nFRAME_MODEL=test/two\n', 'FRAME_MODEL=test/model\ninvalid syntax\n', ...['', '1', '0', 'yes', 'TRUE', 'False'].map(value=>`FRAME_MODEL=test/model\nFRAME_MESSAGING=${value}\n`), 'FRAME_MODEL=test/model\nFRAME_MESSAGING=true\nFRAME_MESSAGING=false\n']) {
    writeFileSync(join(path,'frame.env'),source);
    assert.throws(()=>readFrameSettings(path),error=>error instanceof Error && !error.message.includes('secret-marker'));
  }
});

test('saved frame settings ignore ambient overrides and tool environment files',()=>{
  const path=frame('isolated');
  const before={model:process.env.FRAME_MODEL,thinking:process.env.FRAME_THINKING_LEVEL,messaging:process.env.FRAME_MESSAGING};
  process.env.FRAME_MODEL='ambient/other';process.env.FRAME_THINKING_LEVEL='max';process.env.FRAME_MESSAGING='true';
  const toolSource='FRAME_MODEL=tools/other\nFRAME_MESSAGING=true\nPRIVATE_TOKEN=secret-marker\n';
  writeFileSync(join(path,'.env'),toolSource);
  try {
    writeFrameSettings(path,{model,messaging:false});
    assert.deepEqual(readFrameSettings(path),{model,messaging:false});
    assert.equal(readFileSync(join(path,'.env'),'utf8'),toolSource);
  } finally {
    if(before.model===undefined)delete process.env.FRAME_MODEL;else process.env.FRAME_MODEL=before.model;
    if(before.thinking===undefined)delete process.env.FRAME_THINKING_LEVEL;else process.env.FRAME_THINKING_LEVEL=before.thinking;
    if(before.messaging===undefined)delete process.env.FRAME_MESSAGING;else process.env.FRAME_MESSAGING=before.messaging;
  }
});

test('frame settings are literal dotenv values without resolver or interpolation execution',()=>{
  const path=frame('literal');
  writeFileSync(join(path,'frame.env'),'# @type=number\nFRAME_MODEL="test/${OTHER}"\nFRAME_THINKING_LEVEL=low\n');
  assert.deepEqual(readFrameSettings(path),{model:{provider:'test',modelId:'${OTHER}'},thinkingLevel:'low',messaging:true});
});

test.after(()=>rmSync(directory,{recursive:true,force:true}));

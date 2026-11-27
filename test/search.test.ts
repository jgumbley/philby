import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('shared search uses the calling frame, preserves literal prompt inputs and reports provider failures',t=>{
  const root=mkdtempSync(join(tmpdir(),'philby-search-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const frames=join(root,'relocated'),caller=join(frames,'inkling'),other=join(frames,'other');
  copyFileSync(new URL('../../.env.schema',import.meta.url),join(root,'.env.schema'));
  for(const frame of [caller,other]) {
    mkdirSync(frame,{recursive:true});
    copyFileSync(new URL('../../frame-types/plain/.env.schema',import.meta.url),join(frame,'.env.schema'));
  }
  const agent=join(root,'.pi','agent');
  mkdirSync(agent,{recursive:true});
  writeFileSync(join(agent,'auth.json'),JSON.stringify({openrouter:{type:'api_key',key:'fixture-key'}}));
  const preload=join(root,'provider.mjs');
  writeFileSync(preload,`
    import assert from 'node:assert/strict';
    globalThis.fetch=async(url,options)=>{
      assert.equal(String(url),'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(new Headers(options.headers).get('authorization'),'Bearer fixture-key');
      const request=JSON.parse(options.body);
      assert.equal(request.tools[0].type,'openrouter:web_search');
      assert.equal(request.messages.at(-1).content,process.env.EXPECTED_QUERY);
      if(process.env.FAIL_SEARCH) return new Response(null,{status:503});
      const citation={type:'url_citation',url_citation:{title:'Replay rules',url:'https://docs.example/replay',content:'Recorded evidence'}};
      return Response.json({usage:{server_tool_use_details:{web_search_requests:1}},choices:[{finish_reason:'stop',message:{content:'Generated prose',annotations:[citation]}}]});
    };
  `);
  const shared=fileURLToPath(new URL('../../shared',import.meta.url));
  const query='Pi $(error unexpected-expansion) $HOME';
  function search(args:string[],input='',fail=false) {
    return spawnSync('make',['-C',shared,'search','id=other',...args],{
      cwd:caller,input,encoding:'utf8',
      env:{PATH:process.env.PATH,PHILBY_ROOT:root,PHILBY_FRAMES_DIR:frames,PHILBY_FRAME:'inkling',
        NODE_OPTIONS:`--import=${preload}`,PI_OFFLINE:'1',EXPECTED_QUERY:query,FAIL_SEARCH:fail?'1':'',
        RUSTUP_HOME:process.env.RUSTUP_HOME,CARGO_HOME:process.env.CARGO_HOME}
    });
  }
  const first=search([`prompt=${query}`]);
  assert.equal(first.status,0,first.stderr);
  assert.match(first.stdout,/^wiki\/journals\/\d{4}-\d\d-\d\d\.md\n$/);
  const path=join(caller,first.stdout.trim());
  const record=readFileSync(path,'utf8');
  for(const text of [query,'Replay rules','https://docs.example/replay','Recorded evidence']) assert.ok(record.includes(text));
  assert.ok(!record.includes('Generated prose'));
  assert.ok(!existsSync(join(other,'wiki')));
  assert.ok(!existsSync(join(caller,'.searches')));
  assert.ok(!existsSync(join(caller,'wiki','.drafts')));
  const promptFile=join(caller,'query.txt');
  writeFileSync(promptFile,query);
  for(const result of [search([`PROMPT_FILE=${promptFile}`,'prompt=unused'],'unused'),search([],query)]) {
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout,first.stdout);
  }
  const repeated=readFileSync(path,'utf8');
  assert.equal(repeated.split('Recorded evidence').length-1,3);
  const failure=search([],query,true);
  assert.notEqual(failure.status,0);
  assert.match(failure.stderr,/HTTP 503/);
  assert.equal(failure.stdout,'');
  assert.equal(readFileSync(path,'utf8'),repeated);
});

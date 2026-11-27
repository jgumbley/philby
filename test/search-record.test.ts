import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recordSearch, searchEntry } from '../src/search-record.js';

const results=[
  {title:'Tool execution',url:'https://example.org/tools',excerpt:'replay: "safe"'},
  {title:'Recovery',url:'https://example.org/recovery',excerpt:'Interrupted work'}
];

test('search evidence retains the literal query, ranked URLs and excerpts without claiming verification',()=>{
  const query='../Pi\nDurable $(error expansion)?';
  const entry=searchEntry(query,results);
  assert.match(entry,/^## \d{4}-\d\d-\d\dT.*Z — Web search/);
  assert.ok(entry.includes(query));
  assert.match(entry,/not verified findings/);
  for(const [index,result] of results.entries()) {
    assert.ok(entry.includes(`### ${index+1}. ${result.title}\n\n<${result.url}>\n\n${result.excerpt}`));
  }
  assert.match(searchEntry('empty',[]),/No results/);
  assert.throws(()=>searchEntry(' ',[]),/query is required/);
});

test('search immediately publishes to the daily journal and preserves earlier evidence',async t=>{
  const frame=mkdtempSync(join(tmpdir(),'philby-search-'));
  t.after(()=>rmSync(frame,{recursive:true,force:true}));
  const path=await recordSearch(frame,'Pi Durable tool replay',results);
  assert.match(path,/^wiki\/journals\/\d{4}-\d\d-\d\d\.md$/);
  assert.ok(!existsSync(join(frame,'.searches')));
  assert.ok(!existsSync(join(frame,'wiki','.drafts')));
  const original=readFileSync(join(frame,path),'utf8');
  assert.ok(original.includes(results[0].url));
  assert.equal(await recordSearch(frame,'Second query',[results[1]]),path);
  const updated=readFileSync(join(frame,path),'utf8');
  assert.ok(updated.startsWith(original));
  assert.match(updated.slice(original.length),/Second query[\s\S]*Recovery/);
  await Promise.all(['parallel-one','parallel-two','parallel-three'].map(query=>recordSearch(frame,query,results)));
  const concurrent=readFileSync(join(frame,path),'utf8');
  assert.ok(concurrent.startsWith(updated));
  for(const query of ['parallel-one','parallel-two','parallel-three']) assert.equal(concurrent.split(query).length-1,1);
});

test('search refuses a symlinked wiki without writing outside the frame',async t=>{
  const frame=mkdtempSync(join(tmpdir(),'philby-search-'));
  const outside=mkdtempSync(join(tmpdir(),'philby-search-outside-'));
  t.after(()=>{rmSync(frame,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});});
  symlinkSync(outside,join(frame,'wiki'));
  await assert.rejects(recordSearch(frame,'query',results),/wiki must be a directory/);
  assert.ok(!existsSync(join(outside,'journals')));
});

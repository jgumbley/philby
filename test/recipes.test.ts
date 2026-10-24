import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=mkdtempSync(join(tmpdir(),'philby-recipes-'));
process.env.PHILBY_ROOT=directory;
process.env.PHILBY_PANES_DIR=join(directory,'tools');
cpSync(new URL('../../pane-types/plain',import.meta.url),join(directory,'pane-types','plain'),{recursive:true});
const recipe=join(directory,'pane-types','fixture');
mkdirSync(recipe,{recursive:true});
writeFileSync(join(recipe,'SCOPE.md'),'Fixture responsibility');
writeFileSync(join(recipe,'Makefile'),'help:\n\t@echo fixture\n');
mkdirSync(join(recipe,'artifacts'));
const {Store,envelope,paths,prepare,paneTypes,configured}=await import('../src/store.js');

test('unknown recipes do not create a pane',()=>{
  assert.deepEqual(paneTypes(),['plain','fixture']);
  assert.throws(()=>prepare('invalid','unknown'),/Unknown pane type/);
  assert.equal(existsSync(paths('invalid').state),false);
  assert.equal(existsSync(paths('invalid').tools),false);
});

test('a queued mailbox does not choose the receiving pane type',()=>{
  const mailbox=new Store('waiting');
  const message=envelope('source','waiting','retained material',{id:'before-creation'});
  try {
    mailbox.accept(message);
    const waiting=paths('waiting');
    assert.equal(waiting.state,join(waiting.tools,'.state'));
    assert.ok(existsSync(join(waiting.state,'app.sqlite')));
    for(const file of ['SCOPE.md','Makefile','.pane-type'])assert.equal(existsSync(join(waiting.tools,file)),false);
    assert.equal(configured('waiting'),false);
    const p=prepare('waiting','fixture');
    assert.equal(configured('waiting'),true);
    assert.equal(readFileSync(join(p.tools,'.pane-type'),'utf8'),'fixture\n');
    assert.equal(readFileSync(join(p.tools,'SCOPE.md'),'utf8'),'Fixture responsibility');
    assert.ok(existsSync(join(p.tools,'artifacts')));
    assert.deepEqual(mailbox.pending(),[message]);
    assert.equal(existsSync(join(p.state,'durable.sqlite')),false);
    writeFileSync(join(p.tools,'SCOPE.md'),'Edited responsibility');
    writeFileSync(join(p.tools,'Makefile'),'help:\n\t@echo edited\n');
    prepare('waiting','fixture');
    prepare('waiting');
    assert.equal(readFileSync(join(p.tools,'SCOPE.md'),'utf8'),'Edited responsibility');
    assert.equal(readFileSync(join(p.tools,'Makefile'),'utf8'),'help:\n\t@echo edited\n');
    assert.throws(()=>prepare('waiting','plain'),/already exists with type fixture/);
    assert.deepEqual(mailbox.pending(),[message]);
  } finally {mailbox.close();}
});

test('failed scaffolding leaves no partial pane tools and can be retried',()=>{
  const broken=join(directory,'pane-types','broken');
  mkdirSync(broken);writeFileSync(join(broken,'SCOPE.md'),'incomplete');
  assert.throws(()=>prepare('incomplete','broken'),/ENOENT/);
  assert.equal(existsSync(paths('incomplete').tools),false);
  assert.equal(existsSync(join(paths('incomplete').state,'durable.sqlite')),false);
  assert.equal(readdirSync(join(directory,'tools')).some(name=>name.startsWith('.creating-')),false);
  writeFileSync(join(broken,'Makefile'),'help:\n\t@echo repaired\n');
  const p=prepare('incomplete','broken');
  assert.equal(readFileSync(join(p.tools,'SCOPE.md'),'utf8'),'incomplete');
  rmSync(join(p.tools,'Makefile'));
  assert.throws(()=>prepare('incomplete','broken'),/ENOENT/);
  assert.equal(existsSync(join(p.tools,'Makefile')),false);
});

test('legacy pane scope requires explicit migration and preserves edited tools',()=>{
  const p=paths('legacy');mkdirSync(p.tools,{recursive:true});
  writeFileSync(join(p.tools,'AGENTS.md'),'Existing instructions');
  writeFileSync(join(p.tools,'Makefile'),'help:\n\t@echo existing\n');
  assert.throws(()=>prepare('legacy'),/uses AGENTS\.md; rename it to SCOPE\.md/);
  assert.equal(existsSync(join(p.tools,'SCOPE.md')),false);
  renameSync(join(p.tools,'AGENTS.md'),join(p.tools,'SCOPE.md'));
  prepare('legacy');prepare('legacy','plain');
  assert.throws(()=>prepare('legacy','fixture'),/already exists with type plain/);
  assert.equal(readFileSync(join(p.tools,'SCOPE.md'),'utf8'),'Existing instructions');
  assert.equal(existsSync(join(p.tools,'.pane-type')),false);
});

test.after(()=>rmSync(directory,{recursive:true,force:true}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

test('state migration refuses conflicts and active panes, preserves stored bytes and tools, and is repeatable',()=>{
  const directory=mkdtempSync(join(tmpdir(),'philby-migrate-'));
  const panes=join(directory,'workspaces'),legacy=join(directory,'.philby','panes');
  const shared=fileURLToPath(new URL('../../shared',import.meta.url));
  const original=new Map<string,Buffer>();
  const migrate=()=>{
    const result=spawnSync('make',['--no-print-directory','-s','-C',shared,'migrate-state'],{
      env:{...process.env,PHILBY_ROOT:directory,PHILBY_PANES_DIR:panes},encoding:'utf8',timeout:10000
    });
    assert.equal(result.error,undefined);
    return result;
  };
  try {
    for(const name of ['alpha','beta','philby']) {
      const state=join(legacy,name),pane=join(panes,name);
      mkdirSync(state,{recursive:true});mkdirSync(pane,{recursive:true});
      writeFileSync(join(pane,'SCOPE.md'),`${name} standing scope\n`);
      writeFileSync(join(pane,'Makefile'),`help:\n\t@echo ${name} tool\n`);
      for(const file of ['durable.sqlite','app.sqlite','lock.sqlite']) {
        const path=join(state,file),db=new DatabaseSync(path);
        db.exec('CREATE TABLE preserved (value TEXT NOT NULL)');
        db.prepare('INSERT INTO preserved VALUES (?)').run(`${name}:${file}`);db.close();
        original.set(join(name,file),readFileSync(path));
      }
    }
    writeFileSync(join(panes,'alpha','.gitignore'),'local-notes');
    mkdirSync(join(legacy,'waiting'),{recursive:true});
    writeFileSync(join(legacy,'waiting','app.sqlite'),original.get(join('beta','app.sqlite'))!);
    const initialized=spawnSync('git',['-C',join(panes,'alpha'),'init','-q'],{encoding:'utf8'});
    assert.equal(initialized.status,0,initialized.stderr);
    mkdirSync(join(panes,'beta','.state'));
    writeFileSync(join(panes,'beta','.state','keep'),'existing destination');
    const conflict=migrate();
    assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/State already exists for beta/);
    assert.equal(existsSync(join(panes,'alpha','.state')),false);
    assert.deepEqual(readFileSync(join(legacy,'alpha','durable.sqlite')),original.get(join('alpha','durable.sqlite')));
    assert.equal(readFileSync(join(panes,'beta','.state','keep'),'utf8'),'existing destination');
    assert.equal(readFileSync(join(panes,'alpha','.gitignore'),'utf8'),'local-notes');
    rmSync(join(panes,'beta','.state'),{recursive:true});

    const active=new DatabaseSync(join(legacy,'alpha','lock.sqlite'));
    active.exec('BEGIN EXCLUSIVE');
    try {
      const locked=migrate();
      assert.notEqual(locked.status,0);assert.match(locked.stderr,/Close all old panes before moving state/);
      for(const name of ['alpha','beta']) {
        assert.equal(existsSync(join(panes,name,'.state')),false);
        assert.equal(existsSync(join(legacy,name,'durable.sqlite')),true);
      }
    } finally {active.close();}

    const moved=migrate();
    assert.equal(moved.status,0,moved.stderr);
    assert.deepEqual(JSON.parse(moved.stdout),{moved:3,removedCoordinator:true,verified:true});
    assert.equal(existsSync(join(directory,'.philby')),false);
    assert.equal(existsSync(join(panes,'philby')),false);
    assert.deepEqual(readFileSync(join(panes,'waiting','.state','app.sqlite')),original.get(join('beta','app.sqlite')));
    for(const file of ['SCOPE.md','Makefile','.gitignore','.pane-type'])assert.equal(existsSync(join(panes,'waiting',file)),false);
    for(const name of ['alpha','beta']) {
      for(const file of ['durable.sqlite','app.sqlite','lock.sqlite']) assert.deepEqual(readFileSync(join(panes,name,'.state',file)),original.get(join(name,file)));
      assert.equal(readFileSync(join(panes,name,'SCOPE.md'),'utf8'),`${name} standing scope\n`);
      assert.equal(readFileSync(join(panes,name,'Makefile'),'utf8'),`help:\n\t@echo ${name} tool\n`);
      assert.match(readFileSync(join(panes,name,'.gitignore'),'utf8'),/^\.state\/$/m);
    }
    assert.equal(readFileSync(join(panes,'alpha','.gitignore'),'utf8'),'local-notes\n.state/\n');
    const ignored=spawnSync('git',['-C',join(panes,'alpha'),'check-ignore','-q','.state/durable.sqlite'],{encoding:'utf8'});
    assert.equal(ignored.status,0,ignored.stderr);
    const repeated=migrate();
    assert.equal(repeated.status,0,repeated.stderr);assert.deepEqual(JSON.parse(repeated.stdout),{moved:0});
    assert.deepEqual(readFileSync(join(panes,'alpha','.state','durable.sqlite')),original.get(join('alpha','durable.sqlite')));
  } finally {rmSync(directory,{recursive:true,force:true});}
});

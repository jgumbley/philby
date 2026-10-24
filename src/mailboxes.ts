import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { panesRoot, locked, paths, Store, type Envelope } from './store.js';

export function migrateMailboxes() {
  const directory=panesRoot;
  if(!existsSync(directory)) return {migrated:0};
  const names=readdirSync(directory).filter(name=>/^[a-z0-9][a-z0-9-]{0,63}$/.test(name));
  for(const name of names) if(locked(name)) throw Error(`Close pane ${name} before migrating mailboxes`);
  let migrated=0;
  for(const name of names) {
    const file=join(paths(name).state,'app.sqlite');
    if(!existsSync(file)) continue;
    const db=new DatabaseSync(file);
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL');
      if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox'").get()) continue;
      for(const row of db.prepare('SELECT id,body FROM outbox WHERE delivered=0 ORDER BY rowid').all()) {
        const e=JSON.parse(String(row.body)) as Envelope;
        const receiving=new Store(e.to);
        try {receiving.accept(e);}finally{receiving.close();}
        db.prepare('UPDATE outbox SET delivered=1 WHERE id=?').run(row.id);
        migrated++;
      }
    } finally {db.close();}
  }
  return {migrated};
}

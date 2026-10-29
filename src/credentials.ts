import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { Credential, CredentialStore, AuthOperationOptions } from '@earendil-works/pi-ai';

export class ProviderCredentials implements CredentialStore {
  constructor(private readonly directory:string) {}
  private async transaction<T>(run:(db:DatabaseSync)=>Promise<T>,options?:AuthOperationOptions):Promise<T> {
    const signal=AbortSignal.any([AbortSignal.timeout(30_000),...(options?.signal?[options.signal]:[])]);
    signal.throwIfAborted();
    const state=join(this.directory,'.state');
    mkdirSync(state,{recursive:true,mode:0o700});
    const path=join(state,'providers.sqlite');
    closeSync(openSync(path,'a',0o600));
    chmodSync(path,0o600);
    const db=new DatabaseSync(path);
    try {
      for(;;) {
        signal.throwIfAborted();
        try {db.exec('BEGIN IMMEDIATE');break;}
        catch(error) {
          if((error as {errcode?:number}).errcode!==5) throw error;
          await setTimeout(25,undefined,{signal});
        }
      }
      db.exec('CREATE TABLE IF NOT EXISTS credentials (provider TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS installation (id INTEGER PRIMARY KEY CHECK(id=1), device TEXT NOT NULL)');
      const result=await run(db);
      db.exec('COMMIT');
      return result;
    } finally {db.close();}
  }
  private credential(db:DatabaseSync,providerId:string):Credential|undefined {
    const row=db.prepare('SELECT value FROM credentials WHERE provider=?').get(providerId);
    if(!row) return undefined;
    try {
      const value=JSON.parse(String(row.value));
      if(value?.type==='api_key' || (value?.type==='oauth' && typeof value.access==='string' && typeof value.refresh==='string' && Number.isFinite(value.expires))) return value;
    } catch {}
    throw Error(`Invalid stored credential for ${providerId}`);
  }
  read(providerId:string,options?:AuthOperationOptions) {
    return this.transaction(async db=>this.credential(db,providerId),options);
  }
  list(options?:AuthOperationOptions) {
    return this.transaction(async db=>db.prepare('SELECT provider FROM credentials ORDER BY provider').all().map(row=>{
      const providerId=String(row.provider);
      return {providerId,type:this.credential(db,providerId)!.type};
    }),options);
  }
  modify(providerId:string,fn:(current:Credential|undefined)=>Promise<Credential|undefined>,options?:AuthOperationOptions) {
    return this.transaction(async db=>{
      const current=this.credential(db,providerId);
      let next:Credential|undefined;
      try {next=await fn(current);}
      catch(error) {
        let message=error instanceof Error?error.message:'Credential update failed';
        const secrets=current?.type==='oauth'?[current.access,current.refresh]:[current?.key];
        for(const secret of secrets) if(secret) message=message.replaceAll(secret,'[redacted]');
        throw Error(message);
      }
      if(next!==undefined) db.prepare('INSERT INTO credentials(provider,value) VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET value=excluded.value').run(providerId,JSON.stringify(next));
      return next===undefined?current:next;
    },options);
  }
  async delete(providerId:string,options?:AuthOperationOptions) {
    await this.transaction(async db=>{db.prepare('DELETE FROM credentials WHERE provider=?').run(providerId);},options);
  }
  deviceId() {
    return this.transaction(async db=>{
      db.prepare('INSERT OR IGNORE INTO installation(id,device) VALUES (1,?)').run(randomUUID());
      return String(db.prepare('SELECT device FROM installation WHERE id=1').get()!.device);
    });
  }
}

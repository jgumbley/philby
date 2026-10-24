import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { root, panesRoot, slug, Store, envelope, locked, lock, configured, paneTypes, paths } from './store.js';
import { migrateMailboxes } from './mailboxes.js';
import { request, running } from './ipc.js';
import { models } from './models.js';
import { Pane, capture, ctx } from './pane.js';
import { selectPane, startTui } from './tui.js';
import { openPane, openSelector, listViews, openShell, stopServer } from '../tmux/index.js';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function saved() {return existsSync(panesRoot)?readdirSync(panesRoot).filter(s=>/^[a-z0-9][a-z0-9-]*$/.test(s) && configured(s)):[];}
async function prompt() {
  if(process.env.PROMPT_FILE) return readFileSync(process.env.PROMPT_FILE,'utf8');
  if(process.env.PROMPT) return process.env.PROMPT;
  if(process.stdin.isTTY) throw Error('Supply PROMPT_FILE, prompt, or stdin');
  return readFileSync(0,'utf8');
}
async function send(name:string|undefined,kind:'input'|'update') {
  if(!name) throw Error('Supply slug=<receiving-pane> for send or report');
  name=slug(name);
  const sender=process.env.from || process.env.PHILBY_PANE;
  if(!sender) throw Error('Supply from=<sending-pane> or run from a pane');
  const from=slug(sender);
  const content=await prompt();
  const e=envelope(from,name,content,{...(process.env.REQUEST_ID?{id:process.env.REQUEST_ID}:{}),kind,mode:process.env.MODE==='steer'?'steer':'followUp'});
  const store=new Store(name);
  try {console.log(JSON.stringify({accepted:store.accept(e)}));} finally {store.close();}
}
async function cleanup(current?:Pane) {
  const others=()=>saved().filter(s=>s!==current?.name);
  for(const s of others()) if(await running(s)) await request(s,{op:'close'});
  for(let i=0;i<300 && others().some(locked);i++) await sleep(100);
  if(others().some(locked)) throw Error('Cleanup timed out waiting for graceful pane closure');
  await current?.close();
  stopServer();
}
async function main() {
  const command=process.argv[2] || 'open';const destination=process.argv[3] || process.env.slug;
  const type=process.env.TYPE || undefined;
  for(const key of ['slug','TYPE','MAKEFLAGS','MAKEOVERRIDES','MFLAGS','MAKELEVEL']) delete process.env[key];
  if(command==='name') return selectPane(openPane,await Promise.all(saved().sort().map(async name=>({name,running:!!await running(name)}))),paneTypes());
  if(command==='new') return openSelector();
  if(command==='open') return destination?openPane(slug(destination),type):openSelector();
  if(command==='migrate-mailboxes') {console.log(JSON.stringify(migrateMailboxes()));return;}
  if(command==='send' || command==='report') return send(destination,command==='report'?'update':'input');
  if(command==='list') {
    console.log('Agent slug\tState (saved = closed)');
    for(const s of saved()) console.log(`${s}\t${await running(s)?'running':'saved'}`);
    process.stdout.write(listViews());
    return;
  }
  if(command==='cleanup') return cleanup();
  if(command==='quit') {
    const input=createInterface({input:process.stdin,output:process.stdout});
    process.stdout.write('Quit all Philby panes? [y/n] ');
    for await(const answer of input) {
      const choice=answer.trim().toLowerCase();
      if(choice!=='y' && choice!=='n') {process.stdout.write('Quit all Philby panes? [y/n] ');continue;}
      input.close();
      if(choice==='y') await cleanup();else console.log('Quit cancelled.');
      return;
    }
    console.log('Quit cancelled.');return;
  }
  if(command==='window') return openShell();
  if(command==='consult') {
    const route=process.env.ROUTE || 'ask';
    const defaults:Record<string,string>={ask:'z-ai/glm-5.2',reason:'openai/gpt-5.5',twitter:'x-ai/grok-4.3:online'};
    if(!Object.hasOwn(defaults,route)) throw Error(`Unknown consultation route: ${route}`);
    const id=(process.env[route.toUpperCase()+'_MODEL'] || defaults[route]).replace(/^openrouter\//,'');
    const config=await models(id);
    const {MemoryStorage}=await import('@earendil-works/pi-durable');
    const harness=await Harness.open(new MemoryStorage(),{models:config.models,registry:createRegistry()},ctx);
    try {
      const conversation=await harness.root(ctx,{agent:{model:config.model}});
      const result=await (await conversation.submit({type:'input',content:await prompt()},ctx)).wait(ctx);
      if(result.status!=='done') throw Error(`Consultation failed: ${JSON.stringify(result)}`);
      const history=await conversation.context(ctx);
      const answer=history.messages.filter(m=>m.role==='assistant').at(-1);
      console.log(answer?.content.filter(c=>c.type==='text').map(c=>c.text).join(''));
    } finally {await harness.close(ctx);}return;
  }
  const selected=destination || process.env.PHILBY_PANE;
  if(!selected) throw Error(`Supply slug=<pane> for ${command}, or run from a pane`);
  const name=slug(selected);
  if(command==='serve') {
    const config=await models();const pane=await Pane.open(name,config.models,config.model);
    const close=()=>{void pane.close().catch(e=>{console.error(String(e));process.exitCode=1;});};
    for(const signal of ['SIGTERM','SIGINT','SIGHUP'] as const) process.on(signal,close);
    if(process.stdin.isTTY) await startTui(pane,()=>cleanup(pane));
    return;
  }
  if(command==='capture' && !await running(name)) {
    const path=join(paths(name).state,'durable.sqlite');if(!existsSync(path)) throw Error('No saved conversation');
    const release=lock(name);
    const h=await Harness.open(await openNodeSqliteStorage(path),{models:createModels(),registry:createRegistry()},ctx);
    try {console.log(JSON.stringify(await capture(await h.root(ctx),process.env.ALL==='1'),null,2));}finally{await h.close(ctx);release();}return;
  }
  const op:Record<string,unknown>={op:command==='new-session'?'new':command};
  if(command==='memory' && process.env.FIELD) Object.assign(op,{field:process.env.FIELD,content:await prompt()});
  if(command==='check-set') op.check=JSON.parse(await prompt());
  if(command==='check-pause' || command==='check-remove') Object.assign(op,{id:process.env.ID,paused:process.env.PAUSED!=='false'});
  if(command==='plan-set') {
    const activeEnv=process.env.ACTIVE;
    if(activeEnv!=='0' && activeEnv!=='1' && activeEnv!=='true' && activeEnv!=='false') throw Error(`ACTIVE must be 0, 1, true, or false; got: ${activeEnv}`);
    op.active=activeEnv==='1'||activeEnv==='true';
    if(process.env.PLAN!==undefined && process.env.PLAN.trim()) op.plan=process.env.PLAN;
    else if(!op.active && (process.env.PROMPT_FILE || process.env.PROMPT || !process.stdin.isTTY)) {
      const text=await prompt();
      if(text.trim()) op.plan=text;
    }
  }
  if(command==='updates') op.mark=process.env.MARK==='1';
  if(command==='capture') op.all=process.env.ALL==='1';
  console.log(JSON.stringify(await request(name,op as {op:string}),null,2));
}
main().catch(e=>{console.error(String(e));process.exitCode=1;});

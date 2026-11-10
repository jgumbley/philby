import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { root, framesRoot, slug, Store, envelope, locked, lock, configured, frameTypes, paths, prepare } from './store.js';
import { applyEnvironment, frameEnvironment } from './config.js';
import { readFrameSettings } from './frame-config.js';
import { request, running } from './ipc.js';
import { migrateFrames } from './migration.js';
import { models } from './models.js';
import { modelReference } from './providers.js';
import { Frame, capture, ctx, migrateFrameSettings } from './frame.js';
import { selectFrame, startTui } from './tui.js';
import { openFrame, openSelector, listViews, openShell, closeBrowsers, stopServer } from '../tmux/index.js';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function saved() {return existsSync(framesRoot)?readdirSync(framesRoot).filter(s=>/^[a-z0-9][a-z0-9-]*$/.test(s) && configured(s)):[];}
async function prompt() {
  if(process.env.PROMPT_FILE) return readFileSync(process.env.PROMPT_FILE,'utf8');
  if(process.env.PROMPT) return process.env.PROMPT;
  if(process.stdin.isTTY) throw Error('Supply PROMPT_FILE, prompt, or stdin');
  return readFileSync(0,'utf8');
}
async function send(name:string|undefined,kind:'input'|'update') {
  if(!name) throw Error('Supply slug=<receiving-frame> for send or report');
  name=slug(name);
  const sender=process.env.from || process.env.PHILBY_FRAME;
  if(!sender) throw Error('Supply from=<sending-frame> or run from a frame');
  const from=slug(sender);
  const content=await prompt();
  const e=envelope(from,name,content,{...(process.env.REQUEST_ID?{id:process.env.REQUEST_ID}:{}),kind,mode:process.env.MODE==='steer'?'steer':'followUp'});
  const store=new Store(name);
  try {console.log(JSON.stringify({accepted:store.accept(e)}));} finally {store.close();}
}
async function cleanup(current?:Frame) {
  const others=()=>saved().filter(s=>s!==current?.name);
  for(const s of others()) if(await running(s)) await request(s,{op:'close'});
  for(let i=0;i<300 && others().some(locked);i++) await sleep(100);
  if(others().some(locked)) throw Error('Cleanup timed out waiting for graceful frame closure');
  await current?.close();
  await closeBrowsers();
  stopServer();
}
async function main() {
  const command=process.argv[2] || 'open';const destination=process.argv[3] || process.env.slug;
  const type=process.env.TYPE || undefined;
  if(command==='config-check') {console.log('Instance configuration valid.');return;}
  if(command==='migrate') {
    console.log(JSON.stringify(migrateFrames(process.env.INPUT || join(root,'panes'),framesRoot),null,2));
    console.log('Reopen migrated frames before further work; existing processes retain their old paths.');
    return;
  }
  for(const key of ['slug','TYPE','MAKEFLAGS','MAKEOVERRIDES','MFLAGS','MAKELEVEL']) delete process.env[key];
  if(command==='name') return selectFrame(openFrame,await Promise.all(saved().sort().map(async name=>({name,running:!!await running(name)}))),frameTypes());
  if(command==='new') return openSelector();
  if(command==='open') return destination?openFrame(slug(destination),type):openSelector();
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
    process.stdout.write('Quit all Philby frames? [y/n] ');
    for await(const answer of input) {
      const choice=answer.trim().toLowerCase();
      if(choice!=='y' && choice!=='n') {process.stdout.write('Quit all Philby frames? [y/n] ');continue;}
      input.close();
      if(choice==='y') await cleanup();else console.log('Quit cancelled.');
      return;
    }
    console.log('Quit cancelled.');return;
  }
  if(command==='window') return openShell();
  if(command==='consult') {
    if(process.env.PHILBY_FRAME) {
      const frame=slug(process.env.PHILBY_FRAME);
      applyEnvironment(frameEnvironment(paths(frame).tools,frame,framesRoot));
    }
    const route=process.env.ROUTE || 'ask';
    if(!['ask','reason','twitter'].includes(route)) throw Error(`Unknown consultation route: ${route}`);
    const id=process.env[route.toUpperCase()+'_MODEL'];
    if(!id) throw Error(`Missing ${route.toUpperCase()}_MODEL`);
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
  const selected=destination || process.env.PHILBY_FRAME;
  if(!selected) throw Error(`Supply slug=<frame> for ${command}, or run from a frame`);
  const name=slug(selected);
  if(command==='config-migrate') {console.log(JSON.stringify(await migrateFrameSettings(name)));return;}
  if(command==='frame-config-check') {
    frameEnvironment(paths(name).tools,name,framesRoot);
    if(!readFrameSettings(paths(name).tools)) throw Error('Missing frame.env; open a new frame or run make frame-config-migrate for a saved frame');
    console.log(`Frame ${name} configuration valid.`);return;
  }
  if(command==='serve') {
    const environment=frameEnvironment(prepare(name).tools,name,framesRoot);
    applyEnvironment(environment);
    const config=await models();const frame=await Frame.open(name,config.models,()=>config.model ?? modelReference(process.env.DEFAULT_MODEL),environment);
    const close=()=>{void frame.close().catch(e=>{console.error(String(e));process.exitCode=1;});};
    for(const signal of ['SIGTERM','SIGINT','SIGHUP'] as const) process.on(signal,close);
    if(process.stdin.isTTY) await startTui(frame,()=>cleanup(frame));
    return;
  }
  if(command==='capture' && !await running(name)) {
    const path=join(paths(name).state,'durable.sqlite');if(!existsSync(path)) throw Error('No saved conversation');
    const release=lock(name);
    const h=await Harness.open(await openNodeSqliteStorage(path),{models:createModels(),registry:createRegistry()},ctx);
    try {console.log(JSON.stringify(await capture(await h.root(ctx),process.env.ALL==='1'),null,2));}finally{await h.close(ctx);release();}return;
  }
  const op:Record<string,unknown>={op:command==='new-session'?'new':command};
  if(command==='thinking') {
    if(!process.env.LEVEL) throw Error('Supply LEVEL=off|minimal|low|medium|high|xhigh|max|default');
    op.level=process.env.LEVEL==='default'?null:process.env.LEVEL;
  }
  if(command==='memory' && process.env.FIELD) Object.assign(op,{field:process.env.FIELD,content:await prompt()});
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

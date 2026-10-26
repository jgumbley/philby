import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createRegistry, defineDoc, defineExtension, defineTask, section, wrapTool, Harness, LiveDoc, InboxDoc, ResetEntry, type Conversation, type TaskId, type ToolRegistration } from '@earendil-works/pi-durable';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import type { Models } from '@earendil-works/pi-ai/models';
import { join } from 'node:path';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import type { Server } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { envelope, lock, nextDeadline, prepare, paths, root, panesRoot, Store, type Check, type Envelope } from './store.js';
import { listen, type Command } from './ipc.js';
import { modelChoices, type ModelChoice } from './models.js';
export { ctx };
export type ModelSelection = {current:{provider:string;modelId:string};choices:ModelChoice[]};
export const Memory = defineDoc({ kind:'philby.memory', version:1, scope:'conversation', history:'latest', fork:'initial', initial: () => ({ responsibilities:'', notes:'', decisions:'', outstanding:'', sources:'' }) });
export const Checks = defineDoc<{ items: Check[] }>({ kind:'philby.checks', version:1, scope:'conversation', history:'latest', fork:'initial', initial: () => ({ items:[] }) });
export const PlanMode = defineDoc<{ active:boolean; plan:string }>({ kind:'philby.plan', version:1, scope:'conversation', history:'latest', fork:'initial', initial: () => ({ active:false, plan:'' }) });
export async function capture(conversation:Conversation, all=false) {
  if(!all) return (await conversation.context(ctx)).entries;
  const entries=[];
  let cursor;
  do {
    const page=await conversation.entries({order:'ascending'},100,cursor,ctx);
    entries.push(...page.items);
    cursor=page.next;
  } while(cursor);
  return entries;
}
const planModeBlocked = [{type:'text' as const, text:'Tool is not available in PLAN MODE. You may read files using the read tool, but you may not edit files or run shell commands. Present your plan and ask the user to exit plan mode with \'/plan off\' to implement it.'}];
const PLAN_MODE_PROMPT = [
'You are an experienced technical leader who is inquisitive and an excellent planner.',
'In PLAN MODE, the goal is to gather information and get context to create a detailed plan for accomplishing the task, which the user will review and approve before they switch you out of plan mode to implement the solution.',
'',
'Rules:',
'1. Do some information gathering, using the read tool to examine files and understand the codebase. You may not edit files or run shell commands while in plan mode.',
'2. Ask the user clarifying questions to get a better understanding of the task.',
'3. Once you have gained more context, break the task down into clear, actionable steps and present a detailed numbered plan for how you will accomplish it.',
'4. Ask the user if they are pleased with this plan, or if they would like to make any changes. Treat this as a brainstorming session where you can discuss the task and refine the plan.',
'5. You do not have the ability to leave plan mode yourself; you must wait for the user to do it once they are satisfied. When you have reached a good plan, ask the user to exit plan mode with \'/plan off\' so you can implement the solution.',
'',
'Focus on creating a clear, actionable plan rather than a lengthy document. Never provide level-of-effort time estimates; focus solely on breaking the work down into clear steps.'
].join('\n');
function planGate(tool: ToolRegistration) {
  return wrapTool(tool, current => ({...current, execute: async (args, api, context) => {
    if ((await api.snapshot(PlanMode, api.conversationId, context))?.active) return {output: planModeBlocked};
    return current.execute(args, api, context);
  }}));
}
const Startup = defineTask<{prompt:string}, {phase:'startup'}, null>({
  name:'philby.startup', version:1, initial:()=>({phase:'startup'}),
  phases:{startup:async(task,runtime,context)=>{
    const conversation=(await runtime.conversation(runtime.conversationId,context))!;
    const submission=await conversation.submit({type:'input',whenBusy:'followUp',requestId:`startup:${task.id}`,entry:{kind:'philby.startup'},content:`Opening checklist from BOOT.md:\n${task.input.prompt}\nInspect current state before changing it. Use the pane's Make targets and verify the result. Report failures explicitly.`},context);
    const result=await submission.wait(context);
    if(result.status!=='done') throw Error(`Opening checklist ${result.status}`);
    await runtime.commit(()=>({status:'terminal',outcome:{status:'completed',result:null}}),context);
  }},
  abort:async(_task,runtime,context)=>{await runtime.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),context);}
});
const Reviews = defineTask<{ id:string; prompt:string }, { phase:'review' }, null>({
  name:'philby.review', version:1, initial: () => ({phase:'review'}),
  phases: {
    review: async (task, runtime, context) => {
      const conversation = (await runtime.conversation(runtime.conversationId, context))!;
      const submission = await conversation.submit({ type:'input', whenBusy:'followUp', requestId:`review:${task.id}`, entry:{kind:'philby.review',data:{id:task.input.id}}, content:`Recurring review ${task.input.id}:\n${task.input.prompt}\nIf unchanged, answer exactly NO_CHANGE. Report meaningful changes, blockers or decisions here.` }, context);
      await submission.wait(context);
      await runtime.commit(() => ({status:'terminal', outcome:{status:'completed', result:null}}), context);
    }
  },
  abort: async (_task, runtime, context) => { await runtime.commit(() => ({status:'terminal', outcome:{status:'aborted'}}), context); }
});
export class Pane {
  harness!: Harness;
  conversation!: Conversation;
  store!: Store;
  env!: NodeExecutionEnv;
  release!: () => void;
  server?: Server;
  timer?: ReturnType<typeof setInterval>;
  closing = false;
  ticking?: Promise<void>;
  onClose?: () => void;
  onError: (error: unknown) => void = e => console.error(String(e));
  private closure?: Promise<void>;
  private boot = false;
  private readonly makefiles: Record<string,string>;
  private constructor(readonly name: string, private readonly models: Models) {
    this.makefiles={shared:join(root,'shared','Makefile'),pane:join(paths(name).tools,'Makefile')};
  }
  private tools() {
    return Object.fromEntries(Object.entries(this.makefiles).map(([name,file])=>[name,readFileSync(file,'utf8')]));
  }
  static async open(name: string, models: Models, model: {provider:string; modelId:string}) {
    const p = new Pane(name,models);
    p.release = lock(name);
    try {
      const dirs = prepare(name);
      const guidance=readFileSync(join(root,'PANE.md'),'utf8');
      const scope=readFileSync(join(dirs.tools,'SCOPE.md'),'utf8');
      p.tools();
      const boot=existsSync(join(dirs.tools,'BOOT.md')) ? readFileSync(join(dirs.tools,'BOOT.md'),'utf8').trim() : '';
      p.store = new Store(name);
      p.env = new NodeExecutionEnv({cwd:dirs.tools, shellEnv:{...process.env, PHILBY_PANE:name, PHILBY_ROOT:root, PHILBY_PANES_DIR:panesRoot}});
      const registry = createRegistry(); registry.install(CodingTools);
      registry.install(defineExtension({name:'philby', tasks:[Reviews,Startup], sections:[
        section('pane', () => `Your pane is ${name}. Your working directory is ${dirs.tools}. Philby's root is ${root}. Shared capabilities are in ${root}/shared/Makefile. Your tools receive PHILBY_PANE, PHILBY_ROOT and PHILBY_PANES_DIR.`),
        section('pane-guidance', () => guidance || undefined),
        section('pane-scope', () => scope || undefined),
        ...Object.entries(p.makefiles).map(([name,file])=>section(`${name}-tools`,()=>{
          let source: string;
          try {source=readFileSync(file,'utf8');}
          catch(error) {p.onError(error);source=`ERROR reading Makefile: ${String(error)}`;}
          return `Source: ${file}\n\n${source}`;
        })),
        section('unread-updates', () => JSON.stringify(p.store.updates().filter(u=>!u.seen).slice(-50))),
        section('saved-memory', async (input, context) => JSON.stringify(await input.read.snapshot(Memory, input.conversationId, context))),
        section('plan-mode', async (input, context) => (await input.read.snapshot(PlanMode, input.conversationId, context))?.active ? PLAN_MODE_PROMPT : undefined),
        section('approved-plan', async (input, context) => { const doc = await input.read.snapshot(PlanMode, input.conversationId, context); return doc && !doc.active && doc.plan ? `Approved plan:\n${doc.plan}` : undefined; })
      ], wraps: CodingTools.tools!.filter(tool => tool.name !== 'read').map(planGate)}));
      p.harness = await Harness.open(await openNodeSqliteStorage(join(dirs.state,'durable.sqlite')), {models, registry, env: () => p.env, onReport:e => p.onError(e)}, ctx);
      p.conversation = await p.harness.root(ctx, {agent:{model, cwd:dirs.tools}});
      const selected=(await p.conversation.agent(ctx)).model;
      if(!selected) throw Error('Saved conversation has no model');
      if(!models.getModel(selected.provider,selected.modelId)) throw Error(`Saved model unavailable: ${selected.provider}/${selected.modelId}`);
      await p.conversation.commit(async tx => { await tx.doc(Memory,p.conversation.id); await tx.doc(Checks,p.conversation.id); await tx.doc(PlanMode,p.conversation.id); },ctx);
      p.server = await listen(name, c => p.operation(c));
      const startup=(await p.harness.inspect(ctx)).tasks.some(t=>t.record.kind==='philby.startup');
      p.boot=!!boot || startup;
      await p.tick();
      if(boot && !startup) await p.conversation.commit(tx=>tx.createTask(Startup,{prompt:boot},{ownership:{kind:'conversation'},background:true}),ctx);
      p.harness.resume();
      p.timer = setInterval(() => { void p.tick().catch(p.onError); },500);
      return p;
    } catch(e) { await p.close(); throw e; }
  }
  async operation(c: Command): Promise<unknown> {
    if (this.closing) throw Error('Pane is closing');
    switch(c.op) {
      case 'status': return {slug:this.name,pid:process.pid, memory:await this.harness.snapshot(Memory,this.conversation.id,ctx), checks:await this.harness.snapshot(Checks,this.conversation.id,ctx), updates:this.store.updates(), work:await this.harness.inspect(ctx)};
      case 'model': {
        if(c.modelId !== undefined) {
          if(typeof c.provider !== 'string' || typeof c.modelId !== 'string' || !this.models.getModel(c.provider,c.modelId)) throw Error(`Model unavailable: ${c.provider}/${c.modelId}`);
          await this.conversation.configure({model:{provider:c.provider,modelId:c.modelId}},ctx);
        }
        const current=(await this.conversation.agent(ctx)).model;
        if(!current) throw Error('Pane has no configured model');
        const choices=modelChoices(this.models);
        if(!choices.some(choice=>choice.provider===current.provider && choice.modelId===current.modelId)) choices.unshift({...current,label:current.modelId,description:'Current model'});
        return {current,choices} satisfies ModelSelection;
      }
      case 'input': {
        const content = String(c.content ?? ''); if (!content.trim()) throw Error('Empty prompt');
        const sub = await this.conversation.submit({type:'input',content,requestId:c.id ? String(c.id) : undefined,whenBusy:c.mode === 'steer' ? 'steer' : 'followUp'},ctx);
        return {accepted:sub.id};
      }
      case 'receive': this.store.accept(c.envelope as Envelope); return {persisted:true};
      case 'send': {
        const e = envelope(this.name,String(c.to),String(c.content ?? ''),{...(c.id ? {id:String(c.id)} : {}),kind:c.kind === 'update' ? 'update' : 'input',mode:c.mode === 'steer' ? 'steer' : 'followUp'});
        const receiving = new Store(e.to);
        try { receiving.accept(e); return {accepted:e.id}; }
        finally { receiving.close(); }
      }
      case 'stop': {
        const live = (await this.conversation.viewState(ctx));
        const data = live.value.docs['pi.live'] as any;
        live.dispose();
        if (data?.run?.taskId) {
          await this.harness.abortTask(data.run.taskId,ctx);
          await this.harness.waitForTask(data.run.taskId,ctx);
        }
        await this.wakeQueue();
        return {stopped:true};
      }
      case 'close': await this.close(); return {closed:true};
      case 'memory': {
        if (c.field === undefined) return this.harness.snapshot(Memory,this.conversation.id,ctx);
        if (!['responsibilities','notes','decisions','outstanding','sources'].includes(String(c.field))) throw Error('Unknown memory field');
        await this.conversation.commit(async tx => { const memory = await tx.doc(Memory,this.conversation.id); memory[c.field as keyof typeof memory] = String(c.content ?? ''); },ctx);
        return {saved:true};
      }
      case 'checks': return this.harness.snapshot(Checks,this.conversation.id,ctx);
      case 'plan': return this.harness.snapshot(PlanMode,this.conversation.id,ctx);
      case 'plan-set': {
        const active = c.active;
        if(typeof active !== 'boolean') throw Error('active must be a boolean');
        if(c.plan !== undefined && typeof c.plan !== 'string') throw Error('plan must be a string');
        let saved: {active:boolean; plan:string} | undefined;
        await this.conversation.commit(async tx => {
          if(active) {
            const live = await tx.doc(LiveDoc, this.conversation.id);
            if(live.run) throw Error('Cannot enter plan mode while work is active. Wait for current work to complete or stop it with /stop.');
          }
          const doc = await tx.doc(PlanMode,this.conversation.id);
          doc.active=active;
          if(typeof c.plan==='string' && c.plan.trim()) doc.plan=c.plan;
          saved={active:doc.active,plan:doc.plan};
        },ctx);
        return saved;
      }
      case 'new': {
        await this.conversation.commit(async tx => {
          const live = await tx.doc(LiveDoc, this.conversation.id);
          if(live.run) throw Error('Cannot start a new session while work is active. Wait for current work to complete or stop it with /stop.');
          const inbox = await tx.doc(InboxDoc, this.conversation.id);
          if(inbox.items.length > 0) throw Error('Cannot start a new session while work is queued. Wait for queued work to complete or stop it with /stop.');
          const pending = this.store.pending().filter(e => e.kind === 'input');
          if(pending.length > 0) throw Error('Cannot start a new session while messages are pending delivery. Wait for delivery or stop the pane.');
          const plan = await tx.doc(PlanMode, this.conversation.id);
          plan.active = false;
          plan.plan = '';
          await tx.appendEntry(ResetEntry, this.conversation.id, {head:'self'});
        },ctx);
        return {reset:true};
      }
      case 'check-set': {
        const value = c.check as Check;
        if (!value?.id || !value.prompt?.trim()) throw Error('Review ID and prompt required');
        if(value.intervalMs !== undefined && value.daily !== undefined) throw Error('Choose intervalMs or daily');
        const check: Check = {id:value.id,prompt:value.prompt,timezone:value.timezone || 'Europe/Isle_of_Man',paused:!!value.paused,...(value.intervalMs !== undefined ? {intervalMs:value.intervalMs} : {daily:value.daily}),next:0};
        check.next = nextDeadline(check,Date.now());
        await this.conversation.commit(async tx => { const doc = await tx.doc(Checks,this.conversation.id); const old = doc.items.find(i=>i.id===check.id); if (old?.task) check.task=old.task; doc.items=doc.items.filter(i=>i.id!==check.id);doc.items.push(check); },ctx);
        return check;
      }
      case 'check-pause': case 'check-remove': {
        let task: number|undefined;
        await this.conversation.commit(async tx => { const doc = await tx.doc(Checks,this.conversation.id);const check=doc.items.find(i=>i.id===c.id); if(!check) throw Error('Unknown review'); task=check.task; if(c.op==='check-remove') doc.items=doc.items.filter(i=>i.id!==c.id);else check.paused=c.paused !== false; },ctx);
        if(task && (c.op==='check-remove' || c.paused !== false)) {
          await this.harness.abortTask(task as TaskId,ctx);
          const submission=await this.conversation.commit(tx=>tx.submissionByRequest(this.conversation.id,`review:${task}`),ctx);
          if(submission) {
            const result=await this.harness.abortSubmission(submission.id,ctx);
            if(result==='already_placed') {
              const view=await this.conversation.viewState(ctx);
              const live=view.value.docs['pi.live'] as any; view.dispose();
              if(live?.run?.inputs?.includes(submission.id)) await this.harness.abortTask(live.run.taskId,ctx);
            }
          }
        }
        return {saved:true};
      }
      case 'updates': return this.store.updates(!!c.mark);
      case 'tools': return this.tools();
      case 'capture': return capture(this.conversation,c.all===true);
      default: throw Error(`Unknown operation: ${c.op}`);
    }
  }
  tick() {
    if (this.closing) return Promise.resolve();
    if(this.ticking) return this.ticking;
    this.ticking = this.pump().finally(() => {this.ticking=undefined;});
    return this.ticking;
  }
  private async wakeQueue() {
    const work=await this.harness.inspect(ctx);
    if(work.tasks.some(t=>t.record.kind==='pi.generation')) return;
    const queued=work.submissions.find(s=>s.status==='queued' && s.type==='input');
    if(queued) await this.conversation.submit({type:'write',requestId:`drain:${queued.id}`,entry:{kind:'philby.queue-resumed',model:[]}},ctx);
  }
  private async pump() {
    for (const e of this.store.pending()) {
      if(this.closing) return;
      if(e.kind==='input') await this.conversation.submit({type:'input',content:`[From ${e.from}]\n${e.content}`,requestId:`message:${e.id}`,whenBusy:e.mode},ctx);
      this.store.placed(e);
    }
    await this.wakeQueue();
    const checks = await this.harness.snapshot(Checks,this.conversation.id,ctx);
    for (const check of checks?.items || []) {
      if(this.closing) return;
      const task = check.task ? await this.harness.getTask(check.task as TaskId,ctx) : undefined;
      if(task && task.state.status !== 'terminal') continue;
      if(check.paused || check.next > Date.now()) continue;
      await this.conversation.commit(async tx => {
        const doc = await tx.doc(Checks,this.conversation.id);
        const item = doc.items.find(i=>i.id===check.id);
        if(!item || item.paused || item.next > Date.now() || item.task !== check.task) return;
        item.task = await tx.createTask(Reviews,{id:item.id,prompt:item.prompt},{ownership:{kind:'conversation'},background:true});
        item.next = nextDeadline(item,Date.now());
      },ctx);
    }
  }
  close() {
    if(this.closure) return this.closure;
    this.closing=true;
    this.closure=(async()=>{
      clearInterval(this.timer);
      this.server?.close();
      try { await this.ticking; }
      finally {
        try { await this.harness?.close(ctx); }
        finally {
          try {
            if(this.boot) await promisify(execFile)('make',['--no-print-directory','-C',paths(this.name).tools,'close'],{env:{...process.env,PHILBY_ROOT:root,PHILBY_PANES_DIR:panesRoot,PHILBY_PANE:this.name},timeout:60000});
          }
          finally {
            try { await this.env?.cleanup(ctx); }
            finally {
              this.store?.close();
              rmSync(paths(this.name).socket,{force:true});
              this.release();this.onClose?.();
            }
          }
        }
      }
    })();
    return this.closure;
  }
}

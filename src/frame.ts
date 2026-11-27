import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createRegistry, defineDoc, defineExtension, defineTask, section, wrapTool, configure, Harness, AgentDoc, LiveDoc, InboxDoc, ResetEntry, ROOT_CONVERSATION_ID, type Conversation, type ToolRegistration } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import type { Models } from '@earendil-works/pi-ai/models';
import { join } from 'node:path';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import type { Server } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lock, prepare, paths, root, framesRoot } from './store.js';
import { listen, type Command } from './ipc.js';
import { modelChoices, refreshModels, type ModelChoice } from './models.js';
import type { ModelReference } from './providers.js';
import { harnessSettings, modelThinkingLevel } from './settings.js';
import { frameEnvironment } from './config.js';
import { frameContext } from './frame-context.js';
import { FrameSettingsWriteError, readFrameSettings, resolveToolSources, writeFrameSettings, type FrameSettings } from './frame-config.js';
import { closeFramePanes, listFramePanes, startPane, stopPane } from '../tmux/index.js';
export { ctx };
export type ModelSelection = {current:{provider:string;modelId:string};choices:ModelChoice[];errors:string[]};
export const Memory = defineDoc({ kind:'philby.memory', version:1, scope:'conversation', history:'latest', fork:'initial', checkpointWhen:()=>true, initial: () => ({ responsibilities:'', notes:'', decisions:'', outstanding:'', sources:'' }) });
export const PlanMode = defineDoc<{ active:boolean; plan:string }>({ kind:'philby.plan', version:1, scope:'conversation', history:'latest', fork:'initial', checkpointWhen:()=>true, initial: () => ({ active:false, plan:'' }) });
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
    const submission=await conversation.submit({type:'input',whenBusy:'followUp',requestId:`startup:${task.id}`,entry:{kind:'philby.startup'},content:`Opening checklist from BOOT.md:\n${task.input.prompt}\nInspect current state before changing it. Use the frame's Make targets and verify the result. Report failures explicitly.`},context);
    const result=await submission.wait(context);
    if(result.status!=='done') throw Error(`Opening checklist ${result.status}`);
    await runtime.commit(()=>({status:'terminal',outcome:{status:'completed',result:null}}),context);
  }},
  abort:async(_task,runtime,context)=>{await runtime.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),context);}
});
function frameConfiguration(id:string,models:Models,frameSettings:FrameSettings,environment?:NodeJS.ProcessEnv) {
  const directory=paths(id).tools;
  const selected=models.getModel(frameSettings.model.provider,frameSettings.model.modelId);
  if(!selected) throw Error(`Configured frame model unavailable: ${frameSettings.model.provider}/${frameSettings.model.modelId}`);
  return {
    frameSettings,
    guidance:readFileSync(join(root,'FRAME.md'),'utf8').trim(),
    scope:readFileSync(join(directory,'SCOPE.md'),'utf8').trim(),
    sources:resolveToolSources(directory,frameSettings.toolSources),
    settings:harnessSettings(),
    thinkingLevel:frameSettings.thinkingLevel ?? modelThinkingLevel(selected) ?? null,
    shellEnv:environment ?? frameEnvironment(directory,id,framesRoot)
  };
}
export class Frame {
  harness!: Harness;
  conversation!: Conversation;
  env!: NodeExecutionEnv;
  release!: () => void;
  server?: Server;
  closing = false;
  onClose?: () => void;
  onError: (error: unknown) => void = e => console.error(String(e));
  private closure?: Promise<void>;
  private hasLaunchedPanes = false;
  private boot = false;
  private shellEnv!:NodeJS.ProcessEnv;
  private configuration!:ReturnType<typeof frameConfiguration>;
  private settingsUpdate:Promise<unknown>=Promise.resolve();
  private admissions:Promise<unknown>=Promise.resolve();
  private readonly makefiles: Record<string,string>;
  private constructor(readonly id: string, readonly models: Models) {
    this.makefiles={shared:join(root,'shared','Makefile'),frame:join(paths(id).tools,'Makefile')};
  }
  private tools() {
    return Object.fromEntries(Object.entries(this.makefiles).map(([label,file])=>[label,readFileSync(file,'utf8')]));
  }
  static async open(id: string, models: Models, model: ModelReference | (()=>ModelReference), environment?:NodeJS.ProcessEnv) {
    const p = new Frame(id,models);
    p.release = lock(id);
    try {
      const dirs = prepare(id);
      const database=join(dirs.state,'durable.sqlite');
      const saved=readFrameSettings(dirs.tools);
      if(!saved && existsSync(database)) throw Error(`Missing frame.env; run make frame-config-migrate id=${id}`);
      const frameSettings:FrameSettings=saved ?? {model:typeof model==='function'?model():model};
      const selected=frameSettings.model;
      const selectedModel=models.getModel(selected.provider,selected.modelId);
      if(!selectedModel) throw Error(`${saved ? 'Saved model' : 'Model'} unavailable: ${selected.provider}/${selected.modelId}`);
      p.configuration=frameConfiguration(id,models,frameSettings,environment);
      p.shellEnv=p.configuration.shellEnv;
      if(!saved) writeFrameSettings(dirs.tools,frameSettings);
      const boot=existsSync(join(dirs.tools,'BOOT.md')) ? readFileSync(join(dirs.tools,'BOOT.md'),'utf8').trim() : '';
      p.env = new NodeExecutionEnv({cwd:dirs.tools, shellEnv:p.shellEnv});
      const registry = createRegistry(); registry.install(CodingTools);
      registry.install(defineExtension({name:'philby', tasks:[Startup], hooks:[frameContext], sections:[
        section('frame-guidance', () => p.configuration.guidance || undefined,{tag:false}),
        section('frame-scope', () => p.configuration.scope || undefined,{tag:false}),
        section('tool-sources', () => p.configuration.sources.length ? `Make sources to read on demand:\n${p.configuration.sources.join('\n')}` : undefined),
        section('saved-memory', async (input, context) => {
          if(!p.configuration.frameSettings.memory) return undefined;
          const memory=await input.read.snapshot(Memory,input.conversationId,context);
          const populated=Object.entries(memory ?? {}).filter(([,value])=>value.trim());
          return populated.length ? JSON.stringify(Object.fromEntries(populated)) : undefined;
        }),
        section('plan-mode', async (input, context) => (await input.read.snapshot(PlanMode, input.conversationId, context))?.active ? PLAN_MODE_PROMPT : undefined),
        section('approved-plan', async (input, context) => { const doc = await input.read.snapshot(PlanMode, input.conversationId, context); return doc && !doc.active && doc.plan ? `Approved plan:\n${doc.plan}` : undefined; })
      ], wraps: CodingTools.tools!.filter(tool => tool.name !== 'read').map(planGate)}));
      p.harness = await Harness.open(await openNodeSqliteStorage(database), {models, registry, settings: () => p.configuration.settings, env: () => p.env, onReport:e => p.onError(e.error)}, ctx);
      p.conversation = await p.harness.root(ctx, {init:(tx,id)=>configure(tx,id,{model:selected,cwd:dirs.tools})});
      await p.conversation.configure({model:selected,thinkingLevel:p.configuration.thinkingLevel},ctx);
      await p.conversation.commit(async tx => { await tx.doc(Memory,p.conversation.id); await tx.doc(PlanMode,p.conversation.id); },ctx);
      const startup=(await p.harness.inspect(ctx)).tasks.some(t=>t.record.kind==='philby.startup');
      p.boot=!!boot || startup;
      if(boot && !startup) await p.conversation.commit(tx=>tx.createTask(Startup,{prompt:boot},{ownership:{kind:'conversation'},background:true}),ctx);
      p.server = await listen(id, c => p.operation(c));
      p.harness.resume();
      return p;
    } catch(e) { await p.close(); throw e; }
  }
  private updateSettings(change:(current:FrameSettings)=>FrameSettings) {
    const update=this.settingsUpdate.then(async()=>{
      if(this.closing) throw Error('Frame is closing');
      const directory=paths(this.id).tools;
      const current=readFrameSettings(directory);
      if(!current) throw Error('Missing frame.env');
      const next=change(current);
      let published=false;
      try {
        writeFrameSettings(directory,next);
        published=true;
        const selected=this.models.getModel(next.model.provider,next.model.modelId);
        if(!selected) throw Error('Configured frame model unavailable');
        await this.conversation.configure({model:next.model,thinkingLevel:next.thinkingLevel ?? modelThinkingLevel(selected) ?? null},ctx);
      } catch(error) {
        if(published || error instanceof FrameSettingsWriteError) await this.close();
        throw error;
      }
    });
    this.settingsUpdate=update.catch(()=>{});
    return update;
  }
  private admit<T>(operation:()=>Promise<T>) {
    const admitted=this.admissions.then(operation);
    this.admissions=admitted.catch(()=>{});
    return admitted;
  }
  async operation(c: Command): Promise<unknown> {
    if (this.closing) throw Error('Frame is closing');
    switch(c.op) {
      case 'status': return {id:this.id,pid:process.pid,memory:await this.harness.snapshot(Memory,this.conversation.id,ctx),work:await this.harness.inspect(ctx)};
      case 'pane-start': {
        if(typeof c.name!=='string' || typeof c.target!=='string') throw Error('Supply PANE=<name> and TARGET=<make-target>');
        if(c.source!=='frame' && c.source!=='shared') throw Error('Pane targets must come from the frame or shared Makefile');
        const receipt=startPane(this.id,c.name,c.target,c.source);
        this.hasLaunchedPanes=true;
        return receipt;
      }
      case 'pane-list': return listFramePanes(this.id);
      case 'pane-stop': {
        if(typeof c.name!=='string') throw Error('Supply PANE=<name>');
        stopPane(this.id,c.name);
        return {stopped:true};
      }
      case 'model': {
        const errors=c.modelId===undefined?await refreshModels(this.models):[];
        if(c.modelId !== undefined) {
          const target=typeof c.provider==='string' && typeof c.modelId==='string' ? this.models.getModel(c.provider,c.modelId) : undefined;
          if(!target) throw Error(`Model unavailable: ${c.provider}/${c.modelId}`);
          const thinkingLevel=modelThinkingLevel(target);
          await this.updateSettings(current=>({...current,model:{provider:target.provider,modelId:target.id},thinkingLevel:thinkingLevel ?? current.thinkingLevel}));
        }
        const current=(await this.conversation.agent(ctx)).model;
        if(!current) throw Error('Frame has no configured model');
        const choices=await modelChoices(this.models,error=>errors.push(error.message));
        if(!choices.some(choice=>choice.provider===current.provider && choice.modelId===current.modelId)) choices.unshift({...current,label:current.modelId,description:'Current model (unavailable)'});
        return {current,choices,errors} satisfies ModelSelection;
      }
      case 'thinking': {
        if(c.level!==null && typeof c.level!=='string') throw Error('Supply a thinking level or null to use the Pi preference');
        await this.updateSettings(current=>({...current,thinkingLevel:c.level===null?undefined:c.level as FrameSettings['thinkingLevel']}));
        return {saved:true};
      }
      case 'input': {
        const content = String(c.content ?? ''); if (!content.trim()) throw Error('Empty prompt');
        return this.admit(async()=>{
          const sub = await this.conversation.submit({type:'input',content,requestId:c.id ? String(c.id) : undefined,whenBusy:c.mode === 'steer' ? 'steer' : 'followUp'},ctx);
          return {accepted:sub.id};
        });
      }
      case 'stop': {
        const data = await this.harness.snapshot(LiveDoc,this.conversation.id,ctx);
        if (data?.run?.taskId) {
          await this.harness.abortTask(data.run.taskId,ctx);
          await this.harness.waitForTask(data.run.taskId,ctx);
        }
        return {stopped:true};
      }
      case 'close': {
        if(c.pane!==undefined && c.pane!==process.env.TMUX_PANE) throw Error('The selected frame terminal has changed');
        await this.close(); return {closed:true};
      }
      case 'memory': {
        if (c.field === undefined) return this.harness.snapshot(Memory,this.conversation.id,ctx);
        if (!['responsibilities','notes','decisions','outstanding','sources'].includes(String(c.field))) throw Error('Unknown memory field');
        await this.conversation.commit(async tx => { const memory = await tx.doc(Memory,this.conversation.id); memory[c.field as keyof typeof memory] = String(c.content ?? ''); },ctx);
        return {saved:true};
      }
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
      case 'new': return this.admit(()=>{
        const update=this.settingsUpdate.then(async()=>{
          if(this.closing) throw Error('Frame is closing');
          const saved=readFrameSettings(paths(this.id).tools);
          if(!saved) throw Error('Missing frame.env');
          const configuration=frameConfiguration(this.id,this.models,saved);
          await this.conversation.abort(ctx,{background:true});
          await this.env.cleanup(ctx);
          await this.conversation.commit(async tx => {
            const inbox = await tx.doc(InboxDoc, this.conversation.id);
            for(const item of inbox.items) tx.settleSubmission(item.id,{status:'unanswered',reason:'aborted'});
            inbox.items=[];
            const plan = await tx.doc(PlanMode, this.conversation.id);
            plan.active = false;
            plan.plan = '';
            configure(tx,this.conversation.id,{model:saved.model,thinkingLevel:configuration.thinkingLevel});
            await tx.appendEntry(ResetEntry, this.conversation.id, {head:'self'});
          },ctx);
          this.configuration=configuration;
          this.shellEnv=configuration.shellEnv;
          this.env=new NodeExecutionEnv({cwd:paths(this.id).tools,shellEnv:this.shellEnv});
          return {reset:true};
        });
        this.settingsUpdate=update.catch(()=>{});
        return update;
      });
      case 'tools': return this.tools();
      case 'capture': return capture(this.conversation,c.all===true);
      default: throw Error(`Unknown operation: ${c.op}`);
    }
  }
  close() {
    if(this.closure) return this.closure;
    this.closing=true;
    this.closure=(async()=>{
      this.server?.close();
      try {
        await this.admissions;
        if(this.hasLaunchedPanes) closeFramePanes(this.id);
      }
      finally {
        try { await this.harness?.close(ctx); }
        finally {
          try {
            if(this.boot) await promisify(execFile)('make',['--no-print-directory','-C',paths(this.id).tools,'close'],{env:this.shellEnv,timeout:60000});
          }
          finally {
            try { await this.env?.cleanup(ctx); }
            finally {
              rmSync(paths(this.id).socket,{force:true});
              this.release();this.onClose?.();
            }
          }
        }
      }
    })();
    return this.closure;
  }
}

export async function migrateFrameSettings(id:string) {
  if(!existsSync(join(paths(id).state,'durable.sqlite'))) throw Error(`Frame ${id} has no saved conversation; open it to initialize settings`);
  const release=lock(id);
  try {
    const directory=paths(id).tools;
    if(readFrameSettings(directory)) return {id,migrated:false};
    const database=join(paths(id).state,'durable.sqlite');
    if(!existsSync(database)) throw Error(`Frame ${id} has no saved conversation; open it to initialize settings`);
    const harness=await Harness.open(await openNodeSqliteStorage(database),{models:createModels(),registry:createRegistry()},ctx);
    try {
      const conversation=await harness.conversation(ROOT_CONVERSATION_ID,ctx);
      if(!conversation) throw Error(`Frame ${id} has no saved conversation`);
      const saved=await harness.snapshot(AgentDoc,conversation.id,ctx);
      if(!saved?.model) throw Error(`Frame ${id} has no saved model`);
      writeFrameSettings(directory,{model:saved.model,...(saved.thinkingLevel===undefined?{}:{thinkingLevel:saved.thinkingLevel})});
      return {id,migrated:true};
    } finally {await harness.close(ctx);}
  } finally {release();}
}

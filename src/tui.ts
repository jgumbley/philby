import type { AssistantMessage } from '@earendil-works/pi-ai';
import { TuiMainScreen, ProcessTerminal, Input, SelectList, Editor, Markdown, Text, Container, Loader, matchesKey, type MarkdownTheme } from '@earendil-works/pi-tui';
import { AgentDoc, LiveDoc } from '@earendil-works/pi-durable';
import { ModelRuntime, ModelSelectorComponent, initTheme } from '@earendil-works/pi-coding-agent';
import { modelScope } from './models.js';
import { Frame, PlanMode, ctx } from './frame.js';
import { slug } from './store.js';
const plain=(s:string)=>s;
const dim=(s:string)=>`\x1b[90m${s}\x1b[39m`;
const accent=(s:string)=>`\x1b[36m${s}\x1b[39m`;
const selectTheme={selectedPrefix:accent,selectedText:accent,description:dim,scrollInfo:dim,noMatch:dim};
const theme:MarkdownTheme={heading:accent,link:accent,linkUrl:dim,code:accent,codeBlock:plain,codeBlockBorder:dim,quote:dim,quoteBorder:dim,hr:dim,listBullet:dim,bold:s=>`\x1b[1m${s}\x1b[22m`,italic:plain,strikethrough:plain,underline:plain};
function textContent(content: any): string { return typeof content === 'string' ? content : (content || []).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(''); }
export function assistantWarnings(message:Pick<AssistantMessage,'stopReason'|'content'|'errorMessage'>):string[] {
  const warnings:string[]=[];
  if(message.errorMessage) warnings.push(message.errorMessage);
  if(message.stopReason==='length') warnings.push('Output token limit reached; response incomplete. Retry with smaller file changes or a larger output allowance.');
  if(message.stopReason==='aborted') warnings.push('Generation cancelled; response may be incomplete.');
  for(const part of message.content) if(part.type==='toolCall' && part.argumentsError) warnings.push(`${part.name} was not executed: invalid tool arguments. ${part.argumentsError.split('\n')[0]}`);
  return warnings;
}
export function selectFrame(open:(name:string,type?:string)=>Promise<void>,frames:{name:string;running:boolean}[],types:string[]):Promise<void> {
  if(!process.stdin.isTTY) throw Error('Frame selection requires a terminal');
  const tui=new TuiMainScreen(new ProcessTerminal());
  const header=new Text('',0,1);
  const content=new Container();
  const input=new Input({prompt:'Slug: '});
  const list=new SelectList([{value:'',label:'New frame…',description:'Choose a type and name'},...frames.map(p=>({value:p.name,label:p.name,description:p.running?'Open — switch to frame':'Closed — resume conversation'}))],8,selectTheme);
  const recipes=new SelectList(types.map(value=>({value,label:value})),8,selectTheme);
  let selectedType=types[0];
  const info=new Text('',0,1);
  tui.addChild(header);tui.addChild(content);tui.addChild(info);
  const show=(step:'frames'|'types'|'name')=>{
    header.setText(accent(step==='name'?'Name this frame':step==='types'?'Choose a frame type':'Open a frame'));
    const view=step==='name'?input:step==='types'?recipes:list;content.clear();content.addChild(view);tui.setFocus(view);
    info.setText(dim(step==='name'?'Enter opens · Esc returns to types':step==='types'?`↑/↓ select · Enter names · Esc ${frames.length?'returns to frames':'cancels'}`:'↑/↓ select · Enter opens · Esc cancels'));tui.requestRender();
  };
  return new Promise(resolve=>{
    let busy=false;
    const cancel=()=>{if(!busy){tui.stop();resolve();}};
    input.onEscape=()=>{if(!busy)show('types');};
    const submit=async (value:string,type?:string)=>{
      if(busy) return;
      try {
        slug(value);busy=true;info.setText(dim(`Opening ${value}…`));tui.requestRender();
        await open(value,type);tui.stop();resolve();
      } catch(error) {busy=false;info.setText(String(error));tui.requestRender();}
    };
    input.onSubmit=value=>submit(value,selectedType);
    list.onSelect=item=>{if(busy)return;if(item.value)void submit(item.value);else show('types');};
    recipes.onSelect=item=>{if(busy)return;selectedType=item.value;input.setValue('');show('name');};
    recipes.onCancel=()=>{if(!busy){if(frames.length)show('frames');else cancel();}};
    list.onCancel=cancel;
    tui.addInputListener(data=>{if(busy)return {consume:true};if(matchesKey(data,'ctrl+c') || matchesKey(data,'ctrl+d')){cancel();return {consume:true};}});
    show(frames.length?'frames':'types');tui.start();
  });
}
export async function startTui(frame:Frame,quit:()=>Promise<void>) {
  initTheme();
  const tui=new TuiMainScreen(new ProcessTerminal());
  const header=new Text(accent(frame.name),0,0);
  const history=new Container();
  const activity=new Container();
  const info=new Text('',0,0);
  const editor=new Editor(tui,{borderColor:dim,selectList:selectTheme});
  const input=new Container();input.addChild(editor);
  tui.addChild(header);tui.addChild(history);tui.addChild(activity);tui.addChild(info);tui.addChild(input);tui.setFocus(editor);
  let expanded=false;let panel='';let confirmQuit=false;let quitting=false;
  let loader:Loader|undefined;let startedAt=0;
  let modelPicker:ModelSelectorComponent|undefined;let selectingModel=false;
  const state=await frame.conversation.watch(ctx);
  let tail=state.value.entries.at(-1)?.id;
  let transcript=await frame.conversation.context(ctx);
  const planState=await frame.harness.watchDoc(PlanMode,frame.conversation.id,ctx);
  const liveState=await frame.harness.watchDoc(LiveDoc,frame.conversation.id,ctx);
  const agentState=await frame.harness.watchDoc(AgentDoc,frame.conversation.id,ctx);
  const render=()=>{
    history.clear();
    for(const e of transcript.entries) {
      if(e.kind==='philby.startup') {history.addChild(new Text(dim('Opening checklist'),0,1));continue;}
      for(const m of e.model || []) {
      if(m.role==='system') continue;
      if(m.role==='toolResult') {
        const output=textContent(m.content);
        history.addChild(new Text(dim(`${m.isError?'!':'›'} ${m.toolName} ${expanded ? output : output.split('\n').slice(0,2).join('\n').slice(0,220)}`),0,0));
      } else {
        const text=textContent(m.content);
        if(m.role==='assistant') for(const warning of assistantWarnings(m)) history.addChild(new Text('! '+warning,0,0));
        if(text) history.addChild(new Markdown(m.role==='user'?`**you**  ${text}`:text,0,1,theme));
        if(m.role==='assistant') for(const c of m.content) if(c.type==='toolCall') history.addChild(new Text(dim(`› ${c.name} ${expanded ? JSON.stringify(c.arguments) : ''}`),0,0));
      }
    }
    }
    const live=liveState?.value;
    if(live?.run) {
      if(!loader) {
        startedAt=performance.now();
        loader=new Loader(tui,accent,dim,'',{frames:['🕵️ ●','🕵️  ','🕵️ ●','🕵️  ','🕵️ ●','🕵️  ','🕵️  ','🕵️  '],intervalMs:180});
        activity.addChild(loader);
      }
      const seconds=Math.floor((performance.now()-startedAt)/1000);
      loader.setMessage(`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`);
    } else if(loader) {loader.stop();loader=undefined;activity.clear();}
    const partial=textContent(live?.generation?.message?.content);
    if(partial) history.addChild(new Markdown(partial,0,1,theme));
    for(const tool of live?.tools || []) if(tool.status!=='done') history.addChild(new Text(dim(`› ${tool.name} ${tool.status}${expanded && tool.output ? '\n'+tool.output : ''}`),0,0));
    const unread=frame.store.updates().filter(u=>!u.seen).length;
    const model=agentState?.value.model;
    const planActive=planState?.value?.active||false;
    header.setText(accent(frame.name)+dim(`  ${model?.modelId || ''}  ${live?.run?'working':'ready'}${planActive?'  PLAN MODE':''}  ${unread?`${unread} unread updates`:''}`));
    info.setText(confirmQuit ? 'Quit all Philby frames? [y/n]' : panel || dim('/help · /model · /memory · /plan · /tools · /updates · /quit · Esc stop · Ctrl-O tool output'));
    tui.requestRender();
  };
  state.start(async call=>{
    if(call.kind!=='value' || frame.closing)return;
    const next=call.value.entries.at(-1)?.id;
    if(next!==tail) {transcript=await frame.conversation.context(ctx);tail=next;}
    if(!frame.closing)render();
  });
  const documentWatches=[planState,liveState,agentState];
  for(const watch of documentWatches)watch?.start(async()=>{if(!frame.closing)render();});
  const watches=[state,...documentWatches];
  for(const watch of watches)if(watch)void watch.closed.then(end=>{if(end.kind==='failed' || end.kind==='listener_error')frame.onError(end.error);});
  const timer=setInterval(render,1000);
  frame.onError=e=>{if(frame.closing){console.error(String(e));process.exitCode=1;}else{panel=String(e);render();}};
  const closeModelPicker=(message:string)=>{
    modelPicker?.dispose();modelPicker=undefined;input.clear();input.addChild(editor);tui.setFocus(editor);panel=message;render();
  };
  async function chooseModel() {
    const runtime=frame.models;
    if(!(runtime instanceof ModelRuntime)) throw Error('Model selection requires the Pi model runtime');
    const selection=await modelScope(runtime);
    const current=(await frame.conversation.agent(ctx)).model;
    if(frame.closing) return;
    const selected=current?runtime.getModel(current.provider,current.modelId):undefined;
    modelPicker=new ModelSelectorComponent(tui,selected,runtime,selection.scopedModels,choice=>{
      if(selectingModel) return;
      selectingModel=true;
      void frame.operation({op:'model',provider:choice.provider,modelId:choice.id})
        .then(()=>closeModelPicker(`Model set to ${choice.id}; applies to the next model request.`))
        .catch(error=>closeModelPicker(String(error)))
        .finally(()=>{selectingModel=false;});
    },()=>closeModelPicker('Model selection cancelled.'));
    editor.setText('');input.clear();input.addChild(modelPicker);tui.setFocus(modelPicker);
    panel=[...selection.errors,'Choose a model · Type to search · ↑/↓ select · Enter applies · Esc cancels'].join('\n');render();
  }
  async function submit(input:string) {
    if(quitting) return;
    try {
      if(confirmQuit) {
        const answer=input.trim().toLowerCase();editor.setText('');
        if(answer==='y') {confirmQuit=false;quitting=true;panel='Closing all Philby frames…';render();await quit();return;}
        if(answer==='n') {confirmQuit=false;panel='Quit cancelled.';}
        render();return;
      }
      const [command,...parts]=input.split(' ');const rest=parts.join(' ');
      if(command==='/quit') {confirmQuit=true;editor.setText('');render();return;}
      if(command==='/close') {await frame.close();return;}
      if(command==='/model') {await chooseModel();return;}
      if(command==='/stop') await frame.operation({op:'stop'});
      else if(command==='/help') panel='/model — choose a model for this frame\n/memory [field] — inspect or edit saved memory\n/plan · /plan on · /plan off [plan] — read-only plan mode: research and present a plan before editing\n/new — start a fresh session, preserving files, tools, memory and archived history\n/tools · /updates · /send slug message · /report slug message\n/steer message · /stop · /close · /quit — quit all frames after y/n confirmation\nEnter sends; Shift-Enter inserts a newline. Ctrl-O expands tool output.';
      else if(command==='/memory') {
        const memory=await frame.operation({op:'memory'}) as Record<string,string>;
        if(rest && rest in memory) {editor.setText(`/save ${rest}\n${memory[rest]}`);panel=`Editing ${rest}. Enter saves; Shift-Enter adds lines.`;render();return;}
        panel=JSON.stringify(memory,null,2);
      } else if(command==='/save') {
        const match=input.match(/^\/save (\w+)\n([\s\S]*)$/);if(!match) throw Error('Use /memory field to edit');
        await frame.operation({op:'memory',field:match[1],content:match[2]});panel='Memory saved.';
      } else if(command==='/plan') {
        if(rest==='on') panel=JSON.stringify(await frame.operation({op:'plan-set',active:true}),null,2);
        else if(rest==='off') panel=JSON.stringify(await frame.operation({op:'plan-set',active:false}),null,2);
        else if(rest.startsWith('off ')) panel=JSON.stringify(await frame.operation({op:'plan-set',active:false,plan:rest.slice(4)}),null,2);
        else if(rest==='') panel=JSON.stringify(await frame.operation({op:'plan'}),null,2);
        else throw Error(`Invalid /plan argument: ${rest}. Use /plan, /plan on, or /plan off [plan]`);
      } else if(command==='/new') {
        if(rest) throw Error(`/new takes no arguments; got: ${rest}`);
        panel=JSON.stringify(await frame.operation({op:'new'}),null,2);
      } else if(command==='/tools') panel=JSON.stringify(await frame.operation({op:command.slice(1)}),null,2);
      else if(command==='/updates') panel=JSON.stringify(await frame.operation({op:'updates',mark:true}),null,2);
      else if(command==='/send' || command==='/report') {
        const to=parts.shift(),content=parts.join(' ');
        if(!to || !content.trim()) throw Error(`Use ${command} <receiving-frame> <message>`);
        panel=JSON.stringify(await frame.operation({op:'send',to:slug(to),kind:command==='/report'?'update':'input',content}));
      }
      else if(command.startsWith('/') && command!=='/steer') throw Error(`Unknown command: ${command}`);
      else { await frame.operation({op:'input',content:command==='/steer'?rest:input,mode:command==='/steer'?'steer':'followUp'});panel=''; }
      editor.addToHistory(input);editor.setText('');render();
    } catch(e) {quitting=false;frame.onError(e);}
  }
  editor.onSubmit=input=>{void submit(input);};
  tui.addInputListener(data=>{
    if(quitting) return {consume:true};
    if(modelPicker) {
      if(selectingModel) return {consume:true};
      if(matchesKey(data,'escape') || matchesKey(data,'ctrl+c') || matchesKey(data,'ctrl+d')) {closeModelPicker('Model selection cancelled.');return {consume:true};}
      modelPicker.handleInput(data);
      tui.requestRender();return {consume:true};
    }
    if(confirmQuit && (matchesKey(data,'escape') || matchesKey(data,'ctrl+c') || matchesKey(data,'ctrl+d'))) {confirmQuit=false;panel='Quit cancelled.';editor.setText('');render();return {consume:true};}
    if(matchesKey(data,'ctrl+o')) {expanded=!expanded;render();return {consume:true};}
    if(matchesKey(data,'escape')) {void frame.operation({op:'stop'}).catch(frame.onError);return {consume:true};}
    if(matchesKey(data,'ctrl+c') || matchesKey(data,'ctrl+d')) {void frame.close().catch(frame.onError);return {consume:true};}
  });
  frame.onClose=()=>{modelPicker?.dispose();loader?.stop();clearInterval(timer);for(const watch of watches)void watch?.stop();tui.stop();};
  tui.start();render();
}

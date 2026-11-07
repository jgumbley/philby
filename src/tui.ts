import { TuiMainScreen, ProcessTerminal, Input, SelectList, Editor, Markdown, Text, Container, Loader, matchesKey, type MarkdownTheme } from '@earendil-works/pi-tui';
import { AgentDoc, LiveDoc } from '@earendil-works/pi-durable';
import { ModelRuntime, ModelSelectorComponent, initTheme } from '@earendil-works/pi-coding-agent';
import { modelScope } from './models.js';
import { Pane, PlanMode, ctx } from './pane.js';
import { slug } from './store.js';
const plain=(s:string)=>s;
const dim=(s:string)=>`\x1b[90m${s}\x1b[39m`;
const accent=(s:string)=>`\x1b[36m${s}\x1b[39m`;
const selectTheme={selectedPrefix:accent,selectedText:accent,description:dim,scrollInfo:dim,noMatch:dim};
const theme:MarkdownTheme={heading:accent,link:accent,linkUrl:dim,code:accent,codeBlock:plain,codeBlockBorder:dim,quote:dim,quoteBorder:dim,hr:dim,listBullet:dim,bold:s=>`\x1b[1m${s}\x1b[22m`,italic:plain,strikethrough:plain,underline:plain};
function textContent(content: any): string { return typeof content === 'string' ? content : (content || []).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(''); }
export function selectPane(open:(name:string,type?:string)=>Promise<void>,panes:{name:string;running:boolean}[],types:string[]):Promise<void> {
  if(!process.stdin.isTTY) throw Error('Pane selection requires a terminal');
  const tui=new TuiMainScreen(new ProcessTerminal());
  const header=new Text('',0,1);
  const content=new Container();
  const input=new Input({prompt:'Slug: '});
  const list=new SelectList([{value:'',label:'New pane…',description:'Choose a type and name'},...panes.map(p=>({value:p.name,label:p.name,description:p.running?'Open — switch to pane':'Closed — resume conversation'}))],8,selectTheme);
  const recipes=new SelectList(types.map(value=>({value,label:value})),8,selectTheme);
  let selectedType=types[0];
  const info=new Text('',0,1);
  tui.addChild(header);tui.addChild(content);tui.addChild(info);
  const show=(step:'panes'|'types'|'name')=>{
    header.setText(accent(step==='name'?'Name this pane':step==='types'?'Choose a pane type':'Open a pane'));
    const view=step==='name'?input:step==='types'?recipes:list;content.clear();content.addChild(view);tui.setFocus(view);
    info.setText(dim(step==='name'?'Enter opens · Esc returns to types':step==='types'?`↑/↓ select · Enter names · Esc ${panes.length?'returns to panes':'cancels'}`:'↑/↓ select · Enter opens · Esc cancels'));tui.requestRender();
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
    recipes.onCancel=()=>{if(!busy){if(panes.length)show('panes');else cancel();}};
    list.onCancel=cancel;
    tui.addInputListener(data=>{if(busy)return {consume:true};if(matchesKey(data,'ctrl+c') || matchesKey(data,'ctrl+d')){cancel();return {consume:true};}});
    show(panes.length?'panes':'types');tui.start();
  });
}
export async function startTui(pane:Pane,quit:()=>Promise<void>) {
  initTheme();
  const tui=new TuiMainScreen(new ProcessTerminal());
  const header=new Text(accent(pane.name),0,0);
  const history=new Container();
  const activity=new Container();
  const info=new Text('',0,0);
  const editor=new Editor(tui,{borderColor:dim,selectList:selectTheme});
  const input=new Container();input.addChild(editor);
  tui.addChild(header);tui.addChild(history);tui.addChild(activity);tui.addChild(info);tui.addChild(input);tui.setFocus(editor);
  let expanded=false;let panel='';let confirmQuit=false;let quitting=false;
  let loader:Loader|undefined;let startedAt=0;
  let modelPicker:ModelSelectorComponent|undefined;let selectingModel=false;
  const state=await pane.conversation.watch(ctx);
  let tail=state.value.entries.at(-1)?.id;
  let transcript=await pane.conversation.context(ctx);
  const planState=await pane.harness.watchDoc(PlanMode,pane.conversation.id,ctx);
  const liveState=await pane.harness.watchDoc(LiveDoc,pane.conversation.id,ctx);
  const agentState=await pane.harness.watchDoc(AgentDoc,pane.conversation.id,ctx);
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
        if(m.role==='assistant' && m.errorMessage) history.addChild(new Text('! '+m.errorMessage,0,0));
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
    const unread=pane.store.updates().filter(u=>!u.seen).length;
    const model=agentState?.value.model;
    const planActive=planState?.value?.active||false;
    header.setText(accent(pane.name)+dim(`  ${model?.modelId || ''}  ${live?.run?'working':'ready'}${planActive?'  PLAN MODE':''}  ${unread?`${unread} unread updates`:''}`));
    info.setText(confirmQuit ? 'Quit all Philby panes? [y/n]' : panel || dim('/help · /model · /memory · /plan · /tools · /updates · /quit · Esc stop · Ctrl-O tool output'));
    tui.requestRender();
  };
  state.start(async call=>{
    if(call.kind!=='value' || pane.closing)return;
    const next=call.value.entries.at(-1)?.id;
    if(next!==tail) {transcript=await pane.conversation.context(ctx);tail=next;}
    if(!pane.closing)render();
  });
  const documentWatches=[planState,liveState,agentState];
  for(const watch of documentWatches)watch?.start(async()=>{if(!pane.closing)render();});
  const watches=[state,...documentWatches];
  for(const watch of watches)if(watch)void watch.closed.then(end=>{if(end.kind==='failed' || end.kind==='listener_error')pane.onError(end.error);});
  const timer=setInterval(render,1000);
  pane.onError=e=>{if(pane.closing){console.error(String(e));process.exitCode=1;}else{panel=String(e);render();}};
  const closeModelPicker=(message:string)=>{
    modelPicker?.dispose();modelPicker=undefined;input.clear();input.addChild(editor);tui.setFocus(editor);panel=message;render();
  };
  async function chooseModel() {
    const runtime=pane.models;
    if(!(runtime instanceof ModelRuntime)) throw Error('Model selection requires the Pi model runtime');
    const selection=await modelScope(runtime);
    const current=(await pane.conversation.agent(ctx)).model;
    if(pane.closing) return;
    const selected=current?runtime.getModel(current.provider,current.modelId):undefined;
    modelPicker=new ModelSelectorComponent(tui,selected,runtime,selection.scopedModels,choice=>{
      if(selectingModel) return;
      selectingModel=true;
      void pane.operation({op:'model',provider:choice.provider,modelId:choice.id})
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
        if(answer==='y') {confirmQuit=false;quitting=true;panel='Closing all Philby panes…';render();await quit();return;}
        if(answer==='n') {confirmQuit=false;panel='Quit cancelled.';}
        render();return;
      }
      const [command,...parts]=input.split(' ');const rest=parts.join(' ');
      if(command==='/quit') {confirmQuit=true;editor.setText('');render();return;}
      if(command==='/close') {await pane.close();return;}
      if(command==='/model') {await chooseModel();return;}
      if(command==='/stop') await pane.operation({op:'stop'});
      else if(command==='/help') panel='/model — choose a model for this pane\n/memory [field] — inspect or edit saved memory\n/plan · /plan on · /plan off [plan] — read-only plan mode: research and present a plan before editing\n/new — start a fresh session, preserving files, tools, memory and archived history\n/tools · /updates · /send slug message · /report slug message\n/steer message · /stop · /close · /quit — quit all panes after y/n confirmation\nEnter sends; Shift-Enter inserts a newline. Ctrl-O expands tool output.';
      else if(command==='/memory') {
        const memory=await pane.operation({op:'memory'}) as Record<string,string>;
        if(rest && rest in memory) {editor.setText(`/save ${rest}\n${memory[rest]}`);panel=`Editing ${rest}. Enter saves; Shift-Enter adds lines.`;render();return;}
        panel=JSON.stringify(memory,null,2);
      } else if(command==='/save') {
        const match=input.match(/^\/save (\w+)\n([\s\S]*)$/);if(!match) throw Error('Use /memory field to edit');
        await pane.operation({op:'memory',field:match[1],content:match[2]});panel='Memory saved.';
      } else if(command==='/plan') {
        if(rest==='on') panel=JSON.stringify(await pane.operation({op:'plan-set',active:true}),null,2);
        else if(rest==='off') panel=JSON.stringify(await pane.operation({op:'plan-set',active:false}),null,2);
        else if(rest.startsWith('off ')) panel=JSON.stringify(await pane.operation({op:'plan-set',active:false,plan:rest.slice(4)}),null,2);
        else if(rest==='') panel=JSON.stringify(await pane.operation({op:'plan'}),null,2);
        else throw Error(`Invalid /plan argument: ${rest}. Use /plan, /plan on, or /plan off [plan]`);
      } else if(command==='/new') {
        if(rest) throw Error(`/new takes no arguments; got: ${rest}`);
        panel=JSON.stringify(await pane.operation({op:'new'}),null,2);
      } else if(command==='/tools') panel=JSON.stringify(await pane.operation({op:command.slice(1)}),null,2);
      else if(command==='/updates') panel=JSON.stringify(await pane.operation({op:'updates',mark:true}),null,2);
      else if(command==='/send' || command==='/report') {
        const to=parts.shift(),content=parts.join(' ');
        if(!to || !content.trim()) throw Error(`Use ${command} <receiving-pane> <message>`);
        panel=JSON.stringify(await pane.operation({op:'send',to:slug(to),kind:command==='/report'?'update':'input',content}));
      }
      else if(command.startsWith('/') && command!=='/steer') throw Error(`Unknown command: ${command}`);
      else { await pane.operation({op:'input',content:command==='/steer'?rest:input,mode:command==='/steer'?'steer':'followUp'});panel=''; }
      editor.addToHistory(input);editor.setText('');render();
    } catch(e) {quitting=false;pane.onError(e);}
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
    if(matchesKey(data,'escape')) {void pane.operation({op:'stop'}).catch(pane.onError);return {consume:true};}
    if(matchesKey(data,'ctrl+c') || matchesKey(data,'ctrl+d')) {void pane.close().catch(pane.onError);return {consume:true};}
  });
  pane.onClose=()=>{modelPicker?.dispose();loader?.stop();clearInterval(timer);for(const watch of watches)void watch?.stop();tui.stop();};
  tui.start();render();
}

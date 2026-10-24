import { TuiMainScreen, ProcessTerminal, Input, SelectList, Editor, Markdown, Text, Container, Loader, matchesKey, type MarkdownTheme } from '@earendil-works/pi-tui';
import { Pane, ctx, type ModelSelection } from './pane.js';
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
  let modelPicker:SelectList|undefined;let selectingModel=false;
  const state=await pane.conversation.viewState(ctx);
  const render=()=>{
    history.clear();
    const value=state.value;
    let reviewActive=false;
    for(const e of value.entries) {
      if(e.kind==='pi.user') reviewActive=false;
      if(e.kind==='philby.startup') {reviewActive=false;history.addChild(new Text(dim('Opening checklist'),0,1));continue;}
      if(e.kind==='philby.review') {reviewActive=true;continue;}
      for(const m of e.model || []) {
      if(reviewActive && (m.role==='toolResult' && !m.isError || m.role==='assistant' && m.stopReason==='toolUse')) continue;
      if(m.role==='system') continue;
      if(m.role==='toolResult') {
        const output=textContent(m.content);
        history.addChild(new Text(dim(`${m.isError?'!':'›'} ${m.toolName} ${expanded ? output : output.split('\n').slice(0,2).join('\n').slice(0,220)}`),0,0));
      } else {
        const text=textContent(m.content);
        if(m.role==='assistant' && m.errorMessage) history.addChild(new Text('! '+m.errorMessage,0,0));
        if(text && text.trim() !== 'NO_CHANGE') history.addChild(new Markdown(m.role==='user'?`**you**  ${text}`:text,0,1,theme));
        if(m.role==='assistant') for(const c of m.content) if(c.type==='toolCall') history.addChild(new Text(dim(`› ${c.name} ${expanded ? JSON.stringify(c.arguments) : ''}`),0,0));
      }
    }
    }
    const live=value.docs['pi.live'] as any;
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
    if(partial && !reviewActive) history.addChild(new Markdown(partial,0,1,theme));
    for(const tool of reviewActive ? [] : live?.tools || []) if(tool.status!=='done') history.addChild(new Text(dim(`› ${tool.name} ${tool.status}${expanded && tool.output ? '\n'+tool.output : ''}`),0,0));
    const unread=pane.store.updates().filter(u=>!u.seen).length;
    const model=(value.docs['pi.agent'] as any)?.model;
    header.setText(accent(pane.name)+dim(`  ${model?.modelId || ''}  ${live?.run?'working':'ready'}  ${unread?`${unread} unread updates`:''}`));
    info.setText(confirmQuit ? 'Quit all Philby panes? [y/n]' : panel || dim('/help · /model · /memory · /checks · /tools · /updates · /quit · Esc stop · Ctrl-O tool output'));
    tui.requestRender();
  };
  const unsub=state.subscribe(render);
  const timer=setInterval(render,1000);
  pane.onError=e=>{if(pane.closing){console.error(String(e));process.exitCode=1;}else{panel=String(e);render();}};
  const closeModelPicker=(message:string)=>{
    modelPicker=undefined;input.clear();input.addChild(editor);tui.setFocus(editor);panel=message;render();
  };
  async function chooseModel() {
    const selection=await pane.operation({op:'model'}) as ModelSelection;
    const list=new SelectList(selection.choices.map((choice,index)=>({value:String(index),label:choice.label,description:choice.description})),8,selectTheme);
    list.setSelectedIndex(selection.choices.findIndex(choice=>choice.provider===selection.current.provider && choice.modelId===selection.current.modelId));
    list.onSelect=async item=>{
      if(selectingModel) return;
      selectingModel=true;
      try {
        const choice=selection.choices[Number(item.value)];
        await pane.operation({op:'model',provider:choice.provider,modelId:choice.modelId});
        closeModelPicker(`Model set to ${choice.modelId}; applies to the next model request.`);
      } catch(error) {pane.onError(error);}
      finally {selectingModel=false;}
    };
    list.onCancel=()=>{if(!selectingModel)closeModelPicker('Model selection cancelled.');};
    modelPicker=list;editor.setText('');input.clear();input.addChild(list);tui.setFocus(list);
    panel='Choose a model · ↑/↓ select · Enter applies · Esc cancels';render();
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
      else if(command==='/help') panel='/model — choose a model for this pane\n/memory [field] — inspect or edit saved memory\n/checks · /check {JSON} · /pause id · /resume id · /remove id\n/tools · /updates · /send slug message · /report slug message\n/steer message · /stop · /close · /quit — quit all panes after y/n confirmation\nEnter sends; Shift-Enter inserts a newline. Ctrl-O expands tool output.';
      else if(command==='/memory') {
        const memory=await pane.operation({op:'memory'}) as Record<string,string>;
        if(rest && rest in memory) {editor.setText(`/save ${rest}\n${memory[rest]}`);panel=`Editing ${rest}. Enter saves; Shift-Enter adds lines.`;render();return;}
        panel=JSON.stringify(memory,null,2);
      } else if(command==='/save') {
        const match=input.match(/^\/save (\w+)\n([\s\S]*)$/);if(!match) throw Error('Use /memory field to edit');
        await pane.operation({op:'memory',field:match[1],content:match[2]});panel='Memory saved.';
      } else if(command==='/checks' || command==='/tools') panel=JSON.stringify(await pane.operation({op:command.slice(1)}),null,2);
      else if(command==='/updates') panel=JSON.stringify(await pane.operation({op:'updates',mark:true}),null,2);
      else if(command==='/check') panel=JSON.stringify(await pane.operation({op:'check-set',check:JSON.parse(rest)}),null,2);
      else if(['/pause','/resume','/remove'].includes(command)) await pane.operation({op:command==='/remove'?'check-remove':'check-pause',id:rest,paused:command==='/pause'});
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
      return;
    }
    if(confirmQuit && (matchesKey(data,'escape') || matchesKey(data,'ctrl+c') || matchesKey(data,'ctrl+d'))) {confirmQuit=false;panel='Quit cancelled.';editor.setText('');render();return {consume:true};}
    if(matchesKey(data,'ctrl+o')) {expanded=!expanded;render();return {consume:true};}
    if(matchesKey(data,'escape')) {void pane.operation({op:'stop'}).catch(pane.onError);return {consume:true};}
    if(matchesKey(data,'ctrl+c') || matchesKey(data,'ctrl+d')) {void pane.close().catch(pane.onError);return {consume:true};}
  });
  pane.onClose=()=>{loader?.stop();clearInterval(timer);unsub();state.dispose();tui.stop();};
  tui.start();render();
}

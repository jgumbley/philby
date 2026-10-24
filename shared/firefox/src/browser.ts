import { execFileSync, spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const env = process.env;
const required = (name: string) => { if (!env[name]) throw Error(`${name} is required`); return env[name]!; };
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
type Window = { id: number; name: string; marks: string[] };
function windows(): Window[] {
  const walk = (node: any): Window[] => [...(node.app_id === 'firefox' ? [{id:node.id,name:node.name,marks:node.marks}] : []), ...[...node.nodes,...node.floating_nodes].flatMap(walk)];
  return walk(JSON.parse(execFileSync('swaymsg',['-r','-t','get_tree'],{encoding:'utf8'})));
}
function sway(id: number, action: string) {
  const result = JSON.parse(execFileSync('swaymsg',['-r',`[con_id=${id}] ${action}`],{encoding:'utf8'}));
  if (result.some((r: any) => !r.success)) throw Error(JSON.stringify(result));
}
function unique<T>(items: T[], label: string): T {
  if (items.length !== 1) throw Error(`${label}: expected one match, found ${items.length}. Use browser-tabs or browser-windows to refine the selection.`);
  return items[0];
}
async function connect() {
  const port = Number(required('FIREFOX_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid FIREFOX_PORT');
  const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
  const pending = new Map<number, {resolve: (v: any) => void; reject: (e: Error) => void}>();
  let next = 0;
  let activeInput: string | undefined;
  socket.addEventListener('message', event => {
    const data = JSON.parse(String(event.data));
    const request = pending.get(data.id);
    if (request) data.type === 'error' ? request.reject(Error(`${data.error}: ${data.message}`)) : request.resolve(data.result);
  });
  socket.addEventListener('close', () => { for (const p of pending.values()) p.reject(Error('Firefox disconnected; inspect the page before retrying an action')); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('Firefox connection timed out')); },15000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); },{once:true});
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error(`Firefox is not accepting BiDi on port ${port}. Quit Firefox, then run make -C shared browser-start to reopen the normal profile.`)); },{once:true});
  });
  function call(method: string, params: object = {}): Promise<any> {
    if (method === 'input.performActions') activeInput = (params as {context:string}).context;
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out; inspect the page before retrying`)); },15000);
      pending.set(id,{resolve:v=>{clearTimeout(timer);pending.delete(id);if(method==='input.releaseActions')activeInput=undefined;resolve(v);},reject:e=>{clearTimeout(timer);pending.delete(id);reject(e);}});
      socket.send(JSON.stringify({id,method,params}));
    });
  }
  try { await call('session.new',{capabilities:{}}); }
  catch (e) { socket.close(); throw Error(`${e}. If a previous tool was killed, restart Firefox to release its abandoned session.`); }
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try { if (activeInput) await call('input.releaseActions',{context:activeInput}); }
    finally { try { await call('session.end'); } finally { socket.close(); } }
  })();
  for (const [signal,code] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]] as const) process.once(signal,()=>{ void close().then(()=>process.exit(code),e=>{console.error(String(e));process.exit(1);}); });
  return {call,close};
}
async function main() {
  const action = process.argv[2];
  if (action === 'start') {
    const port=Number(required('FIREFOX_PORT'));
    if (!Number.isInteger(port) || port<1 || port>65535) throw Error('Invalid FIREFOX_PORT');
    const listening = () => new Promise<boolean>(resolve=>{const socket=createConnection(port,'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));});
    if (!await listening()) {
      const log=`${required('XDG_RUNTIME_DIR')}/philby-firefox-${port}.log`;
      const file=openSync(log,'a',0o600);
      const child=spawn('firefox',['--remote-debugging-port',String(port)],{detached:true,stdio:['ignore',file,file]});
      closeSync(file);
      await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      child.unref();
      let ready=false;
      for (let attempt=0;attempt<150;attempt++) {
        if (await listening()) {ready=true;break;}
        if (child.exitCode!==null) break;
        await sleep(100);
      }
      if (!ready) throw Error(`Firefox did not enable remote control. Quit the existing Firefox first, then run browser-start. Startup log: ${log}`);
    }
    const browser=await connect();
    await browser.close();
    return print({ready:true,port});
  }
  if (action === 'windows') return print(windows());
  if (action === 'window-focus' || action === 'window-close') {
    const selector = required('WINDOW');
    const window = unique(windows().filter(w=>String(w.id)===selector || w.marks.includes(selector)),`WINDOW=${selector}`);
    sway(window.id,action === 'window-focus' ? 'focus' : 'kill');
    return print(window);
  }
  const mark = env.MARK;
  let before: Window[] = [];
  if (action === 'open' && mark) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(mark)) throw Error('MARK must contain lowercase letters, digits and hyphens');
    before = windows();
    const existing = before.filter(w=>w.marks.includes(mark));
    if (existing.length) { const window=unique(existing,`MARK=${mark}`);sway(window.id,'focus');return print(window); }
  }
  const browser = await connect();
  const {call} = browser;
  let context: string;
  const evaluate = async (expression: string) => {
    const result = await call('script.evaluate',{expression,target:{context},awaitPromise:true,userActivation:true});
    if (result.type === 'exception') throw Error(result.exceptionDetails.text);
    return result.result;
  };
  const json = async (expression: string) => JSON.parse((await evaluate(`(async () => JSON.stringify(await (${expression})) ?? 'null')()`)).value);
  const keys = (values: string[]) => values.flatMap(value=>[{type:'keyDown',value},{type:'keyUp',value}]);
  const input = async (actions: object[]) => {
    try { await call('input.performActions',{context,actions}); }
    finally { await call('input.releaseActions',{context}); }
  };
  try {
    if (action === 'open') {
      const url = required('URL');
      context = (await call('browsingContext.create',{type:'window',userContext:'default'})).context;
      let window: Window | undefined;
      if (mark) {
        for (let attempt=0;attempt<100;attempt++) {
          const added = windows().filter(w=>!before.some(old=>old.id===w.id));
          if (added.length) {window=unique(added,'New Firefox window');break;}
          await sleep(100);
        }
        if (!window) throw Error('New Firefox Sway window did not appear');
        sway(window.id,`mark --add ${mark}, floating disable`);
      }
      await call('browsingContext.navigate',{context,url,wait:'interactive'});
      return print({url,title:await json('document.title'),...(window ? {window:window.id,mark} : {})});
    }
    const tabs = [];
    for (const tab of (await call('browsingContext.getTree',{maxDepth:0})).contexts) {
      context = tab.context;
      tabs.push({context,url:tab.url,title:await json('document.title') as string});
    }
    if (action === 'tabs') return print(tabs.map(({context,...tab})=>tab));
    const tab = required('TAB');
    const pattern = new RegExp(tab.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*'),'i');
    context = unique(tabs.filter(t=>pattern.test(t.url) || pattern.test(t.title)),`TAB=${tab}`).context;
    switch (action) {
      case 'eval': {
        const expression = env.PROMPT_FILE ? readFileSync(env.PROMPT_FILE,'utf8') : env.EXPR !== undefined ? env.EXPR : readFileSync(0,'utf8');
        if (!expression.trim()) throw Error('EXPR, PROMPT_FILE or stdin must contain a JavaScript expression');
        return print(await json(expression));
      }
      case 'navigate': await call('browsingContext.navigate',{context,url:required('URL'),wait:'interactive'});break;
      case 'focus': await call('browsingContext.activate',{context});break;
      case 'close': await call('browsingContext.close',{context});break;
      case 'screenshot': {
        const out=required('OUT');
        const shot=await call('browsingContext.captureScreenshot',{context,origin:'viewport'});
        writeFileSync(out,Buffer.from(shot.data,'base64'));
        return print({out});
      }
      case 'click': case 'fill': case 'fullscreen': {
        const selector=required('SELECTOR');
        if (action === 'fill' && env.TEXT === undefined) throw Error('TEXT is required');
        await call('browsingContext.activate',{context});
        const element=await evaluate(`(() => { const elements=document.querySelectorAll(${JSON.stringify(selector)}); if(elements.length!==1) throw Error('SELECTOR must match exactly one element; found '+elements.length); const element=elements[0]; if(${action === 'fill'} && (element.disabled || element.readOnly || !(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement && ['text','search','email','url','tel','password'].includes(element.type) || element.isContentEditable))) throw Error('SELECTOR is not an editable text field'); element.scrollIntoView({block:'center',inline:'center'}); return element; })()`);
        if (action === 'fullscreen') { await json(`document.querySelector(${JSON.stringify(selector)}).requestFullscreen()`);break; }
        await input([{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',origin:{type:'element',element:{sharedId:element.sharedId}},x:0,y:0},{type:'pointerDown',button:0},{type:'pointerUp',button:0}]}]);
        if (action === 'fill') await input([{type:'key',id:'keyboard',actions:[{type:'keyDown',value:'\uE009'},...keys(['a']),{type:'keyUp',value:'\uE009'},...keys(['\uE003',...Array.from(env.TEXT!).map(c=>c==='\n'?'\uE007':c)])]}]);
        break;
      }
      case 'press': {
        const key=required('KEY');
        const named: Record<string,string> = {Enter:'\uE007',Tab:'\uE004',Escape:'\uE00C',Backspace:'\uE003',Delete:'\uE017',Space:' ',ArrowLeft:'\uE012',ArrowUp:'\uE013',ArrowRight:'\uE014',ArrowDown:'\uE015'};
        if (!named[key] && Array.from(key).length!==1) throw Error('Unknown KEY');
        await call('browsingContext.activate',{context});
        await input([{type:'key',id:'keyboard',actions:keys([named[key] ?? key])}]);
        break;
      }
      default: throw Error(`Unknown browser action: ${action}`);
    }
    print({ok:true});
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(String(error));process.exitCode=1;});

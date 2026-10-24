import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createConnection, createServer as createSocketServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../../../',import.meta.url));

test('shared Firefox tools reconnect, select, interact, serialize and preserve visible failures',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'philby-browser-'));
  const server=createServer((request,response)=>{
    response.setHeader('content-type','text/html');
    response.end(`<title>Philby Browser ${request.url}</title><textarea id="field"></textarea><button id="commit" onclick="document.querySelector('#output').textContent=document.querySelector('#field').value">Copy</button><pre id="output"></pre><script>document.addEventListener('keydown',event=>window.lastKey=event.key)</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const httpAddress=server.address();assert.ok(httpAddress && typeof httpAddress==='object');
  const url=`http://127.0.0.1:${httpAddress.port}`;
  const reservation=createSocketServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const address=reservation.address();assert.ok(address && typeof address==='object');
  await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  const env={...process.env,FIREFOX_PORT:String(address.port),XDG_RUNTIME_DIR:directory};
  const firefox=spawn('firefox',['--headless','--no-remote','--profile',directory,'--remote-debugging-port',String(address.port),'about:blank'],{env,stdio:['ignore','ignore','pipe']});
  let log='';firefox.stderr.on('data',chunk=>log+=chunk);
  const finished=once(firefox,'close');
  function make(target:string,variables:Record<string,string>={},input?:string,args:string[]=[]):Promise<string> {
    return new Promise((resolve,reject)=>{
      const command=spawn('make',['--no-print-directory','-s','-C',join(root,'shared'),`browser-${target}`,...args],{cwd:root,env:{...env,...variables},stdio:['pipe','pipe','pipe']});
      let out='',err='';command.stdout.on('data',chunk=>out+=chunk);command.stderr.on('data',chunk=>err+=chunk);
      command.on('error',reject);command.on('close',code=>code===0?resolve(out):reject(Error(`${target}: ${code}\n${out}${err}`)));command.stdin.end(input);
    });
  }
  const evaluate=async(expression:string,tab='/first')=>JSON.parse(await make('eval',{TAB:tab,EXPR:expression}));
  try {
    await once(firefox,'spawn');
    let ready=false;
    for(let i=0;i<150 && !ready;i++) {
      if(firefox.exitCode!==null || firefox.signalCode!==null)throw Error(`Firefox exited: ${log}`);
      ready=await new Promise<boolean>(resolve=>{const socket=createConnection(address.port,'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));});
      if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,`Firefox did not start: ${log}`);
    await make('navigate',{TAB:'*',URL:`${url}/first`});
    assert.deepEqual(JSON.parse(await make('start')),{ready:true,port:address.port});
    assert.equal(await evaluate('document.title'),'Philby Browser /first');
    assert.deepEqual(await evaluate('({text:"first",values:[1,true,null],nested:{ok:false}})'),{text:'first',values:[1,true,null],nested:{ok:false}});
    const expression='(() => {\n  const value = "quotes: \' \\\" $HOME `literal`";\n  return {value, lines: "one\\ntwo"};\n})()';
    const expected={value:'quotes: \' " $HOME `literal`',lines:'one\ntwo'};
    assert.deepEqual(JSON.parse(await make('eval',{TAB:'/FIRST'},expression)),expected);
    assert.deepEqual(JSON.parse(await make('eval',{TAB:'/first'},undefined,[`EXPR=${expression}`])),expected);
    const file=join(directory,'expression.js');writeFileSync(file,expression);
    assert.deepEqual(JSON.parse(await make('eval',{TAB:'Philby Browser /first',PROMPT_FILE:file})),expected);
    await assert.rejects(make('fill',{TAB:'/first',SELECTOR:'#commit',TEXT:'invalid'}),/not an editable text field/);
    await evaluate('document.querySelector("#field").readOnly=true');
    await assert.rejects(make('fill',{TAB:'/first',SELECTOR:'#field',TEXT:'invalid'}),/not an editable text field/);
    await evaluate('document.querySelector("#field").readOnly=false');
    await assert.rejects(make('fill',{TAB:'/first',SELECTOR:'#field'}),/TEXT is required/);
    await make('fill',{TAB:'/first',SELECTOR:'#field',TEXT:'clear this'});
    await make('fill',{TAB:'/first',SELECTOR:'#field',TEXT:''});
    assert.equal(await evaluate('document.querySelector("#field").value'),'');
    await make('fill',{TAB:'/first'},undefined,['SELECTOR=textarea[id$="ield"]','TEXT=hello\n"quoted" $HOME `literal`']);
    assert.equal(await evaluate('document.querySelector("#field").value'),'hello\n"quoted" $HOME `literal`');
    await make('press',{TAB:'/first',KEY:'Enter'});
    assert.equal(await evaluate('window.lastKey'),'Enter');
    await make('press',{TAB:'/first',KEY:'x'});
    assert.equal(await evaluate('window.lastKey'),'x');
    await make('click',{TAB:'/first',SELECTOR:'#commit'});
    assert.equal(await evaluate('document.querySelector("#output").textContent'),'hello\n"quoted" $HOME `literal`\nx');
    await assert.rejects(make('click',{TAB:'/first',SELECTOR:'#missing'}),/missing|match|found/i);
    await assert.rejects(make('eval',{TAB:'/first',EXPR:'(() => {throw new Error("visible-evaluation-failure")})()'}),/visible-evaluation-failure/);
    assert.equal(await evaluate('document.title'),'Philby Browser /first');
    const screenshot=join(directory,'screenshot.png');await make('screenshot',{TAB:'/first',OUT:screenshot});
    assert.deepEqual(readFileSync(screenshot).subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
    await assert.rejects(make('fullscreen',{TAB:'/first',SELECTOR:'body'}),/Fullscreen request denied/);
    assert.equal(await evaluate('document.fullscreenElement'),null);
    await evaluate('window.counter=0');
    const increments=await Promise.all([1,2,3].map(()=>evaluate('new Promise(resolve=>{const value=window.counter;setTimeout(()=>resolve(window.counter=value+1),100)})')));
    assert.deepEqual(increments.sort(),[1,2,3]);
    await make('open',{URL:`${url}/second`});
    const tabs=JSON.parse(await make('tabs'));
    assert.deepEqual(tabs.map((tab:{url:string,title:string})=>tab.url).sort(),[`${url}/first`,`${url}/second`]);
    for(const tab of tabs)assert.deepEqual(Object.keys(tab).sort(),['title','url']);
    await assert.rejects(make('eval',{TAB:'Philby Browser',EXPR:'document.title'}),/found 2/);
    await assert.rejects(make('eval',{TAB:'absent-page',EXPR:'document.title'}),/found 0/);
    await assert.rejects(make('eval',{TAB:'*',EXPR:'document.title'}),/found 2/);
    assert.equal(await evaluate('document.title','/second'),'Philby Browser /second');
    await make('navigate',{TAB:'/second',URL:`${url}/third`});
    assert.equal(await evaluate('location.pathname','/third'),'/third');
    await make('close',{TAB:'/third'});
    assert.equal(await evaluate('document.title','*'),'Philby Browser /first');
    assert.equal(JSON.parse(await make('tabs')).length,1);
  } finally {
    firefox.kill('SIGTERM');await finished;
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    rmSync(directory,{recursive:true,force:true});
  }
});

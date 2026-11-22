import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [path,action,...args]=process.argv.slice(2);
const channel=args[4];
let acknowledge=action==='pane-run';
function ready() {
  execFileSync('tmux',['wait-for','-S',channel+'-ready']);
  acknowledge=false;
}

try {
  if(acknowledge) execFileSync('tmux',['wait-for',channel]);
  if(!path) throw Error('Missing launch environment');
  let environment:unknown;
  try {environment=JSON.parse(readFileSync(path,'utf8'));}
  catch {throw Error('Cannot read launch environment');}
  if(!environment || typeof environment!=='object' || Array.isArray(environment) || Object.values(environment).some(value=>typeof value!=='string')) throw Error('Invalid launch environment');
  const terminal=Object.fromEntries(['TERM','TMUX','TMUX_PANE'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  for(const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env,environment,terminal);
  if(action==='pane-run') {
    const {runPane}=await import('../tmux/pane-run.js');
    const [id,name,target,source]=args;
    await runPane(id,name,target,source,ready);
  } else if(action==='close-view') {
    const [id,pane,kind,label]=args;
    if(kind!=='pane' && kind!=='frame') throw Error('Expected a frame or pane');
    const {confirmClose}=await import('../tmux/confirm-close.js');
    if(await confirmClose(kind,label)) {
      const {closeView}=await import('../tmux/index.js');
      await closeView(id,pane,kind);
    }
  } else {
    process.argv.splice(2,1);
    await import('./cli.js');
  }
} catch(error) {
  const message=error instanceof Error?error.message:String(error);
  console.error(message);
  process.exitCode=1;
  if(acknowledge) {
    execFileSync('tmux',['set-option','-p','-t',process.env.TMUX_PANE!,'@philby_launch_error',message]);
    ready();
  }
}

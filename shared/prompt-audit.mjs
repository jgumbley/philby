import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';

const root=fileURLToPath(new URL('../',import.meta.url));
const baselineRef=process.env.BASELINE;
assert(baselineRef,'BASELINE Git revision is required');
let entries;
try {entries=JSON.parse(readFileSync(0,'utf8'));}
catch {throw Error('Invalid pane-capture JSON on stdin');}
assert(Array.isArray(entries),'Expected pane-capture JSON array on stdin');
const messages=entries.flatMap(entry=>entry.model ?? []);
const recorded=messages.find(message=>message.role==='system' && message.sections?.['pane-guidance']);
assert(recorded,'Capture has no pane-guidance section');
const guidance=recorded.sections['pane-guidance'];
assert(guidance===`<pane-guidance>\n${readFileSync(new URL('../PANE.md',import.meta.url),'utf8')}\n</pane-guidance>`,'Recorded guidance differs from current PANE.md');
const identity=recorded.sections.pane.match(/Your pane is ([a-z0-9-]+)\. Your working directory is (.+)\. Philby's root is (.+)\. Shared capabilities are in (.+)\/shared\/Makefile\./);
assert(identity,'Unrecognised pane identity section');
const [,name,directory,paneRoot,sharedRoot]=identity;
assert(paneRoot===sharedRoot,'Shared capability root differs from pane root');
const sharedPath=`${paneRoot}/shared/Makefile`;
let source;
try {source=execFileSync('git',['show','--end-of-options',`${baselineRef}:src/pane.ts`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
catch(error) {throw Error(`Cannot read baseline src/pane.ts: ${error.code ?? error.status}`);}
const template=source.match(/section\('pane', \(\) => `([^`]+)`\)/)?.[1];
assert(template,'Baseline pane section not found');
const substitutions={name,'dirs.tools':directory,root:paneRoot};
const baseline=`<pane>\n${template.replace(/\$\{([^}]+)\}/g,(_match,key)=>{
  assert(Object.hasOwn(substitutions,key),'Unknown baseline template placeholder');
  return substitutions[key];
})}\n</pane>`;
const catalog=openrouterProvider().getModels();
let networkCalls=0;
const noNetwork=async()=>{networkCalls++;throw Error('Network forbidden during prompt audit');};
globalThis.fetch=noNetwork;

async function payloadFor(model,messages) {
  let payload;
  const response=await streamSimple(model,{messages},{
    apiKey:'offline-audit-placeholder',fetch:noNetwork,
    onPayload:value=>{payload=value;throw Error('Offline payload captured');}
  }).result();
  assert(payload,'Provider payload was not captured');
  assert(response.errorMessage==='Offline payload captured','Provider did not stop at offline capture');
  assert.equal(networkCalls,0,'Audit attempted a network request');
  return payload;
}

function describe(payload,expectedGuidance,discovery,makeRequirement) {
  const instruction=payload.messages[0];
  assert(instruction.role==='system','Expected leading system message');
  assert.equal(typeof instruction.content,'string','Expected text system instructions');
  const text=instruction.content;
  const report={role:instruction.role,instructionCharacters:text.length,fullGuidance:text.includes(expectedGuidance),sharedPath:text.includes(sharedPath),sharedDiscovery:text.includes(discovery),makeRequired:text.includes(makeRequirement)};
  assert(report.fullGuidance && report.sharedPath && report.sharedDiscovery && report.makeRequired,'Required instruction missing from provider payload');
  return report;
}

function baselineMessages(messages) {
  return messages.map(message=>{
    if(message.role!=='system') return message;
    const sections={};
    for(const [key,value] of Object.entries(message.sections ?? {})) {
      if(['pane-guidance','shared-tools','pane-tools'].includes(key)) continue;
      if(key==='pane-scope') sections['pane-instructions']=value===null ? null : value.replace(/^<pane-scope>/,'<pane-instructions>').replace(/<\/pane-scope>$/,'</pane-instructions>');
      else sections[key]=key==='pane' ? baseline : value;
    }
    return {...message,sections};
  });
}

const prefix=[];
let requests=0;
for(const message of messages) {
  if(message.role==='assistant') {
    assert(message.provider==='openrouter','Audit requires recorded OpenRouter requests');
    assert(message.api==='openai-completions','Audit requires OpenAI-compatible requests');
    const model=catalog.find(model=>model.id===message.model);
    assert(model,'Recorded model not found in installed catalog');
    const current=describe(await payloadFor(model,prefix),guidance,'Every pane can use the shared tools in','Execute operations relevant to your pane\'s purpose through named Make targets.');
    const previous=describe(await payloadFor(model,baselineMessages(prefix)),baseline,'check both Makefiles and their help before deciding a capability is missing.','Execute task-specific operations through named Makefile targets.');
    console.log(JSON.stringify({request:++requests,current,baseline:previous}));
  }
  prefix.push(message);
}
assert(requests>0,'Capture has no assistant requests to audit');
console.log(JSON.stringify({requests,networkCalls,passed:true}));

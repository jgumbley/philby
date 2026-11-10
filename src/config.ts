import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadConfiguration } from './varlock.js';

const provenanceKey='PHILBY_CONFIG_PROVENANCE';
const currentFrame=process.env.PHILBY_FRAME;
const currentFramesDir=currentFrame?process.env.PHILBY_FRAMES_DIR:undefined;
function invocation(env:NodeJS.ProcessEnv) {
  const result={...env};
  const serialized=result[provenanceKey];
  delete result[provenanceKey];
  if(serialized!==undefined) {
    let entries:unknown;
    try {entries=JSON.parse(serialized);} catch {throw Error('Invalid configuration environment provenance');}
    if(!Array.isArray(entries)) throw Error('Invalid configuration environment provenance');
    for(const entry of entries) {
      if(!Array.isArray(entry) || entry.length!==3 || typeof entry[0]!=='string' || !entry.slice(1).every(value=>value===null || typeof value==='string')) throw Error('Invalid configuration environment provenance');
      const [key,before,after]=entry;
      if((result[key] ?? null)===after) {
        if(before===null) delete result[key];
        else result[key]=before;
      }
    }
  }
  return result;
}
export const invocationEnvironment=invocation(process.env);
export const root=resolve(invocationEnvironment.PHILBY_ROOT || fileURLToPath(new URL('../../',import.meta.url)));
export const piAgentDir=join(root,'.pi','agent');
const instance=loadConfiguration([root],invocationEnvironment);

function environment(values:NodeJS.ProcessEnv) {
  const configured:NodeJS.ProcessEnv={...values,PHILBY_ROOT:root,PI_CODING_AGENT_DIR:piAgentDir};
  const result={...invocationEnvironment};
  for(const [key,value] of Object.entries(configured)) {
    if(value===undefined) delete result[key];
    else result[key]=value;
  }
  result[provenanceKey]=JSON.stringify(Object.keys(configured).map(key=>[key,invocationEnvironment[key] ?? null,result[key] ?? null]));
  return result;
}
export const instanceEnvironment=environment({...instance.values,...(currentFramesDir===undefined?{}:{PHILBY_FRAMES_DIR:currentFramesDir}),PHILBY_FRAME:currentFrame});
export function applyEnvironment(env:NodeJS.ProcessEnv) {
  for(const key of Object.keys(process.env)) if(!(key in env)) delete process.env[key];
  Object.assign(process.env,env);
}
applyEnvironment(instanceEnvironment);

export function frameEnvironment(directory:string,id:string,framesRoot:string) {
  const loaded=loadConfiguration([root,directory],invocationEnvironment);
  const localKeys=loaded.files.filter(file=>!instance.files.includes(file)).flatMap(file=>Object.keys(parseEnv(readFileSync(file,'utf8'))));
  const reserved=[...new Set(localKeys.filter(key=>key.startsWith('PHILBY_') || key==='PI_CODING_AGENT_DIR' || key==='FRAME_MODEL' || key==='FRAME_THINKING_LEVEL' || key==='FRAME_MESSAGING'))];
  if(reserved.length) throw Error(`Frame environment contains reserved keys: ${reserved.join(', ')}`);
  const values:NodeJS.ProcessEnv={...loaded.values,PHILBY_FRAME:id,PHILBY_FRAMES_DIR:framesRoot};
  delete values.id;
  const result=environment(values);
  delete result.id;
  return result;
}

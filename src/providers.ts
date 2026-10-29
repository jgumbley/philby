import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const configRoot = () => resolve(process.env.PHILBY_ROOT || fileURLToPath(new URL('../../', import.meta.url)));
export type ProviderConfig = {id:string;models:string[];file:string} & (
  {type:'openrouter';apiKey:string} | {type:'openai-compatible';apiKey:string;baseUrl:string;catalog:string} | {type:'openai';auth:'oauth'}
);
export const consultationDefaults = {
  ask:'openrouter/z-ai/glm-5.2',
  reason:'openrouter/openai/gpt-5.5',
  twitter:'openrouter/x-ai/grok-4.3:online',
};
export function modelReference(reference:string|undefined) {
  if(!reference || !/^[a-z0-9][a-z0-9-]{0,63}\/\S+$/.test(reference)) throw Error('Model reference must be provider/model-id; set DEFAULT_MODEL in .env');
  const slash=reference.indexOf('/');
  return {provider:reference.slice(0,slash),modelId:reference.slice(slash+1)};
}
export function loadProviders(directory=configRoot()):ProviderConfig[] {
  const files=readdirSync(directory).filter(file=>file.endsWith('.provider')).sort();
  if(!files.length) throw Error('No provider files found; run make -C shared provider-setup');
  return files.map(file=>{
    const id=file.slice(0,-'.provider'.length);
    if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw Error(`${file}: invalid provider filename`);
    let values:NodeJS.Dict<string>;
    try {values=parseEnv(readFileSync(join(directory,file),'utf8'));}
    catch {throw Error(`${file}: unable to read provider configuration`);}
    if(values.TYPE!=='openrouter' && values.TYPE!=='openai-compatible' && values.TYPE!=='openai') throw Error(`${file}: unsupported TYPE; supported: openrouter, openai-compatible, openai`);
    const allowed=['TYPE','MODELS',...(values.TYPE==='openai'?['AUTH']:['API_KEY']),...(values.TYPE==='openai-compatible'?['BASE_URL','CATALOG']:[])];
    if(Object.keys(values).some(key=>!allowed.includes(key))) throw Error(`${file}: unsupported setting; expected ${allowed.join(', ')}`);
    const models=(values.MODELS || '').split(',').map(model=>model.trim());
    const ids=models.map(model=>model.split('=',1)[0]);
    if(models.some(model=>!model || /\s/.test(model)) || ids.some(id=>!id) || new Set(ids).size!==ids.length) throw Error(`${file}: MODELS must be a nonempty list of unique model IDs`);
    const common={id,models,file};
    if(values.TYPE==='openai') {
      if(id!=='openai') throw Error(`${file}: TYPE=openai must use openai.provider`);
      if(values.AUTH!=='oauth') throw Error(`${file}: AUTH must be oauth`);
      return {...common,type:values.TYPE,auth:values.AUTH};
    }
    if(!values.API_KEY?.trim()) throw Error(`${file}: API_KEY is required`);
    if(values.TYPE==='openrouter') return {...common,type:values.TYPE,apiKey:values.API_KEY};
    let url:URL;
    try {url=new URL(values.BASE_URL || '');} catch {throw Error(`${file}: BASE_URL must be an HTTP(S) URL`);}
    if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error(`${file}: BASE_URL must be an HTTP(S) URL without credentials, query or fragment`);
    if(!values.CATALOG?.trim()) throw Error(`${file}: CATALOG must name a Pi model catalog`);
    return {...common,type:values.TYPE,apiKey:values.API_KEY,baseUrl:url.href.replace(/\/$/,''),catalog:values.CATALOG};
  });
}

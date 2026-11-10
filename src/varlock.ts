import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli=resolve(dirname(fileURLToPath(import.meta.resolve('varlock'))),'../bin/cli.js');
type Graph = {
  basePath:string;
  sources:{path?:string;enabled?:boolean}[];
  config:Record<string,{value?:unknown;envStr?:string}>;
  errors?:{configItems?:Record<string,unknown>;root?:unknown};
  settings?:{injectUndefinedAsEmpty?:boolean};
};

export function loadConfiguration(paths:string[],env:NodeJS.ProcessEnv):{values:NodeJS.ProcessEnv;files:string[]} {
  if(!paths.length) throw Error('Varlock requires an explicit configuration path');
  const absolute=paths.map(path=>resolve(path));
  for(const path of absolute) {
    let schema=path;
    try {
      if(statSync(path).isDirectory()) schema=join(path,'.env.schema');
      if(!statSync(schema).isFile()) throw Error();
    } catch {throw Error(`Configuration schema or file is missing: ${schema}`);}
  }
  const childEnv:NodeJS.ProcessEnv={...env,VARLOCK_TELEMETRY_DISABLED:'1'};
  for(const key of Object.keys(childEnv)) if(key==='NODE_OPTIONS' || /^__?VARLOCK_/.test(key)) delete childEnv[key];
  const result=spawnSync(process.execPath,[cli,'load','--format','json-full','--compact','--skip-cache',...absolute.flatMap(path=>['--path',path])],{
    cwd:dirname(absolute[0]),env:childEnv,encoding:'utf8',timeout:30_000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe'],
  });
  let graph:Graph|undefined;
  try {graph=JSON.parse(result.stdout);} catch {}
  if(result.error) throw Error(`Varlock could not load configuration (${(result.error as NodeJS.ErrnoException).code || 'process failure'})`);
  if(result.status!==0 || graph?.errors) {
    const keys=Object.keys(graph?.errors?.configItems || {}).filter(key=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(key));
    throw Error(`Varlock configuration is invalid${keys.length?`: ${keys.join(', ')}`:''}; check schemas and required values`);
  }
  if(!graph?.config || typeof graph.config!=='object' || Array.isArray(graph.config) || typeof graph.basePath!=='string' || !Array.isArray(graph.sources)) throw Error('Varlock returned an invalid configuration result');
  const values=Object.fromEntries(Object.entries(graph.config).map(([key,item])=>[
    key,item.envStr ?? (item.value===undefined ? (graph.settings?.injectUndefinedAsEmpty?'':undefined) : String(item.value)),
  ]));
  const files=[...new Set(graph.sources.filter(source=>source.enabled && typeof source.path==='string').map(source=>resolve(graph.basePath,source.path!)))];
  return {values,files};
}

export function loadEnvironment(paths:string[],env:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  return loadConfiguration(paths,env).values;
}

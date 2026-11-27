import { accessSync, closeSync, constants, fsyncSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { ModelThinkingLevel } from '@earendil-works/pi-ai/providers/model-schema';
import { frameSettingKeys, root } from './config.js';
import { modelReference, type ModelReference } from './providers.js';
import { loadEnvironment } from './varlock.js';

export type ThinkingLevel = ModelThinkingLevel;
export type FrameSettings = {model:ModelReference;thinkingLevel?:ThinkingLevel;memory?:boolean;toolSources?:string[]};
export class FrameSettingsWriteError extends Error {
  readonly published=true;
  constructor(cause:unknown) {
    super('Frame settings were saved but synchronization failed',{cause});
    this.name='FrameSettingsWriteError';
  }
}
export function resolveToolSources(directory:string,sources:readonly string[]=[]):string[] {
  return sources.map(source=>{
    const [namespace,...parts]=source.split('/');
    if((namespace!=='shared' && namespace!=='frame') || !parts.length || parts.some(part=>!part || part==='..' || part==='.')) throw Error(`Invalid FRAME_TOOL_SOURCES reference: ${source}`);
    const path=join(namespace==='shared'?join(root,'shared'):directory,...parts);
    if(!statSync(path,{throwIfNoEntry:false})?.isFile()) throw Error(`FRAME_TOOL_SOURCES file is missing or is not a file: ${path}`);
    accessSync(path,constants.R_OK);
    return path;
  });
}

function parseSettings(source:string):FrameSettings {
  const seen=new Set<string>();
  for(const line of source.split(/\r?\n/)) {
    if(!line.trim() || line.trimStart().startsWith('#')) continue;
    const key=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if(!key) throw Error('Invalid frame.env assignment; settings must use one line per key');
    if(!frameSettingKeys.includes(key)) throw Error(`Unknown frame.env setting: ${key}`);
    if(seen.has(key)) throw Error(`Duplicate frame.env setting: ${key}`);
    seen.add(key);
  }
  const assignments=parseEnv(source);
  if(assignments.FRAME_MEMORY==='') throw Error('Invalid empty frame.env setting: FRAME_MEMORY');
  const values=loadEnvironment([join(root,'shared','frame.env.schema')],assignments);
  const model=modelReference(values.FRAME_MODEL);
  const thinkingLevel=values.FRAME_THINKING_LEVEL as ThinkingLevel | undefined;
  const settings:FrameSettings={model};
  if(thinkingLevel) settings.thinkingLevel=thinkingLevel;
  if(values.FRAME_MEMORY==='true') settings.memory=true;
  const sources=values.FRAME_TOOL_SOURCES?.trim();
  if(sources) settings.toolSources=[...new Set(sources.split(/\s+/))];
  return settings;
}

export function readFrameSettings(directory:string):FrameSettings|undefined {
  let source:string;
  try {source=readFileSync(join(directory,'frame.env'),'utf8');}
  catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT') return undefined;throw error;}
  return parseSettings(source);
}

export function writeFrameSettings(directory:string,settings:FrameSettings):void {
  const reference=`${settings.model.provider}/${settings.model.modelId}`;
  const lines=[`FRAME_MODEL="${reference}"`];
  if(settings.thinkingLevel) lines.push(`FRAME_THINKING_LEVEL=${settings.thinkingLevel}`);
  if(settings.memory) lines.push('FRAME_MEMORY=true');
  if(settings.toolSources?.length) lines.push(`FRAME_TOOL_SOURCES="${settings.toolSources.join(' ')}"`);
  const source=lines.join('\n')+'\n';
  const validated=parseSettings(source);
  if(validated.model.provider!==settings.model.provider || validated.model.modelId!==settings.model.modelId || validated.thinkingLevel!==settings.thinkingLevel
    || (validated.memory ?? false)!==(settings.memory ?? false) || JSON.stringify(validated.toolSources ?? [])!==JSON.stringify(settings.toolSources ?? [])) throw Error('Frame settings cannot be represented in frame.env');
  const temporary=join(directory,`.frame.env-${randomUUID()}.tmp`);
  let published=false;
  try {
    try {
      const file=openSync(temporary,'wx',0o600);
      try {writeFileSync(file,source);fsyncSync(file);} finally {closeSync(file);}
      renameSync(temporary,join(directory,'frame.env'));
      published=true;
      const parent=openSync(directory,'r');
      try {fsyncSync(parent);} finally {closeSync(parent);}
    } finally {rmSync(temporary,{force:true});}
  } catch(error) {
    if(published) throw new FrameSettingsWriteError(error);
    throw error;
  }
}

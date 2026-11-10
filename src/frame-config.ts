import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { ModelThinkingLevel } from '@earendil-works/pi-ai/providers/model-schema';
import { root } from './config.js';
import { modelReference, type ModelReference } from './providers.js';
import { loadEnvironment } from './varlock.js';

export type ThinkingLevel = ModelThinkingLevel;
export type FrameSettings = {model:ModelReference;thinkingLevel?:ThinkingLevel};
export class FrameSettingsWriteError extends Error {
  readonly published=true;
  constructor(cause:unknown) {
    super('Frame settings were saved but synchronization failed',{cause});
    this.name='FrameSettingsWriteError';
  }
}
const keys=['FRAME_MODEL','FRAME_THINKING_LEVEL'];

function parseSettings(source:string):FrameSettings {
  const seen=new Set<string>();
  for(const line of source.split(/\r?\n/)) {
    if(!line.trim() || line.trimStart().startsWith('#')) continue;
    const key=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if(!key) throw Error('Invalid frame.env assignment; settings must use one line per key');
    if(!keys.includes(key)) throw Error(`Unknown frame.env setting: ${key}`);
    if(seen.has(key)) throw Error(`Duplicate frame.env setting: ${key}`);
    seen.add(key);
  }
  const values=loadEnvironment([join(root,'shared','frame.env.schema')],parseEnv(source));
  const model=modelReference(values.FRAME_MODEL);
  const thinkingLevel=values.FRAME_THINKING_LEVEL as ThinkingLevel | undefined;
  return {model,...(thinkingLevel?{thinkingLevel}:{})};
}

export function readFrameSettings(directory:string):FrameSettings|undefined {
  let source:string;
  try {source=readFileSync(join(directory,'frame.env'),'utf8');}
  catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT') return undefined;throw error;}
  return parseSettings(source);
}

export function writeFrameSettings(directory:string,settings:FrameSettings):void {
  const reference=`${settings.model.provider}/${settings.model.modelId}`;
  const source=`FRAME_MODEL="${reference}"\nFRAME_THINKING_LEVEL=${settings.thinkingLevel ?? ''}\n`;
  const validated=parseSettings(source);
  if(validated.model.provider!==settings.model.provider || validated.model.modelId!==settings.model.modelId || validated.thinkingLevel!==settings.thinkingLevel) throw Error('Frame settings cannot be represented in frame.env');
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

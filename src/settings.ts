import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { clampThinkingLevel, type Api, type Model } from '@earendil-works/pi-ai';
import { MODEL_THINKING_LEVELS } from '@earendil-works/pi-ai/providers/model-schema';
import type { HarnessSettings } from '@earendil-works/pi-durable';
import { root, piAgentDir } from './config.js';
import { modelReference } from './providers.js';

function checkSettings(settings:SettingsManager) {
  const errors=settings.drainErrors();
  if(errors.length) throw Error(errors.map(({path,error})=>`${path || 'Pi settings'}: ${error.message}`).join('\n'));
}

export function modelThinkingLevel(model:Model<Api>,settings=SettingsManager.create(root,piAgentDir)) {
  checkSettings(settings);
  const configured=settings.getSettings().modelThinkingLevels;
  if(configured!==undefined && (configured===null || typeof configured!=='object' || Array.isArray(configured))) throw Error('Invalid modelThinkingLevels setting: expected an object');
  const level=settings.getModelThinkingLevel(model.provider,model.id);
  if(level===undefined) return undefined;
  if(!MODEL_THINKING_LEVELS.includes(level)) throw Error(`Invalid modelThinkingLevels["${model.provider}/${model.id}"] setting: ${String(level)}`);
  return clampThinkingLevel(model,level);
}

export function harnessSettings(settings=SettingsManager.create(root,piAgentDir)):HarnessSettings {
  checkSettings(settings);
  const configured=settings.getSettings().compaction;
  for(const [name,value] of [['compaction',configured],['compaction.modelOverrides',configured?.modelOverrides]]) {
    if(value!==undefined && (value===null || typeof value!=='object' || Array.isArray(value))) throw Error(`Invalid ${name} setting: expected an object`);
  }
  const compaction=settings.getCompactionSettings();
  if(typeof compaction.enabled!=='boolean') throw Error('Invalid compaction.enabled setting: expected a boolean');
  const modelOverrides=Object.fromEntries(Object.keys(configured?.modelOverrides || {}).map(reference=>{
    const {provider,modelId}=modelReference(reference);
    return [reference,{...settings.getCompactionSettings({provider,id:modelId}),backgroundTokens:0}];
  }));
  return {compaction:{...compaction,modelOverrides}};
}

import { SettingsManager } from '@earendil-works/pi-coding-agent';
import type { HarnessSettings } from '@earendil-works/pi-durable';
import { root, piAgentDir } from './config.js';
import { modelReference } from './providers.js';

export function harnessSettings(settings=SettingsManager.create(root,piAgentDir)):HarnessSettings {
  const errors=settings.drainErrors();
  if(errors.length) throw Error(errors.map(({path,error})=>`${path || 'Pi settings'}: ${error.message}`).join('\n'));
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

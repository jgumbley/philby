import { root, piAgentDir } from './config.js';
import { InMemoryCredentialStore, fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { ModelRuntime, SettingsManager, resolveModelScopeWithDiagnostics, type ScopedModel, type CreateModelRuntimeOptions } from '@earendil-works/pi-coding-agent';
import type { Models } from '@earendil-works/pi-ai/models';
import { modelReference, type ModelReference } from './providers.js';

export type ModelChoice = {provider:string;modelId:string;label:string;description:string};
export async function availableModels(models:Models,reportError:(error:Error)=>void=error=>{throw error;}) {
  const signal=AbortSignal.timeout(10_000);
  const available=await Promise.all(models.getProviders().map(async provider=>{
    try {return await models.getAvailable(provider.id,{signal});}
    catch(error) {
      reportError(Error(`${provider.id}: ${error instanceof Error?error.message:String(error)}`));
      return [];
    }
  }));
  return available.flat();
}
export async function modelChoices(models:Models,reportError?:(error:Error)=>void):Promise<ModelChoice[]> {
  return (await availableModels(models,reportError))
    .sort((a,b)=>a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map(model=>({provider:model.provider,modelId:model.id,label:model.name,description:`${model.provider} · ${model.id} · ${model.contextWindow} context`}));
}
export async function modelScope(models:ModelRuntime,settings=SettingsManager.create(root,piAgentDir)):Promise<{scopedModels:ScopedModel[];errors:string[]}> {
  const errors=settings.drainErrors().map(({path,error})=>`${path || 'Pi settings'}: ${error.message}`);
  const patterns=settings.getEnabledModels() || [];
  if(!patterns.length) return {scopedModels:[],errors};
  try {
    const result=await resolveModelScopeWithDiagnostics(patterns,models,{signal:AbortSignal.timeout(10_000)});
    return {scopedModels:result.scopedModels,errors:[...errors,...result.diagnostics.map(diagnostic=>diagnostic.message)]};
  } catch(error) {
    return {scopedModels:[],errors:[...errors,error instanceof Error?error.message:String(error)]};
  }
}
export async function refreshModels(models:Models):Promise<string[]> {
  const result=await models.refresh({signal:AbortSignal.timeout(10_000)});
  const errors=[...result.errors].map(([provider,error])=>`${provider}: ${error.message}`);
  if(result.aborted) errors.push('Model refresh timed out');
  if(models instanceof ModelRuntime) {
    const error=models.getError();
    if(error) errors.push(error);
  }
  return errors;
}
export async function configuredModels(options:CreateModelRuntimeOptions={}) {
  return ModelRuntime.create(options);
}
export async function models(reference?:string,{env=process.env,...options}:CreateModelRuntimeOptions & {env?:NodeJS.ProcessEnv}={}):Promise<{models:Models;model:ModelReference|undefined}> {
  if(env.PHILBY_TEST_PROVIDER === '1') {
    const models=await ModelRuntime.create({modelsPath:null,credentials:new InMemoryCredentialStore(),refreshOnCreate:false});
    const faux=fauxProvider({provider:'test',models:[{id:'test',name:'Test'},{id:'test-alternate',name:'Test alternate'}],tokensPerSecond:200});
    faux.setResponses(Array.from({length:100},()=>context=>{
      const last=context.messages.filter(m=>m.role==='user').at(-1);
      return fauxAssistantMessage(`Received: ${typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)}`);
    }));
    models.registerNativeProvider(faux.provider);
    await models.refresh({allowNetwork:false});
    return {models,model:{provider:'test',modelId:'test'}};
  }
  const configured=await configuredModels(options);
  const model=reference===undefined?undefined:modelReference(reference);
  if(model && !configured.getModel(model.provider,model.modelId)) throw Error(`Model unavailable: ${model.provider}/${model.modelId}${configured.getError()?`\n${configured.getError()}`:''}`);
  return {models:configured,model};
}

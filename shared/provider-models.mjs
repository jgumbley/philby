import { availableModels, configuredModels, refreshModels } from '../dist/src/models.js';

try {
  const runtime=await configuredModels();
  const provider=process.env.PROVIDER || undefined;
  const errors=await refreshModels(runtime);
  if(provider && !runtime.getProvider(provider)) throw Error(`Unknown provider: ${provider}`);
  const models=await availableModels(runtime,error=>errors.push(error.message));
  for(const error of new Set(errors)) console.error(error);
  if(errors.length) process.exitCode=1;
  console.log(JSON.stringify(models.filter(model=>!provider || model.provider===provider).map(({provider,id,name,contextWindow,maxTokens})=>({provider,id,name,contextWindow,maxTokens})),null,2));
} catch(error) {
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
}

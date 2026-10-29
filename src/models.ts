import { createModels, createProvider, fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { ProviderCredentials } from './credentials.js';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import type { Models } from '@earendil-works/pi-ai/models';
import { configRoot, loadProviders, modelReference, type ProviderConfig } from './providers.js';
export type ModelChoice = {provider:string;modelId:string;label:string;description:string};
const menus=new WeakMap<Models,ModelChoice[]>();
export function modelChoices(models:Models):ModelChoice[] {
  return menus.get(models) || models.getModels('test').map(model=>({provider:'test',modelId:model.id,label:model.name,description:'Deterministic development model'}));
}
export async function models(reference?:string,{directory=configRoot(),env=process.env}:{directory?:string;env?:NodeJS.ProcessEnv}={}) {
  if(env.PHILBY_TEST_PROVIDER === '1') {
    const models = createModels();
    const faux = fauxProvider({provider:'test',models:[{id:'test',name:'Test'},{id:'test-alternate',name:'Test alternate'}],tokensPerSecond:200});
    faux.setResponses(Array.from({length:100},()=> context => {
      const last=context.messages.filter(m=>m.role==='user').at(-1);
      return fauxAssistantMessage(`Received: ${typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)}`);
    }));
    models.setProvider(faux.provider);
    return {models,model:{provider:'test',modelId:'test'},providerType:'test'};
  }
  const configs=loadProviders(directory);
  const configured=configuredModels(configs,directory);
  const model=modelReference(reference ?? env.DEFAULT_MODEL);
  if(!configured.getModel(model.provider,model.modelId)) throw Error(`Model unavailable: ${model.provider}/${model.modelId}`);
  return {models:configured,model,providerType:configs.find(config=>config.id===model.provider)!.type};
}
export function configuredModels(configs:ProviderConfig[],directory:string) {
  const models=createModels({credentials:new ProviderCredentials(directory)});
  const menu:ModelChoice[]=[];
  for(const config of configs) {
    if(config.type==='openai') {
      const provider=openaiProvider();
      const catalog=config.models.map(id=>{
        const model=provider.getModels().find(model=>model.id===id);
        if(!model) throw Error(`${config.file}: MODELS contains an unavailable model`);
        return model;
      });
      models.setProvider({...provider,auth:{oauth:provider.auth.oauth!},getModels:()=>catalog,getAllModels:()=>catalog});
      menu.push(...catalog.map(model=>({provider:config.id,modelId:model.id,label:model.name,description:`${config.id} · ChatGPT · ${model.contextWindow} context`})));
      continue;
    }
    const auth={apiKey:{name:config.file,resolve:async()=>({auth:{apiKey:config.apiKey},source:config.file})}};
    if(config.type==='openai-compatible') {
      const source=getBuiltinProviders().find(id=>id===config.catalog);
      if(!source) throw Error(`${config.file}: CATALOG is not available in Pi`);
      const metadata=getBuiltinModels(source);
      const catalog=config.models.map(entry=>{
        const eq=entry.indexOf('=');
        const id=eq<0?entry:entry.slice(0,eq);
        const ref=eq<0?entry:entry.slice(eq+1);
        const slash=ref.indexOf('/');
        const base=getBuiltinModels(slash>0 && getBuiltinProviders().some(p=>p===ref.slice(0,slash))?(ref.slice(0,slash) as typeof source):source).find(model=>model.id===(slash>0 && getBuiltinProviders().some(p=>p===ref.slice(0,slash))?ref.slice(slash+1):ref)) ?? metadata.find(model=>model.id===ref);
        if(!base) throw Error(`${config.file}: MODELS contains a model absent from the Pi catalog`);
        const {name,contextWindow,maxTokens,cost}=base;
        return {id,name,provider:config.id,api:'openai-completions' as const,baseUrl:config.baseUrl,
          reasoning:false,input:['text' as const],contextWindow,maxTokens,cost,
          compat:{supportsDeveloperRole:false,maxTokensField:'max_tokens' as const}};
      });
      models.setProvider(createProvider({id:config.id,baseUrl:config.baseUrl,auth,models:catalog,api:openAICompletionsApi()}));
      menu.push(...catalog.map(model=>({provider:config.id,modelId:model.id,label:model.name,description:`${config.id} · ${model.contextWindow} context`})));
      continue;
    }
    const provider=openrouterProvider();
    const catalog=provider.getModels().map(model=>({...model,provider:config.id}));
    const flash=catalog.find(model=>model.id==='deepseek/deepseek-v4.1-flash');
    if(!flash) throw Error('OpenRouter model unavailable: deepseek/deepseek-v4.1-flash');
    catalog.push({...flash,id:'deepseek/deepseek-v4.1-flash-1017',name:'DeepSeek: DeepSeek V4.1 Flash 1017',contextWindow:1048576,maxTokens:393216,input:['text','image'],cost:{input:0.15,output:0.6,cacheRead:0.003,cacheWrite:0}});
    catalog.push(...catalog.filter(model=>!model.id.endsWith(':online')).map(model=>({...model,id:model.id+':online'})));
    for(const id of config.models) {
      const model=catalog.find(model=>model.id===id);
      if(!model) throw Error(`${config.file}: MODELS contains an unavailable model`);
      menu.push({provider:config.id,modelId:id,label:model.name,description:`${config.id} · ${model.contextWindow} context`});
    }
    models.setProvider({...provider,id:config.id,name:config.id,
      auth,
      getModels:()=>catalog,getAllModels:()=>catalog});
  }
  menus.set(models,menu);
  return models;
}

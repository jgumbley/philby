import { createModels, fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import type { Models } from '@earendil-works/pi-ai/models';
export type ModelChoice = {provider:string;modelId:string;label:string;description:string};
const choices:ModelChoice[] = [
  {provider:'openrouter',modelId:'moonshotai/kimi-k3',label:'Kimi K3',description:'Text and images; 1M context'},
  {provider:'openrouter',modelId:'z-ai/glm-5.2',label:'GLM 5.2',description:'Text; 1M context'},
  {provider:'openrouter',modelId:'z-ai/glm-5.3',label:'GLM 5.3',description:'Text; 1M context'},
  {provider:'openrouter',modelId:'z-ai/glm-5.3-flash',label:'GLM 5.3 Flash',description:'Text and images; 1M context'},
  {provider:'openrouter',modelId:'deepseek/deepseek-v4-pro-0813',label:'DeepSeek V4 Pro 0813',description:'Text; 1M context; August 13 snapshot'},
  {provider:'openrouter',modelId:'deepseek/deepseek-v4.1-flash',label:'DeepSeek V4.1 Flash',description:'Text and images; 1M context'},
  {provider:'openrouter',modelId:'deepseek/deepseek-v4.1-flash-1017',label:'DeepSeek V4.1 Flash 1017',description:'Text and images; 1M context; October 17 snapshot'},
  {provider:'openrouter',modelId:'minimax/minimax-m3',label:'MiniMax M3',description:'Text and images; 512K context'},
];
export function modelChoices(models:Models):ModelChoice[] {
  return [...choices.filter(choice=>models.getModel(choice.provider,choice.modelId)),...models.getModels('test').map(model=>({provider:'test',modelId:model.id,label:model.name,description:'Deterministic development model'}))];
}
export async function models(modelId = process.env.PI_MODEL_ID || 'moonshotai/kimi-k3') {
  const models = createModels();
  if(process.env.PHILBY_TEST_PROVIDER === '1') {
    const faux = fauxProvider({provider:'test',models:[{id:'test',name:'Test'},{id:'test-alternate',name:'Test alternate'}],tokensPerSecond:200});
    faux.setResponses(Array.from({length:100},()=> context => {
      const last=context.messages.filter(m=>m.role==='user').at(-1);
      return fauxAssistantMessage(`Received: ${typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)}`);
    }));
    models.setProvider(faux.provider);
    return {models,model:{provider:'test',modelId:'test'}};
  }
  if(!process.env.OPENROUTER_API_KEY) throw Error('OPENROUTER_API_KEY is required');
  const provider=openrouterProvider();
  const catalog=[...provider.getModels()];
  const flash=catalog.find(model=>model.id==='deepseek/deepseek-v4.1-flash');
  if(!flash) throw Error('OpenRouter model unavailable: deepseek/deepseek-v4.1-flash');
  catalog.push({...flash,id:'deepseek/deepseek-v4.1-flash-1017',name:'DeepSeek: DeepSeek V4.1 Flash 1017',contextWindow:1048576,maxTokens:393216,input:['text','image'],cost:{input:0.15,output:0.6,cacheRead:0.003,cacheWrite:0}});
  if(modelId.endsWith(':online')) {
    const base=catalog.find(m=>m.id===modelId.slice(0,-7));
    if(!base) throw Error(`Unknown OpenRouter base model: ${modelId}`);
    catalog.push({...base,id:modelId});
  }
  models.setProvider({...provider,getModels:()=>catalog,getAllModels:()=>catalog});
  if(!models.getModel('openrouter',modelId)) throw Error(`OpenRouter model unavailable: ${modelId}`);
  return {models,model:{provider:'openrouter',modelId}};
}

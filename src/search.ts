import { configuredModels } from './models.js';
import type { SearchResult } from './search-record.js';

type Citation={type:string;url_citation?:{title?:string;url?:string;content?:string}};

export async function searchOpenRouter(query:string):Promise<SearchResult[]> {
  if(!query.trim()) throw Error('Supply a nonempty search query');
  const runtime=await configuredModels({refreshOnCreate:false});
  const credentials=await runtime.getAuth('openrouter');
  const key=credentials?.auth.apiKey;
  if(!key) throw Error('Search requires OpenRouter credentials in Pi or OPENROUTER_API_KEY');
  const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    signal:AbortSignal.timeout(60_000),
    body:JSON.stringify({
      model:'openai/gpt-4.1-mini',
      messages:[
        {role:'system',content:'Search the web once using the user’s exact query. Reply only with “Done” after searching.'},
        {role:'user',content:query}
      ],
      tools:[{type:'openrouter:web_search',parameters:{engine:'exa',max_results:5,max_characters:750,max_uses:1}}],
      max_tool_calls:1
    })
  });
  if(!response.ok) {
    const problem=await response.json().catch(()=>undefined);
    const detail=typeof problem?.error?.message==='string' ? ': '+problem.error.message.replaceAll(key,'[redacted]') : '';
    throw Error(`OpenRouter search failed (HTTP ${response.status})${detail}`);
  }
  const data=await response.json();
  const choice=data.choices?.[0];
  if(data.error || choice?.finish_reason!=='stop') throw Error('OpenRouter did not complete the search');
  if(data.usage?.server_tool_use_details?.web_search_requests!==1) throw Error('OpenRouter did not execute one web search');
  const annotations:Citation[]|undefined=choice.message?.annotations;
  if(!Array.isArray(annotations)) throw Error('OpenRouter returned no search citations');
  return annotations.filter(item=>item.type==='url_citation').map(({url_citation})=>{
    if(!url_citation || typeof url_citation.title!=='string'
      || typeof url_citation.url!=='string' || !URL.canParse(url_citation.url) || !/^https?:\/\//i.test(url_citation.url)
      || typeof url_citation.content!=='string' || !url_citation.content.trim()) {
      throw Error('OpenRouter returned an incomplete search citation');
    }
    return {title:url_citation.title.trim() || '(Untitled)',url:url_citation.url,excerpt:url_citation.content};
  });
}

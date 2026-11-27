import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SearchResult = { title: string; url: string; excerpt: string };

export function searchEntry(query:string,results:SearchResult[]):string {
  if(!query.trim()) throw Error('A search query is required');
  const entries=results.map(({title,url,excerpt},index)=>
    `### ${index+1}. ${title.replace(/\s+/g,' ')}\n\n<${url}>\n\n${excerpt}`
  );
  return [`## ${new Date().toISOString()} — Web search`,`Query:\n\n${query}`,
    'Raw search evidence, not verified findings. Sources may be stale or disagree. Articles informed: none.',
    ...(entries.length?entries:['No results.'])].join('\n\n')+'\n';
}

export async function recordSearch(frameDirectory:string,query:string,results:SearchResult[]):Promise<string> {
  const entry=searchEntry(query,results);
  const graph=join(frameDirectory,'wiki');
  mkdirSync(graph,{recursive:true,mode:0o700});
  if(!lstatSync(graph).isDirectory()) throw Error('wiki must be a directory in the calling frame');
  const output=await new Promise<string>((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../../shared/graphwiki/wiki.mjs',import.meta.url)),'journal'],{
      env:{...process.env,GRAPH_ROOT:graph,PROMPT:undefined,PROMPT_FILE:undefined},stdio:['pipe','pipe','pipe']
    });
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',text=>{stdout+=text;});
    child.stderr.setEncoding('utf8').on('data',text=>{stderr+=text;});
    child.once('error',reject);
    child.stdin.on('error',reject);
    child.once('close',(code,signal)=>code===0?resolve(stdout.trim()):reject(Error(`Search journal publication failed (${signal ?? code}): ${stderr.trim()}`)));
    child.stdin.end(entry);
  });
  if(!/^journals\/\d{4}-\d\d-\d\d\.md$/.test(output)) throw Error('Journal publication returned an invalid path');
  return join('wiki',output);
}

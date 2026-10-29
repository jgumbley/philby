import { createInterface } from 'node:readline/promises';
import { configRoot, loadProviders } from '../dist/src/providers.js';
import { configuredModels } from '../dist/src/models.js';
import { ProviderCredentials } from '../dist/src/credentials.js';

let input;
const controller=new AbortController();
const cancel=()=>controller.abort();
try {
  const id=process.env.PROVIDER;
  if(!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw Error('Supply PROVIDER=name for a configured ChatGPT provider');
  const directory=configRoot();
  const configs=loadProviders(directory);
  const config=configs.find(config=>config.id===id);
  if(!config || config.type!=='openai') throw Error('PROVIDER must name a provider with TYPE=openai and AUTH=oauth');
  if(!process.stdin.isTTY) throw Error('Provider login requires an interactive terminal');
  const models=configuredModels([config],directory);
  const credentials=new ProviderCredentials(directory);
  const device=await credentials.deviceId();
  input=createInterface({input:process.stdin,output:process.stdout});
  input.on('SIGINT',cancel);
  input.on('close',cancel);
  process.on('SIGTERM',cancel);
  await models.login(id,'oauth',{
    signal:controller.signal,
    prompt:async prompt=>{
      if(prompt.type!=='manual_code') throw Error(`Unsupported login prompt: ${prompt.type}`);
      return input.question(`${prompt.message}\n`,{signal:prompt.signal});
    },
    notify:event=>{
      if(event.type==='auth_url') console.log(`Open this link to sign in:\n${event.url}\n${event.instructions || ''}`);
      else if(event.type==='info' || event.type==='progress') console.log(event.message);
      else throw Error(`Unsupported login event: ${event.type}`);
    }
  },{agentName:'Philby',getDeviceId:()=>device});
  console.log(`Signed in to ${id}. Reopen your pane after adding provider configuration, then select it with /model.`);
} catch(error) {
  console.error(controller.signal.aborted?'Login cancelled':error instanceof Error?error.message:'Provider login failed');
  process.exitCode=1;
} finally {
  input?.close();
  process.removeListener('SIGTERM',cancel);
}

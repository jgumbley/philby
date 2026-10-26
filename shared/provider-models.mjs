import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

let key;
try {
  const name=process.env.PROVIDER;
  if(!name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw Error('Supply PROVIDER=name');
  const root=process.env.PHILBY_ROOT || fileURLToPath(new URL('../',import.meta.url));
  const config=parseEnv(readFileSync(resolve(root,name+'.provider'),'utf8'));
  key=config.API_KEY;
  if(!key || !config.BASE_URL) throw Error('API_KEY and BASE_URL are required');
  const response=await fetch(config.BASE_URL.replace(/\/$/,'')+'/models',{
    headers:{Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(20000),
  });
  if(!response.ok) throw Error(`Model discovery failed: HTTP ${response.status}`);
  const result=await response.json();
  console.log(JSON.stringify(result,null,2).replaceAll(key,'[redacted]'));
} catch(error) {
  const message=error instanceof Error?error.message:String(error);
  console.error(key?message.replaceAll(key,'[redacted]'):message);
  process.exitCode=1;
}

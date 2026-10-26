import { copyFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

try {
  const source=fileURLToPath(new URL('../',import.meta.url));
  const root=resolve(process.env.PHILBY_ROOT || source);
  for(const file of ['.env','openrouter.provider']) {
    const target=join(root,file);
    if(!existsSync(target)) {
      copyFileSync(join(source,file+'.example'),target,1);
      chmodSync(target,0o600);
      console.log(`Created ${file}`);
    }
  }
  if(!parseEnv(readFileSync(join(root,'openrouter.provider'),'utf8')).API_KEY?.trim()) console.log('Enter API_KEY in openrouter.provider before starting Philby');
} catch(error) {
  console.error(String(error));
  process.exitCode=1;
}

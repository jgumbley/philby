import { copyFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, piAgentDir } from '../dist/src/config.js';

try {
  const source=fileURLToPath(new URL('../',import.meta.url));
  const target=join(root,'.env');
  if(!existsSync(target)) {
    copyFileSync(join(source,'.env.example'),target,1);
    chmodSync(target,0o600);
    console.log('Created .env');
  }
  mkdirSync(piAgentDir,{recursive:true,mode:0o700});
  console.log(`Pi configuration: ${piAgentDir}`);
  console.log('Run make provider-login, then /login in Pi. Set DEFAULT_MODEL in .env for new panes.');
} catch(error) {
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
}
